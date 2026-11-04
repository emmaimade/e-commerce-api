import crypto from "crypto";
import db from "../../config/db.js";
import createTransporter from "../../utils/email.js";
import { updateProductInventory } from "../../utils/inventory.js";
import { withTransaction } from "../../utils/transaction.js";

// For successful refunds, you might want a minimal gateway response
const createMinimalGatewayResponse = (data) => {
  return JSON.stringify({
    gateway_status: data.status,
    gateway_id: data.id,
    gateway_domain: data.domain,
    notes: {
      customer: data.customer_note,
      merchant: data.merchant_note
    }
  });
};

// For failed refunds, you might want a different structure
const createFailedRefundResponse = (data, reason = "Refund processing failed") => {
  return JSON.stringify({
    status: "failed",
    refund_id: data.id,
    failure_reason: reason,
    gateway_domain: data.domain,
    failed_at: new Date().toISOString()
  });
};

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

    console.log(parsedBody);
    event = parsedBody?.event;

    // Extract references based on event type
    if (event && event.startsWith("refund.")) {
      reference = parsedBody?.data?.transaction_reference;
    } else {
      reference = parsedBody?.data?.reference;
    }
    console.log(reference);

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
        stack: err.stack,
        event: event,
        reference: reference,
      });

      // Non-2xx makes Paystack retry the event; handlers are idempotent
      return res.status(500).json({
        success: false,
        message: "Webhook processing failed",
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
// Errors are rethrown so the webhook responds 500 and Paystack retries
const handleSuccessfulPayment = async (data) => {
  const { reference, channel, amount, customer } = data;

  console.log("Processing successful payment:", {
    reference,
    channel,
    amount: amount / 100, // Convert from kobo to naira
    customer_email: customer?.email,
  });

  const order = await withTransaction(async (client) => {
    // Check if payment exist
    const existingPayment = await client.query(
      "SELECT id FROM payment_logs WHERE payment_reference = $1 AND status = 'paid'",
      [reference]
    );

    if (existingPayment.rows.length > 0) {
      console.log("Payment already processed");
      return null;
    }

    // Update order status unless it's already paid or was cancelled/expired
    const updateQuery = `
      UPDATE orders
      SET
        status = 'paid',
        payment_method = $1,
        order_status = 'processing',
        updated_at = now()
      WHERE payment_ref = $2 AND status IN ('pending', 'failed') AND order_status <> 'cancelled'
      RETURNING *
    `;

    const result = await client.query(updateQuery, [channel, reference]);

    if (result.rows.length === 0) {
      await logUnappliedPayment(reference);
      return null;
    }

    const paidOrder = result.rows[0];

    console.log("Order updated:", {
      order_id: paidOrder.id,
      user_id: paidOrder.user_id,
      previous_status: "pending",
      new_status: paidOrder.status,
    });

    // Update Product Inventory
    await updateProductInventory(paidOrder.id, client);

    // Only clear cart if order was actually updated (was pending)
    // This prevents clearing cart if user already verified payment
    const cartClearResult = await client.query(
      `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)`,
      [paidOrder.user_id]
    );

    if (cartClearResult.rowCount > 0) {
      console.log(
        `Cleared ${cartClearResult.rowCount} items from cart for user ${paidOrder.user_id}`
      );
    } else {
      console.log("Cart was already empty or cleared");
    }

    // Log the payment transaction for audit trail
    await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (payment_reference, status) DO NOTHING`,
      [
        paidOrder.id,
        reference,
        "paid",
        amount / 100, // Convert from kobo to naira
        channel,
        "webhook",
        JSON.stringify(data.gateway_response) || "Payment successful",
      ]
    );

    // Update order status history
    await client.query(
      `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
      [paidOrder.id, "processing", "Payment verified, order is being processed"]
    );

    return paidOrder;
  });

  if (!order) return;

  // Create transporter
  const transporter = createTransporter();

  // Email options
  const mailOptions = {
    from: `E-commerce API <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: "Payment Confirmed - Your Order is Being Processed",
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <!-- Header -->
      <div style="text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #333; margin: 0;">✅ Payment Confirmed!</h1>
        <p style="color: #666; margin: 5px 0;">Your order is now being processed</p>
      </div>

      <!-- Greeting -->
      <p style="font-size: 16px;">Hi ${customer.name || "Valued Customer"},</p>
      <p>Great news! Your payment for order <strong>#${
        order.id
      }</strong> has been successfully confirmed. Your order is now being processed and will be prepared for shipment.</p>
      
      <!-- Success Banner -->
      <div style="background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
        <strong>🎉 Payment Successfully Processed</strong>
      </div>

      <!-- Order Details Card -->
      <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #28a745;">
        <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Payment & Order Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
            <td style="padding: 10px 0; color: #007bff; font-weight: bold;">#${
              order.id
            }</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Status:</td>
            <td style="padding: 10px 0;">
              <span style="background-color: #ffc107; color: #000; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
                ${order.order_status.toUpperCase()}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Reference:</td>
            <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${
              order.payment_ref
            }</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Method:</td>
            <td style="padding: 10px 0; text-transform: capitalize;">${
              order.payment_method
            }</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Amount Paid:</td>
            <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
              ₦${(amount / 100).toLocaleString()}
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Date:</td>
            <td style="padding: 10px 0;">${new Date().toLocaleDateString(
              "en-US",
              {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }
            )}</td>
          </tr>
        </table>
      </div>

      <!-- Next Steps -->
      <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
        <h3 style="margin-top: 0; color: #2c5aa0;">📦 What Happens Next?</h3>
        <ol style="padding-left: 20px; line-height: 1.6;">
          <li><strong>Order Processing</strong> - We're preparing your items for shipment</li>
          <li><strong>Quality Check</strong> - Each item is carefully inspected</li>
          <li><strong>Packaging</strong> - Your order will be securely packaged</li>
          <li><strong>Shipping</strong> - You'll receive tracking information via email</li>
          <li><strong>Delivery</strong> - Your order will arrive at your specified address</li>
        </ol>
        <p style="margin-bottom: 0; font-size: 14px; color: #666;">
          <strong>Estimated processing time:</strong> 1-2 business days
        </p>
      </div>

      <!-- Track Order Section -->
      <div style="text-align: center; margin: 30px 0;">
        <p>Want to track your order?</p>
        <a href="${process.env.BASE_URL}/v1/order/${order.id}/history" 
          style="display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
          Track Your Order
        </a>
      </div>

      <!-- Support Section -->
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
        <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
        <p style="margin-bottom: 10px;">Our customer support team is here to help:</p>
        <ul style="list-style: none; padding-left: 0;">
          <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${process.env.EMAIL_USER}</li>
          <li style="margin: 8px 0;">📞 <strong>Phone:</strong> ${process.env.SUPPORT_PHONE || '+234-XXX-XXXX-XXX'}</li>
          <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
        </ul>
        <p style="font-size: 14px; color: #666; margin-bottom: 0;">
          Please reference Order ID <strong>#${
            order.id
          }</strong> when contacting support.
        </p>
      </div>

      <!-- Social Media & Reviews -->
      <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #fff3cd; border-radius: 8px;">
        <h4 style="margin-top: 0;">Love your purchase? 💝</h4>
        <p style="margin-bottom: 15px;">Share your experience and help others discover great products!</p>
        <div style="margin: 15px 0;">
          <a href="#" style="text-decoration: none; margin: 0 10px; font-size: 24px;">📘</a>
          <a href="#" style="text-decoration: none; margin: 0 10px; font-size: 24px;">📷</a>
          <a href="#" style="text-decoration: none; margin: 0 10px; font-size: 24px;">🐦</a>
        </div>
      </div>

      <!-- Footer -->
      <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
        <p style="font-size: 18px; margin-bottom: 10px;">Thank you for shopping with us! 🛍️</p>
        <p style="color: #666; margin-bottom: 20px;">
          Best regards,<br>
          <strong>The E-commerce API Team</strong>
        </p>
        
        <!-- Email Footer -->
        <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
          <p>This email was sent to <strong>${customer.email}</strong></p>
          <p>© 2024 E-commerce API. All rights reserved.</p>
          <p>If you have any concerns about this transaction, please contact us immediately.</p>
        </div>
      </div>
    </div>
  `,
  };

  // Send email
  try {
    await transporter.sendMail(mailOptions);
    console.log("Payment Confirmation Email sent successfully");
  } catch (emailError) {
    console.log("Email sending failed:", emailError.message);
  }
};

// Failed payment handler
const handleFailedPayment = async (data) => {
  const { reference, gateway_response, customer } = data;

  console.log(" ❌ Processing failed payment:", {
    reference,
    reason: gateway_response,
    customer_email: customer?.email,
  });

  await withTransaction(async (client) => {
    // Update order status to failed only if it's still pending
    const updateQuery = `
            UPDATE orders
            SET
                status = 'failed',
                updated_at = now()
            WHERE payment_ref = $1 AND status = 'pending'
            RETURNING *
        `;

    const result = await client.query(updateQuery, [reference]);

    if (result.rows.length === 0) {
      console.log(
        "No pending order found for failed payment reference:",
        reference
      );
      return;
    }

    const order = result.rows[0];
    console.log(`Order ${order.id} marked as failed`);

    // Log the failed payment
    await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (payment_reference, status) DO NOTHING`,
      [order.id, reference, "failed", gateway_response, "webhook"]
    );

    // Update order status history
    await client.query(
      `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
      [order.id, "failed", `Payment verification failed`]
    );
  });
};

