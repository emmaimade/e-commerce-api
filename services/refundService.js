import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { withTransaction } from "../utils/transaction.js";
import { createRefund } from "./paystackService.js";

const MAX_ATTEMPTS = 5;
const FIRST_RETRY_MINUTES = 5;
const STUCK_AFTER_MINUTES = 15;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Save the refund in the caller's transaction, so it can't be lost once the
// cancellation commits. One refund per payment: returns null if one exists.
export const requestRefund = async (client, { order, amount, requestedBy }) => {
  const result = await client.query(
    `INSERT INTO refunds (order_id, payment_reference, amount, requested_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (payment_reference) DO NOTHING
    RETURNING *`,
    [order.id, order.payment_ref, amount, requestedBy]
  );

  return result.rows[0] ?? null;
};

// Paystack won't complete this one, so it needs a person. Admins find it with
// GET /v1/admin/refunds?status=failed
const markFailed = (refund, reason) =>
  withTransaction(async (client) => {
    await client.query(
      "UPDATE refunds SET status = 'failed', last_error = $1, updated_at = now() WHERE id = $2",
      [reason, refund.id]
    );

    await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (payment_reference, status) DO NOTHING`,
      [refund.order_id, refund.payment_reference, "refund_failed", reason, refund.requested_by]
    );

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [refund.order_id, "refund_failed", `Refund failed: ${reason}`]
    );
  });

// A status from Paystack wins: its webhook may already have moved this refund on
const markAccepted = (refund, status) =>
  db.query(
    "UPDATE refunds SET status = $1, last_error = NULL, updated_at = now() WHERE id = $2 AND status = 'processing'",
    [status, refund.id]
  );

const scheduleRetry = (refund, reason) =>
  db.query(
    `UPDATE refunds
    SET
      status = 'required',
      last_error = $1,
      next_attempt_at = now() + make_interval(mins => $2),
      updated_at = now()
    WHERE id = $3 AND status = 'processing'`,
    [reason, FIRST_RETRY_MINUTES * 2 ** (refund.attempts - 1), refund.id]
  );

const failedResult = async (refund, reason) => {
  console.error(`REFUND REQUIRED: order ${refund.order_id} (${refund.payment_reference}): ${reason}`);

  try {
    await markFailed(refund, reason);
  } catch (err) {
    console.error(`Could not record failed refund for order ${refund.order_id}:`, err.message);
  }

  return { processed: false, error: { message: reason } };
};

// Send one refund to Paystack. Call this after committing, never inside a
// transaction: the request can take up to 30 seconds.
//
// A timeout doesn't prove a refund failed, so the attempt that follows one can
// reach Paystack twice. That can't pay out twice: refunds are always in full,
// Paystack refuses to reverse a transaction that's fully reversed, and its
// refund webhooks stop any retry that's still waiting.
export const attemptRefund = async (refundId) => {
  const claimed = await db.query(
    `UPDATE refunds
    SET status = 'processing', attempts = attempts + 1, updated_at = now()
    WHERE id = $1 AND status = 'required' AND next_attempt_at <= now()
    RETURNING *`,
    [refundId]
  );

  // Another worker has it, or a webhook has already settled it
  if (claimed.rows.length === 0) {
    return { processed: true, data: { status: "pending" } };
  }

  const refund = claimed.rows[0];

  try {
    const result = await createRefund(refund.payment_reference, refund.amount * 100);

    if (result.status && ["pending", "processed"].includes(result.data.status)) {
      await markAccepted(refund, result.data.status);
      return { processed: true, data: result.data };
    }

    return failedResult(refund, result.message || "Refund was not accepted");
  } catch (paystackError) {
    const { response } = paystackError;
    const errorData = response?.data;

    if (
      errorData?.code === "transaction_reversed" &&
      errorData?.message === "Transaction has been fully reversed"
    ) {
      await markAccepted(refund, "processed");
      return {
        processed: true,
        data: { status: "already_processed", message: errorData.message },
      };
    }

    const reason = errorData?.message || paystackError.message;

    // A clear answer from Paystack won't change if asked again
    if (response?.status >= 400 && response?.status < 500) {
      return failedResult(refund, reason);
    }

    if (refund.attempts >= MAX_ATTEMPTS) {
      return failedResult(refund, reason);
    }

    await scheduleRetry(refund, reason);

    // Still on its way as far as the customer is concerned
    return { processed: true, data: { status: "pending" } };
  }
};

export const retryDueRefunds = async () => {
  // A crash during an attempt leaves its refund claimed
  await db.query(
    `UPDATE refunds
    SET status = 'required', next_attempt_at = now(), updated_at = now()
    WHERE status = 'processing' AND updated_at < now() - make_interval(mins => $1)`,
    [STUCK_AFTER_MINUTES]
  );

  const due = await db.query(
    "SELECT id FROM refunds WHERE status = 'required' AND next_attempt_at <= now() ORDER BY id"
  );

  for (const { id } of due.rows) {
    await attemptRefund(id);
  }
};

export const startRefundRetryJob = () => {
  const run = () =>
    retryDueRefunds().catch((err) =>
      console.error("Refund retry job failed:", err.message)
    );

  run();
  return setInterval(run, CHECK_INTERVAL_MS);
};

// Called from Paystack's refund webhooks. A refund it has started stops retrying;
// only a refund not yet settled can move, so a repeated event changes nothing.
export const recordRefundStatus = (client, reference, status, reason = null) =>
  client.query(
    `UPDATE refunds
    SET status = $1, last_error = COALESCE($2, last_error), updated_at = now()
    WHERE payment_reference = $3 AND status NOT IN ('processed', $1)`,
    [status, reason, reference]
  );

export const listRefunds = async ({ status, page: pageParam, limit: limitParam }) => {
  const page = Math.max(1, parseInt(pageParam) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitParam) || 20));
  const params = status ? [status] : [];
  const whereClause = status ? "WHERE r.status = $1" : "";

  const refunds = await db.query(
    `SELECT
      r.*,
      u.name as customer_name, u.email as customer_email
    FROM refunds r
    LEFT JOIN orders o ON r.order_id = o.id
    LEFT JOIN users u ON o.user_id = u.id
    ${whereClause}
    ORDER BY r.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );

  const count = await db.query(`SELECT COUNT(*) as total FROM refunds r ${whereClause}`, params);

  return {
    refunds: refunds.rows,
    pagination: {
      current_page: page,
      per_page: limit,
      total_refunds: parseInt(count.rows[0].total),
    },
  };
};

// Give a failed refund a fresh set of attempts, after an admin has dealt with the cause
export const retryFailedRefund = async (refundId) => {
  const reset = await db.query(
    `UPDATE refunds
    SET status = 'required', attempts = 0, next_attempt_at = now(), last_error = NULL, updated_at = now()
    WHERE id = $1 AND status = 'failed'
    RETURNING id`,
    [refundId]
  );

  if (reset.rows.length === 0) {
    const existing = await db.query("SELECT id FROM refunds WHERE id = $1", [refundId]);

    if (existing.rows.length === 0) {
      throw new HttpError(404, "Refund not found");
    }

    throw new HttpError(409, "Only a failed refund can be retried");
  }

  await attemptRefund(refundId);

  const refund = await db.query("SELECT * FROM refunds WHERE id = $1", [refundId]);
  return refund.rows[0];
};
