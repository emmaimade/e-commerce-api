import { withTransaction } from "../utils/transaction.js";
import { createRefund } from "./paystackService.js";

// Save a refund Paystack didn't accept, so an admin can find it with
// GET /v1/admin/payments/logs?status=refund_failed and refund it manually
const recordFailedRefund = (order, reason, processedBy) =>
  withTransaction(async (client) => {
    await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (payment_reference, status) DO NOTHING`,
      [order.id, order.payment_ref, "refund_failed", reason, processedBy]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
      [order.id, "refund_failed", `Refund failed: ${reason}`]
    );
  });

// Refund a paid order in full. Call this after committing, never inside a
// transaction: the request can take up to 30 seconds. Failures are recorded
// rather than thrown because the order is already cancelled by this point.
export const refundOrder = async (order, processedBy) => {
  let reason;

  try {
    const result = await createRefund(order.payment_ref, order.total * 100);

    if (result.status && ["pending", "processed"].includes(result.data.status)) {
      return { processed: true, data: result.data };
    }

    reason = result.message || "Refund was not accepted";
  } catch (paystackError) {
    const errorData = paystackError.response?.data;

    if (
      errorData?.code === "transaction_reversed" &&
      errorData?.message === "Transaction has been fully reversed"
    ) {
      return {
        processed: true,
        data: { status: "already_processed", message: errorData.message },
      };
    }

    reason = errorData?.message || paystackError.message;
  }

  console.error(`REFUND REQUIRED: order ${order.id} (${order.payment_ref}): ${reason}`);

  try {
    await recordFailedRefund(order, reason, processedBy);
  } catch (err) {
    console.error(`Could not record failed refund for order ${order.id}:`, err.message);
  }

  return { processed: false, error: { message: reason } };
};
