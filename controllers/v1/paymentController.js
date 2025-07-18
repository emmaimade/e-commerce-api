import crypto from "crypto";
import db from "../../config/db.js";
import createTransporter from "../../utils/email.js";

// Webhook handler
export const handleWebhook = async (req, res) => {
  let parsedBody;
  let event;
  let reference;
  try {
    // Since you're using express.raw(), req.body is a Buffer
    const rawBody = req.body;
    if (!rawBody || rawBody.length === 0) {
      console.error("❌ Empty webhook body received");
      return res.status(400).json({
        success: false,
        message: "Empty request body",
      });
    }
    
    console.log("Raw body type:", typeof rawBody);
    console.log("Raw body:", rawBody);

    // Convert Buffer to string and parse JSON
    try {
      const bodyString = rawBody.toString('utf8');
      parsedBody = JSON.parse(bodyString);
    } catch (parseError) {
      console.error("❌ Failed to parse webhook body:", parseError);
      return res.status(400).json({
        success: false,
        message: "Invalid JSON body",
      });
    }

    event = parsedBody?.event;
    reference = parsedBody?.data?.reference;

    console.log("🔔 Webhook received:", {
      event: event,
      reference: reference,
      timeStamp: new Date().toISOString(),
    });

    try {
      // Verify webhook signature
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret) {
        console.error("❌ PAYSTACK_SECRET_KEY not configured");
        return res.status(500).json({
          success: false,
          message: "Webhook secret not configured",
        });
      }

      const hash = crypto
        .createHmac("sha512", secret)
        .update(rawBody)
        .digest("hex");

      const signature = req.headers["x-paystack-signature"];

      if (hash !== signature) {
        console.error("❌ Invalid webhook signature");
        return res.status(400).json({
          success: false,
          message: "Invalid signature",
        });
      }

      const { data } = parsedBody;

      // log the event being processed
      console.log(
        `Processing webhook event: ${event} for reference: ${reference}`
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
        
        case "refund.processed":
          await handleSuccessfulRefund(data);
          console.log("✅ Successfully processed refund.processed");
          break;
        
        case "refund.failed":
          await handleFailedRefund(data);
          console.log("❌ Successfully processed refund.failed");
          break;

        case "refund.pending":
          await handlePendingRefund(data);
          console.log("✅ Successfully processed refund.pending");
          break;

        default:
          console.log(`Unhandled webhook event: ${event}`);
      }

      res.status(200).json({
        success: true,
        message: `Webhook ${event} processed successfully`,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Webhook processing error:", {
        error: err.message,
        stack: err.stack,
        event: event,
        reference: reference,
      });
    }
  } catch (err) {
    console.error("❌ Error processing webhook:", err);
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
  }
};

// Successful payment handler
const handleSuccessfulPayment = async (data) => {
  try {
    const { reference, channel, amount, customer } = data;

    console.log("Processing successful payment:", {
      reference,
      channel,
      amount: amount / 100, // Convert from kobo to naira
      customer_email: customer?.email,
    });

    // Check if payment exist
    const existingPayment = await db.query(
      "SELECT id FROM payments_logs WHERE payment_reference = $1",
      [reference]
    );

    if (existingPayment.rows.length > 0) {
      console.log("Payment already processed");
      return;
    }

    // Update order status only if it's still pending
    const updateQuery = `
            UPDATE orders
            SET
                status = 'paid',
                payment_method = $1,
                order_status = 'processing',
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

      // Update Product Inventory
      try {
        await updateProductInventory(order.id);
        console.log("Inventory updated successfully");
      } catch (inventoryError) {
        console.log("Inventory update failed:", inventoryError.message);
      }

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
        `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
        [
          order.id,
          reference,
          "paid",
          amount / 100, // Convert from kobo to naira
          channel,
          "webhook",
          JSON.stringify(data.gateway_response) || "Payment successful",
        ]
      );

      // Update order status history
      await db.query(
        `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
        [order.id, "processing", "Payment verified, order is being processed"]
      );

      // Create transporter
      const transporter = createTransporter();

      // Email options
      const mailOptions = {
        from: `E-commerce API <${process.env.EMAIL_USER}>`,
        to: customer.email,
        subject: "Payment Confirmation",
        html: `
         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1>Payment Confirmation</h1>
            <p>Hi ${customer.name},</p>
            <p>Your payment for order ${order.id} has been confirmed. Your order is being processed.</p>
            <p>Order details:</p>
            <ul>
                <li>Order ID: ${order.id}</li>
                <li>Order Status: ${order.order_status}</li>
                <li>Payment Reference: ${order.payment_ref}</li>
                <li>Payment Method: ${order.payment_method}</li>
            </ul>
            <p>Thanks for shopping with us!</p>
            <br>
            <p>Best regards,</p>
            <p>The E-commerce API Team</p>
          </div>
        `,
      };

      // Send email
      try {
        await transporter.sendMail(mailOptions);
        console.log("Email sent successfully");
      } catch (emailError) {
        console.log("Email sending failed:", emailError.message);
      }
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

// Failed payment handler
const handleFailedPayment = async (data) => {
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

      // Update order status history
      await db.query(
        `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
        [order.id, "failed", `Payment verification failed`]
      );
    } else {
      console.log(
        "No pending order found for failed payment reference:",
        reference
      );
    }
  } catch (err) {
    console.error("Error processing failed payment:", {
      error: err.message,
      stack: err.stack,
    });
  }
};