// A successful charge that couldn't be applied to a pending order. If the order
// was cancelled or expired, the customer has paid for nothing and needs a refund.
const logUnappliedPayment = async (reference) => {
  const existing = await db.query(
    "SELECT id, status, order_status FROM orders WHERE payment_ref = $1",
    [reference]
  );
  const order = existing.rows[0];

  if (order && order.order_status === "cancelled" && order.status !== "paid") {
    console.error(
      `REFUND REQUIRED: payment ${reference} received for cancelled order ${order.id}`
    );
  } else {
    console.log("No pending order found for reference:", reference);
    console.log("This might mean payment was already verified by user");
  }
};

// Errors are rethrown so the webhook responds 500 and Paystack retries
const handleSuccessfulRefund = async (data) => {
  const { transaction_reference: reference, amount, customer, refund_reference, id: refund_id } = data;

  console.log("Processing successful refund:", {
    reference,
    amount: amount / 100, // Convert from kobo to naira
    customer_email: customer?.email,
    refund_reference: refund_reference || `refund-${refund_id}`,
  });

  const order = await withTransaction(async (client) => {
    // Orders already refunded don't match, so a repeated event does nothing
    const updateQuery = `
      UPDATE orders
      SET
          status = 'refunded',
          updated_at = now()
      WHERE payment_ref = $1 AND order_status = 'cancelled' AND status <> 'refunded'
      RETURNING *
    `;

    const result = await client.query(updateQuery, [reference]);

    if (result.rows.length === 0) return null;

    const refundedOrder = result.rows[0];
    const gatewayResponse = createMinimalGatewayResponse(data);

    console.log(`Order refund processed:`, {
      order_id: refundedOrder.id,
      user_id: refundedOrder.user_id,
      previous_status: "cancelled",
      new_status: "refunded",
    });

    // Log the refund for audit trail
    await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now()) ON CONFLICT (payment_reference, status) DO NOTHING`,
      [
        refundedOrder.id,
        reference,
        "refunded",
        amount / 100,
        refundedOrder.payment_method,
        "webhook",
        gatewayResponse,
      ]
    );

    // Update order status history
    await client.query(
      `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
      [
        refundedOrder.id,
        "refunded",
        `Payment was refunded to ${customer.email} with reference ${refund_id}`,
      ]
    );

    return refundedOrder;
  });

  if (!order) {
    console.log("No cancelled order found for refund reference:", reference);
    console.log("This might mean the order was already refunded or not in a cancelled state");
    return;
  }

  // Create transporter
  const transporter = createTransporter();
  
  // Send refund email
   const mailOptions = {
    from: `E-commerce API <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: "Refund Processed - Your Money is on the Way!",
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <!-- Header -->
      <div style="text-align: center; border-bottom: 2px solid #28a745; padding-bottom: 20px; margin-bottom: 30px;">
        <h1 style="color: #28a745; margin: 0;">✅ Refund Processed!</h1>
        <p style="color: #666; margin: 5px 0;">Your refund has been successfully processed</p>
      </div>

      <!-- Greeting -->
      <p style="font-size: 16px;">Hi ${customer?.name || "Valued Customer"},</p>
      <p>Great news! Your refund for order <strong>#${order.id}</strong> has been successfully processed and is on its way back to your account.</p>
      
      <!-- Success Banner -->
      <div style="background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
        <strong>💰 Refund Successfully Processed</strong>
      </div>

      <!-- Refund Details Card -->
      <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #28a745;">
        <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Refund Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
            <td style="padding: 10px 0; color: #007bff; font-weight: bold;">#${order.id}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Original Payment Reference:</td>
            <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${order.payment_ref}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Refund ID:</td>
            <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${refund_id}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Refund Amount:</td>
            <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
              ₦${(amount / 100).toLocaleString()}
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0; font-weight: bold; color: #555;">Processing Date:</td>
            <td style="padding: 10px 0;">${new Date().toLocaleDateString("en-US", {
              year: "numeric",
              month: "long", 
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}</td>
          </tr>
        </table>
      </div>

      <!-- Timeline Section -->
      <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
        <h3 style="margin-top: 0; color: #2c5aa0;">⏰ When Will You Receive Your Refund?</h3>
        <div style="line-height: 1.8;">
          <p style="margin: 10px 0;"><strong>💳 Card Payments:</strong> 3-5 business days</p>
          <p style="margin: 10px 0;"><strong>🏦 Bank Transfers:</strong> 1-3 business days</p>
          <p style="margin: 10px 0;"><strong>📱 Mobile Money:</strong> 1-2 business days</p>
        </div>
        <p style="font-size: 14px; color: #666; margin-bottom: 0;">
          <strong>Note:</strong> Processing times may vary depending on your bank or payment provider.
        </p>
      </div>

      <!-- Important Information -->
      <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 25px 0;">
        <h4 style="margin-top: 0; color: #856404;">📋 Important Information</h4>
        <ul style="margin: 10px 0; padding-left: 20px; color: #856404;">
          <li>The refund will be credited to the same payment method used for the original purchase</li>
          <li>You'll see the transaction appear as "Refund - Order #${order.id}" in your statement</li>
          <li>If you don't see the refund after the expected timeframe, please contact your bank first</li>
        </ul>
      </div>

      <!-- Support Section -->
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
        <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
        <p style="margin-bottom: 10px;">Our customer support team is here to help:</p>
        <ul style="list-style: none; padding-left: 0;">
          <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${process.env.EMAIL_USER}</li>
          <li style="margin: 8px 0;">📞 <strong>Phone:</strong> ${process.env.SUPPORT_PHONE || '+234-XXX-XXXX-XXX'}</li>
          <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
        </ul>
        <p style="font-size: 14px; color: #666; margin-bottom: 0;">
          Please reference Order ID <strong>#${order.id}</strong> and Refund ID <strong>${refund_id}</strong> when contacting support.
        </p>
      </div>

      <!-- Footer -->
      <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
        <p style="font-size: 18px; margin-bottom: 10px;">Thank you for your understanding! 🙏</p>
        <p style="color: #666; margin-bottom: 20px;">
          We're sorry to see you go, but we're here whenever you're ready to shop again.<br>
          <strong>The E-commerce API Team</strong>
        </p>
        
        <!-- Email Footer -->
        <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
          <p>This email was sent to <strong>${customer.email}</strong></p>
          <p>© 2024 E-commerce API. All rights reserved.</p>
          <p>If you have any concerns about this refund, please contact us immediately.</p>
        </div>
      </div>
    </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Refund email sent successfully");
  } catch (emailErr) {
    console.error("Error sending refund email:", emailErr);
  }
};

// Log a refund event once, even if Paystack delivers it more than once
const recordRefundEvent = async (reference, logFields, note) => {
  await withTransaction(async (client) => {
    const orderResult = await client.query(
      "SELECT id FROM orders WHERE payment_ref = $1",
      [reference]
    );

    if (orderResult.rows.length === 0) return;

    const orderId = orderResult.rows[0].id;
    const { status, failureReason = null } = logFields;

    // Log the refund for audit trail
    const logged = await client.query(
      `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (payment_reference, status) DO NOTHING
      RETURNING id`,
      [orderId, reference, status, failureReason, "webhook"]
    );

    if (logged.rows.length === 0) return;

    // Update order status history
    await client.query(
      `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
      [orderId, status, note]
    );
  });
};

