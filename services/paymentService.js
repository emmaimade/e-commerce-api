import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { withTransaction } from "../utils/transaction.js";
import {
  paymentConfirmedEmail,
  paymentReceivedEmail,
  paymentVerifiedByAdminEmail,
  refundProcessedEmail,
} from "../emails/paymentEmails.js";
import { sendEmail } from "./emailService.js";
import { updateProductInventory } from "./inventoryService.js";
import { verifyTransaction } from "./paystackService.js";
import { attemptRefund, recordRefundStatus, requestRefund } from "./refundService.js";

const PAYMENT_CONFIRMED_SUBJECT = "Payment Confirmed - Your Order is Being Processed";

// Paystack stores gateway messages as text; the log column is JSONB
const toJson = (value, fallback) => JSON.stringify(value ?? fallback);

// The one place an order becomes paid, whichever route confirmed it. Orders
// already paid, or cancelled or expired, don't match, so returns null for those.
const markOrderPaid = ({ reference, channel, amount, gatewayResponse, processedBy, note }) =>
  withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE orders
      SET
        status = 'paid',
        payment_method = $1,
        order_status = 'processing',
        updated_at = now()
      WHERE payment_ref = $2 AND status IN ('pending', 'failed') AND order_status <> 'cancelled'
      RETURNING *`,
      [channel, reference]
    );

    if (result.rows.length === 0) return null;

    const order = result.rows[0];

    await updateProductInventory(order.id, client);

    await client.query(
      "DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)",
      [order.user_id]
    );

    // Log the payment transaction for audit trail
    await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (payment_reference, status) DO NOTHING`,
      [order.id, reference, "paid", amount, channel, processedBy, toJson(gatewayResponse, "Payment successful")]
    );

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [order.id, "processing", note]
    );

    return order;
  });

// Only a pending order can fail, so returns null for anything else
const markOrderFailed = ({ reference, channel = null, reason, processedBy }) =>
  withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE orders
      SET
        status = 'failed',
        payment_method = COALESCE($1, payment_method),
        updated_at = now()
      WHERE payment_ref = $2 AND status = 'pending' AND order_status <> 'cancelled'
      RETURNING *`,
      [channel, reference]
    );

    if (result.rows.length === 0) return null;

    const order = result.rows[0];

    await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (payment_reference, status) DO NOTHING`,
      [order.id, reference, "failed", reason, processedBy]
    );

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [order.id, "failed", "Payment verification failed"]
    );

    return order;
  });

// A successful charge that couldn't be applied to an order. If the order was
// cancelled or expired, the customer has paid for nothing, so the money goes back.
const refundLatePayment = async (reference, amount) => {
  const refund = await withTransaction(async (client) => {
    const result = await client.query("SELECT * FROM orders WHERE payment_ref = $1 FOR UPDATE", [reference]);
    const order = result.rows[0];

    if (order?.order_status !== "cancelled" || ["paid", "refunded"].includes(order.status)) {
      return null;
    }

    const created = await requestRefund(client, { order, amount, requestedBy: "late_payment" });

    if (!created) return null;

    await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, amount, processed_by, created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (payment_reference, status) DO NOTHING`,
      [order.id, reference, "late_payment", amount, "system"]
    );

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [order.id, "refund_required", "Payment received after the order was cancelled"]
    );

    return created;
  });

  if (refund) await attemptRefund(refund.id);
};

// ---- Webhook events. Errors reach the webhook as a 500, so Paystack retries;
// every handler is safe to run twice.

const handleChargeSuccess = async (data) => {
  const { reference, channel, amount, customer, gateway_response } = data;

  const order = await markOrderPaid({
    reference,
    channel,
    amount: amount / 100, // Convert from kobo to naira
    gatewayResponse: gateway_response,
    processedBy: "webhook",
    note: "Payment verified, order is being processed",
  });

  if (!order) {
    await refundLatePayment(reference, amount / 100);
    return;
  }

  await sendEmail({
    to: customer.email,
    subject: PAYMENT_CONFIRMED_SUBJECT,
    html: paymentReceivedEmail({ customer, order, amount }),
  });
};

const handleChargeFailed = ({ reference, gateway_response }) =>
  markOrderFailed({ reference, reason: gateway_response, processedBy: "webhook" });

const handleRefundProcessed = async (data) => {
  const { transaction_reference: reference, amount, customer, id: refund_id } = data;

  const order = await withTransaction(async (client) => {
    await recordRefundStatus(client, reference, "processed");

    // Orders already refunded don't match, so a repeated event does nothing
    const result = await client.query(
      `UPDATE orders
      SET
          status = 'refunded',
          updated_at = now()
      WHERE payment_ref = $1 AND order_status = 'cancelled' AND status <> 'refunded'
      RETURNING *`,
      [reference]
    );

    if (result.rows.length === 0) return null;

    const refundedOrder = result.rows[0];

    await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (payment_reference, status) DO NOTHING`,
      [
        refundedOrder.id,
        reference,
        "refunded",
        amount / 100,
        refundedOrder.payment_method,
        "webhook",
        JSON.stringify({
          gateway_status: data.status,
          gateway_id: data.id,
          gateway_domain: data.domain,
          notes: { customer: data.customer_note, merchant: data.merchant_note },
        }),
      ]
    );

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [refundedOrder.id, "refunded", `Payment was refunded to ${customer.email} with reference ${refund_id}`]
    );

    return refundedOrder;
  });

  if (!order) return;

  await sendEmail({
    to: customer.email,
    subject: "Refund Processed - Your Money is on the Way!",
    html: refundProcessedEmail({ customer, order, refund_id, amount }),
  });
};