// Handle successful refund
const handleSuccessfulRefund = async (data) => {
  try {
    const { reference, amount, customer, refund } = data;

    console.log("Processing successful refund:", {
      reference,
      amount: amount / 100, // Convert from kobo to naira
      customer_email: customer?.email,
      refund_reference: refund?.reference,
    });

    // Update order status to cancelled only if it's still pending
    const updateQuery = `
      UPDATE orders
      SET
          status = 'refunded',
          updated_at = now()
      WHERE payment_ref = $1 AND status = 'paid'
      RETURNING *
    `;

    const result = await db.query(updateQuery, [reference]);

    if (result.rows.length > 0) {
      const order = result.rows[0];

      console.log(`Order refund processed:`, {
        order_id: order.id,
        user_id: order.user_id,
        previous_status: "pending",
        new_status: "refunded",
      });

      // Log the refund for audit trail
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [
          order.id,
          reference,
          "refunded",
          amount / 100,
          order.payment_method,
          "webhook",
          JSON.stringify(refund?.gateway_response) || "Refund processed",
        ]
      );

      // Update order status history
      await db.query(
        `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
        [
          order.id,
          "refunded",
          `Payment was refunded to ${customer.email} with reference ${refund.reference}`,
        ]
      );

      // Create transporter
      const transporter = createTransporter();
      
      // Send refund email
      const mailOptions = {
        from: `E-commerce API <${process.env.EMAIL_USER}>`,
        to: customer.email,
        subject: "Refund Notification",
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1>Refund Notification</h1>
          <p>Hi ${customer.name},</p>
          <p>Your refund for order (ID: ${order.id}) has been successfully processed.</p>
          <p><strong>Payment Reference</strong>: ${order.payment_ref}</p>
          <p><strong>Refund Reference</strong>: ${refund?.reference}</p>
          <p><strong>Refund Amount</strong>: NGN ${(amount / 100).toFixed(2)}</p>
          <p>The refund will reflect in your account within 3-5 business days depending on your bank.</p>
          <p>If you have any questions or concerns, please contract our support team.</p>
          <p>Thank you for shopping with us!</p>
          <br>
          <p>Best regards,</p>
          <p>The E-commerce API Team</p>
        </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log("Refund email sent successfully");
      } catch (emailErr) {
        console.error("Error sending refund email:", emailErr);
      }
    } else {
      console.log(
        "No pending order found for refund reference:",
        reference
      );
      console.log("This might mean the order was already refunded or not in a refundable state");
    }
  } catch (err) {
    console.error("Error processing successful refund:", {
      error: err.message,
      stack: err.stack,
    })
  }
}

// Handle failed refund
const handleFailedRefund = async (data) => {
  try {
    const { reference, customer } = data;

    console.log("Processing failed refund:", {
      reference,
      customer_email: customer?.email,
    });

    const orderResult = await db.query(
      "SELECT * FROM orders WHERE payment_ref = $1",
      [reference]
    );

    if (orderResult.rows.length > 0) {
      const order = orderResult.rows[0];

      // Log the refund for audit trail
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
        VALUES ($1, $2, $3, $4, $5, now())`,
        [order.id, reference, "refund_failed", "Refund processing failed", "webhook"]
      );

      // Update order status history
      await db.query(
        `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
        [order.id, "refund_failed", "Refund processing failed"]
      );
    }
  } catch (err) {
    console.error("Error processing failed refund:", {
      error: err.message,
      stack: err.stack,
    })
  }
}

// Handle pending refund
const handlePendingRefund = async (data) => {
  try {
    const { reference, customer } = data;

    console.log("Processing pending refund:", {
      reference,
      customer_email: customer?.email,
    });

    const orderResult = await db.query(
      "SELECT * FROM orders WHERE payment_ref = $1",
      [reference]
    );

    if (orderResult.rows.length > 0) {
      const order = orderResult.rows[0];

      // Log refund for audit trail
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, processed_by, created_at)
        VALUES ($1, $2, $3, $4, now())`,
        [order.id, reference, "refund_pending", "webhook"]
      );

      // Update order status history
      await db.query(
        `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
        [order.id, "refund_pending", "Refund is pending"]
      );
    }
  } catch (err) {
    console.error("Error processing pending refund:", {
      error: err.message,
      stack: err.stack,
    })
  }
}

// Update product inventory
export const updateProductInventory = async (orderId) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    console.log(`Updating inventory for ORDER ID: ${orderId}`);

    // Get order items
    const orderItemsQuery = `
            SELECT
                oi.product_id,
                oi.quantity as ordered_quantity,
                p.name as product_name,
                p.inventory_qty as current_stock
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = $1
        `;

    const orderItemsResult = await client.query(orderItemsQuery, [orderId]);

    if (orderItemsResult.rows.length === 0) {
      console.log(`No order items found for ORDER ID: ${orderId}`);
      return;
    }

    for (const item of orderItemsResult.rows) {
      const { product_id, ordered_quantity, product_name, current_stock } =
        item;
      const newStockQuantity = Math.max(0, current_stock - ordered_quantity);

      await client.query(
        `UPDATE products
        SET inventory_qty = $1, updated_at = now()
        WHERE id = $2`,
        [newStockQuantity, product_id]
      );

      console.log(
        `Updated inventory for ${product_name}: ${current_stock} -> ${newStockQuantity}`
      );

      // Update product status if it goes out of stock
      if (newStockQuantity === 0) {
        await client.query(
          `UPDATE products SET status = 'out_of_stock' WHERE id = $1`,
          [product_id]
        );
        console.log(`Product ${product_name} is now out of stock`);
      }
    }
    await client.query("COMMIT");

    console.log(`Updated inventory successfully for order ${orderId}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error updating product inventory:", {
      error: err.message,
      stack: err.stack,
      orderId: orderId,
    });
  } finally {
    client.release();
  }
};

