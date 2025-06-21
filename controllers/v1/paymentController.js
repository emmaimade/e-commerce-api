import db from "../../config/db.js";
import crypto from "crypto";

// webhook handler
export const handleWebhook = async (req, res) => {
  try {
    console.log("🔔 Webhook received:", {
      event: req.body?.event,
      reference: req.body?.data?.reference,
      timeStamp: new Date().toISOString(),
    });

    try {
      // verify webhook signature
      const secret = process.env.PAYSTACK_WEBHOOK_SECRET;

      if (!secret) {
        console.error("❌ PAYSTACK_WEBHOOK_SECRET not configured");
        return res.status(500).json({
          success: false,
          message: "Webhook secret not configured",
        });
      }

      const hash = crypto
        .createHmac("sha512", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      const signature = req.headers["x-paystack-signature"];

      if (hash !== signature) {
        console.error("❌ Invalid webhook signature");
        return res.status(400).json({
          success: false,
          message: "Invalid signature",
        });
      }

      const { event, data } = req.body;

      // log the event being processed
      console.log(
        `Processing webhook event: ${event} for reference: ${data?.reference}`
      );

      switch (event) {
        case "charge.success":
          await handleSuccessfulPayment(data);
          console.log("✅ Successfully processed charge.success");
          break;

        case "charge.failed":
          await handleFailedPayment(data);
          console.log("❌ Successfully processed charge.failed");
          break;

        default:
          console.log(`Unhandled webhook event: ${event}`);
      }

      res.status(200).json({
        success: true,
        message: `Webhook ${event} processed successfully`,
      });
    } catch (err) {
      console.error("Webhook processing error:", {
        error: err.message,
        stack: err.stack,
        body: req.body,
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// successfull payment handler
export const handleSuccessfulPayment = async (req, res) => {
  try {
    const { reference, channel, amount, customer } = data;

    console.log("Processing successful payment:", {
      reference,
      channel,
      amount: amount / 100, // Convert from kobo to naira
      customer_email: customer?.email,
    });

    // Update order status only if it's still pending
    const updateQuery = `
            UPDATE orders
            SET
                status = 'paid',
                payment_method = $1,
                updated_at = now()
            WHERE payment_ref = $2 AND status = 'pending'
            RETURNING *
        `;

    const result = await db.query(updateQuery, [channel, reference]);

    if (result.rows.length > 0) {
      const order = result.rows[0];

      console.log("Order updated:", {
        order_id: order.id,
        user_id: order.user_id,
        previous_status: "pending",
        new_status: order.status,
      });

      // Only clear cart if order was actually updated (was pending)
      // This prevents clearing cart if user already verified payment
      const cartClearResult = await db.query(
        `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1) AND EXISTS (SELECT 1 FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1))`,
        [order.user_id]
      );

      if (cartClearResult.rowCount > 0) {
        console.log(
          `Cleared ${cartClearResult.rowCount} items from cart for user ${order.user_id}`
        );
      } else {
        console.log("Cart was alredy empty or cleared");
      }

      // Log the payment transaction for audit trail
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
        [order.id, reference, "paid", amount, channel, "webhook"]
      );

      // Update Product Inventory
    } else {
      console.log("No pending order found for reference:", reference);
      console.log("This might mean payment was already verified by user");
    }
  } catch (err) {
    console.error("Error processing successful payment:", {
      error: err.message,
      stack: err.stack,
    });
  }
};

// failed payment handler
export const handleFailedPayment = async (req, res) => {
  try {
    const { reference, gateway_response, customer } = data;

    console.log(" ❌ Processing failed payment:", {
      reference,
      reason: gateway_response,
      customer_email: customer?.email,
    });

    // Update order status to failed only if it's still pending
    const updateQuery = `
            UPDATE orders
            SET
                status = 'failed',
                updated_at = now()
            WHERE payment_ref = $1 AND status = 'pending'
            RETURNING *
        `;

    const result = await db.query(updateQuery, [reference]);

    if (result.rows.length > 0) {
      const order = result.rows[0];
      console.log(`Order ${order.id} marked as failed`);

      // Log the failed payment
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
        [order.id, reference, "failed", gateway_response, "webhook"]
      );
    } else {
        console.log('No pending order found for failed payment reference:', reference);
    }
  } catch (err) {
    console.error(
      "Error processing failed payment:",
      {
        error: err.message,
        stack: err.stack,
      }
    )
  }
};