// Log a refund event once, even if Paystack delivers it more than once
const recordRefundEvent = (reference, { status, failureReason = null }, note) =>
  withTransaction(async (client) => {
    await recordRefundStatus(
      client,
      reference,
      status === "refund_failed" ? "failed" : "pending",
      status === "refund_failed" ? "Paystack reported the refund failed" : null
    );

    const orderResult = await client.query("SELECT id FROM orders WHERE payment_ref = $1", [reference]);

    if (orderResult.rows.length === 0) return;

    const orderId = orderResult.rows[0].id;

    const logged = await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (payment_reference, status) DO NOTHING
      RETURNING id`,
      [orderId, reference, status, failureReason, "webhook"]
    );

    if (logged.rows.length === 0) return;

    await client.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
      [orderId, status, note]
    );
  });

const handleRefundFailed = (data) =>
  recordRefundEvent(
    data.transaction_reference,
    {
      status: "refund_failed",
      failureReason: JSON.stringify({
        status: "failed",
        refund_id: data.id,
        failure_reason: "Refund processing failed",
        gateway_domain: data.domain,
        failed_at: new Date().toISOString(),
      }),
    },
    "Refund processing failed"
  );

const handleRefundPending = (data) =>
  recordRefundEvent(data.transaction_reference, { status: "refund_pending" }, "Refund is pending");

const webhookHandlers = {
  "charge.success": handleChargeSuccess,
  "charge.failed": handleChargeFailed,
  "refund.processed": handleRefundProcessed,
  "refund.failed": handleRefundFailed,
  "refund.needs-attention": handleRefundFailed,
  "refund.pending": handleRefundPending,
};

export const processWebhookEvent = async ({ event, data }) => {
  const handler = webhookHandlers[event];

  if (handler) await handler(data);
};

// ---- Verifying a payment on request

const fetchTransaction = async (reference) => {
  let response;

  try {
    response = await verifyTransaction(reference);
  } catch (err) {
    console.error("Paystack verification error:", err.response?.data || err.message);
    throw new HttpError(500, "Payment verification failed");
  }

  if (!response.status) {
    throw new HttpError(500, "Payment verification failed");
  }

  return response.data;
};

// Paystack also reports abandoned, ongoing and pending while the customer pays
const isFinished = (transaction) => ["success", "failed"].includes(transaction.status);

const notCompleted = (transaction) => ({
  message: "Payment has not been completed yet",
  data: { payment_status: transaction.status },
});

// Apply a finished Paystack transaction. A 409 means the webhook got there
// first, or the order was cancelled or expired.
const settleTransaction = async ({ reference, order, transaction, processedBy, note }) => {
  const paid = transaction.status === "success";

  const updatedOrder = paid
    ? await markOrderPaid({
        reference,
        channel: transaction.channel,
        amount: order.total,
        gatewayResponse: transaction.gateway_response,
        processedBy,
        note,
      })
    : await markOrderFailed({
        reference,
        channel: transaction.channel,
        reason: transaction.gateway_response || "Payment failed",
        processedBy,
      });

  if (!updatedOrder) {
    if (paid) await refundLatePayment(reference, transaction.amount / 100 || order.total);

    throw new HttpError(409, "Order is no longer awaiting payment");
  }

  return { updatedOrder, paymentStatus: paid ? "paid" : "failed", paymentMethod: transaction.channel };
};

export const verifyCustomerPayment = async (reference, user) => {
  const orderCheck = await db.query(
    "SELECT * FROM orders WHERE payment_ref = $1 AND user_id = $2",
    [reference, user.id]
  );

  if (orderCheck.rows.length === 0) {
    throw new HttpError(400, "Payment not found or access denied");
  }

  const order = orderCheck.rows[0];

  if (order.status === "paid") {
    return {
      message: "Payment has already been verified",
      data: {
        order,
        payment_status: "paid",
        payment_method: order.payment_method,
        verified_at: order.updated_at,
        verified_by: "webhook",
      },
    };
  }

  const transaction = await fetchTransaction(reference);

  if (!isFinished(transaction)) return notCompleted(transaction);

  const { updatedOrder, paymentStatus, paymentMethod } = await settleTransaction({
    reference,
    order,
    transaction,
    processedBy: "user",
    note: "Payment verified and order is being processed",
  });

  if (paymentStatus === "paid") {
    await sendEmail({
      to: user.email,
      subject: PAYMENT_CONFIRMED_SUBJECT,
      html: paymentConfirmedEmail({ user, updatedOrder, reference, paymentMethod }),
    });
  }

  return {
    data: {
      order: updatedOrder,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      verified_at: new Date().toISOString(),
      verified_by: "user",
    },
  };
};

export const verifyPaymentAsAdmin = async (reference, adminId) => {
  const existingOrder = await db.query("SELECT * FROM orders WHERE payment_ref = $1", [reference]);

  if (existingOrder.rows.length === 0) {
    throw new HttpError(400, "Payment reference not found");
  }

  const order = existingOrder.rows[0];

  if (order.status === "paid") {
    throw new HttpError(409, "Payment already verified", {
      data: {
        order,
        payment_status: "paid",
        payment_method: order.payment_method,
        customer_id: order.user_id,
        verification_type: "already_processed",
        verified_at: order.updated_at,
      },
    });
  }

  const transaction = await fetchTransaction(reference);

  if (!isFinished(transaction)) return notCompleted(transaction);

  const { updatedOrder, paymentStatus, paymentMethod } = await settleTransaction({
    reference,
    order,
    transaction,
    processedBy: "admin",
    note: "Payment verified by admin, order is being processed",
  });

  if (paymentStatus === "paid") {
    const customerQuery = await db.query("SELECT email, name FROM users WHERE id = $1", [updatedOrder.user_id]);
    const customer = customerQuery.rows[0];

    if (customer) {
      await sendEmail({
        to: customer.email,
        subject: PAYMENT_CONFIRMED_SUBJECT,
        html: paymentVerifiedByAdminEmail({ customer, updatedOrder, reference, paymentMethod }),
      });
    }
  }

  return {
    data: {
      order: updatedOrder,
      payment_status: paymentStatus,
      payment_method: paymentMethod,
      customer_id: updatedOrder.user_id,
      verification_type: "manual",
      verified_by: "admin",
      verified_at: new Date().toISOString(),
      admin_id: adminId,
    },
  };
};

// ---- Reads

export const isOrderPaid = async (reference) => {
  if (typeof reference !== "string") return false;

  const result = await db.query("SELECT status FROM orders WHERE payment_ref = $1", [reference]);
  return result.rows[0]?.status === "paid";
};

export const getCustomerPaymentStatus = async (reference, userId) => {
  const result = await db.query(
    `SELECT
        o.id,
        o.status as payment_status,
        o.payment_method,
        o.total as total_amount,
        o.order_status,
        o.placed_at,
        o.payment_ref as payment_reference,
        COUNT(oi.id) as item_count
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.payment_ref = $1 AND o.user_id = $2
    GROUP BY o.id`,
    [reference, userId]
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "Payment not found");
  }

  const logs = await db.query(
    `SELECT status, created_at, gateway_response
    FROM payment_logs
    WHERE payment_reference = $1
    ORDER BY created_at DESC
    LIMIT 5`,
    [reference]
  );

  return {
    ...result.rows[0],
    payment_logs: logs.rows,
    last_updated: new Date().toISOString(),
  };
};

// Development-only stand-in for a real webhook delivery
export const simulateWebhook = async (reference, event) => {
  const order = await db.query("SELECT id FROM orders WHERE payment_ref = $1", [reference]);

  if (order.rows.length === 0) {
    throw new HttpError(404, "Order not found for this reference");
  }

  const payload = {
    event,
    data: {
      reference,
      status: event === "charge.success" ? "success" : "failed",
      amount: 100 * 100, // Convert from naira to kobo
      channel: "card",
      gateway_response: event === "charge.failed" ? "Insufficient funds" : "Approved",
      customer: { email: "test@example.com" },
    },
  };

  if (event === "charge.success") {
    await handleChargeSuccess(payload.data);
  } else {
    await handleChargeFailed(payload.data);
  }

  return payload;
};