// Get payment status
export const getPaymentStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;

    // Input validation
    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required",
      });
    }

    // check if user is authenticated
    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    const query = `
      SELECT
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
      GROUP BY o.id
    `;

    const result = await db.query(query, [reference, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    const orderData = result.rows[0];

    // Get payment logs for this reference
    const logsQuery = `
      SELECT
          status,
          created_at,
          gateway_response
      FROM payment_logs
      WHERE payment_reference = $1
      ORDER BY created_at DESC
      LIMIT 5
    `;

    const logsResult = await db.query(logsQuery, [reference]);

    // Set cache control headers
    if (orderData.status === "paid") {
      res.set("Cache-Control", "public, max-age=3600"); // 1 hour
    } else {
      res.set("Cache-Control", "no-cache"); // Pending orders should not be cached
    }

    res.status(200).json({
      success: true,
      data: {
        ...orderData,
        payment_logs: logsResult.rows,
        last_updated: new Date().toISOString()
      },
    });
  } catch (err) {
    console.error("Error getting payment status:", err);
    res.status(500).json({
      success: false,
      message: "Failed to get payment status"
    });
  }
};

// Test webhook endpoint for development
export const testWebhook = async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({
      success: false,
      message: "Test webhook no available in production",
    });
  }

  try {
    const { reference, event = "charge.success" } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required",
      });
    }

    // Check if order exists
    const orderResult = await db.query(
      "SELECT * FROM orders WHERE payment_ref = $1",
      [reference]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found for this reference",
      });
    }

    // Simulate webhook data
    const testData = {
      event,
      data: {
        reference,
        status: event === "charge.success" ? "success" : "failed",
        amount: 100 * 100, // Convert from naira to kobo
        channel: "card",
        gateway_response:
          event === "charge.failed" ? "Insufficient funds" : "Approved",
        customer: {
          email: "test@example.com",
        },
      },
    };

    console.log("Testing webhook with data:", testData);

    if (event === "charge.success") {
      await handleSuccessfulPayment(testData);
    } else {
      await handleFailedPayment(testData);
    }

    res.json({
      success: true,
      message: `Test webhook ${event} processed successfully`,
      data: testData,
    });
  } catch (err) {
    console.error("Error testing webhook:", err);
    res.status(500).json({
      success: false,
      message: "Test webhook failed",
      error: err.message,
    });
  }
};