// Handle failed refund
const handleFailedRefund = async (data) => {
  const { transaction_reference: reference, customer } = data;

  console.log("Processing failed refund:", {
    reference,
    customer_email: customer?.email,
  });

  await recordRefundEvent(
    reference,
    { status: "refund_failed", failureReason: createFailedRefundResponse(data) },
    "Refund processing failed"
  );
};

// Handle pending refund
const handlePendingRefund = async (data) => {
  const { transaction_reference: reference, customer } = data;

  console.log("Processing pending refund:", {
    reference,
    customer_email: customer?.email,
  });

  await recordRefundEvent(reference, { status: "refund_pending" }, "Refund is pending");
};

// Landing page after Paystack checkout. Display only: the webhook confirms payments
export const paymentCallback = async (req, res) => {
  try {
    const { reference } = req.query;
    const result =
      typeof reference === "string"
        ? await db.query("SELECT status FROM orders WHERE payment_ref = $1", [reference])
        : { rows: [] };

    const paid = result.rows[0]?.status === "paid";
    const heading = paid ? "Payment confirmed" : "Your payment is being confirmed";
    const message = paid
      ? "Thank you! Your order is now being processed."
      : "We'll email you as soon as your payment is confirmed. You can safely close this page.";

    res.type("html").send(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>${heading}</title>
        </head>
        <body style="font-family: Arial, sans-serif; max-width: 400px; margin: 40px auto; padding: 0 16px; text-align: center;">
          <h2 style="color: #333;">${heading}</h2>
          <p style="color: #666;">${message}</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Error showing payment callback:", err);
    res.status(500).type("html").send("<p>Something went wrong. Please check your email for your order status.</p>");
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

    // Payment details are private and change as webhooks arrive
    res.set("Cache-Control", "private, no-store");

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
  // Opt-in: only enabled when NODE_ENV is explicitly set to a non-production value
  if (!["development", "test"].includes(process.env.NODE_ENV)) {
    return res.status(403).json({
      success: false,
      message: "Test webhook is only available in development",
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
    });
  }
};
