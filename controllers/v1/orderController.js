import axios from "axios";

import db from "../../config/db.js";
import { updateProductInventory } from "./paymentController.js";
import createTransporter from "../../utils/email.js";

// create order
export const createOrder = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const userId = req.user.id;
    const { shipping_address_id } = req.body;

    if (!shipping_address_id) {
      return res.status(400).json({
        success: false,
        message: "Shipping Address is required!",
      });
    }

    // Check shipping_address_id exist for user
    const checkAddress = await client.query(
      "SELECT * FROM addresses WHERE id =$1 AND user_id = $2",
      [shipping_address_id, userId]
    );

    if (checkAddress.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "User shipping address not found",
      });
    }

    // check if user has a cart with items inside
    const cartQuery = `
            SELECT
            ci.product_id,
            ci.quantity,
            p.price,
            p.name,
            p.inventory_qty as stock_quantity,
            (ci.quantity * p.price) as subtotal
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            JOIN carts c ON ci.cart_id = c.id
            WHERE c.user_id = $1
        `;

    const cartResult = await client.query(cartQuery, [userId]);

    if (cartResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
      });
    }

    console.log(cartResult.rows);

    // Check stock availability
    const outOfStockItems = cartResult.rows.filter(item => item.quantity > item.stock_quantity);

    if (outOfStockItems.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Some items are out of stock",
        data: {
          out_of_stock_items: outOfStockItems.map(item => ({
            product_id: item.product_id,
            name: item.name,
            requested: item.quantity,
            available: item.stock_quantity
          }))
        }
      });
    }

    // calculate order total
    const total = cartResult.rows.reduce(
      (sum, item) => sum + parseInt(item.subtotal),
      0
    );

    // Create order
    const orderQuery = `
        INSERT INTO orders (user_id, total, shipping_address_id) VALUES ($1, $2, $3) RETURNING *;
    `;

    const orderResult = await client.query(orderQuery, [
      userId,
      total,
      shipping_address_id,
    ]);

    const order = orderResult.rows[0];

    // Create order_items
    const orderItemsQuery = `
        INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4);
    `;

    for (const item of cartResult.rows) {
      await client.query(orderItemsQuery, [
        order.id,
        item.product_id,
        item.quantity,
        item.price,
      ]);
    }

    // Log order creation history
    await client.query(
      `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, 'pending', 'Order created')`,
      [order.id]
    );

    // Generate unique payment reference
    const paymentReference = `order-${order.id}-${Date.now()}`;

    // Initialize paystack payment
    const paymentData = {
      email: req.user.email,
      amount: total * 100, // convert to kobo
      reference: paymentReference,
      callback_url: `${process.env.BASE_URL}/payment/callback?reference=${paymentReference}`,
      metadata: {
        order_id: order.id,
        user_id: userId,
        custom_fields: [
          {
            display_name: "Order Number",
            variable_name: "order_number",
            value: order.id.toString(),
          },
          {
            display_name: "Customer",
            variable_name: "customer_name",
            value: req.user.name,
          },
          {
            display_name: "Items",
            variable_name: "item_count",
            value: `${cartResult.rows.length} items`,
          },
          {
            display_name: "Shipping",
            variable_name: "shipping_address",
            value: `${checkAddress.rows[0].city}, ${checkAddress.rows[0].country}`,
          },
        ],
      },
    };

    try {
      const paymentResponse = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        paymentData,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 seconds timeout
        }
      );

      console.log("Paystack initialization response:", paymentResponse.data);

      if (!paymentResponse.data.status) {
        await client.query("ROLLBACK");
        return res.status(500).json({
          success: false,
          message: "Failed to initialize payment",
          error: paymentResponse.data.message || "Unknown payment error",
        });
      }

      // update order with payment_reference
      await client.query("UPDATE orders SET payment_ref = $1 WHERE id = $2", [
        paymentReference,
        order.id,
      ]);

      // Commit transaction
      await client.query("COMMIT");

      // Add this after committing the transaction in createOrder
      const transporter = createTransporter();

      const mailOptions = {
        from: `E-commerce API <${process.env.EMAIL_USER}>`,
        to: req.user.email,
        subject: "Order Confirmation - Complete Your Payment",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <!-- Header -->
            <div style="text-align: center; border-bottom: 2px solid #007bff; padding-bottom: 20px; margin-bottom: 30px;">
              <h1 style="color: #333; margin: 0;">📦 Order Confirmation</h1>
              <p style="color: #666; margin: 5px 0;">Your order has been received and is awaiting payment</p>
            </div>

            <!-- Greeting -->
            <p style="font-size: 16px;">Hi ${req.user.name || "Valued Customer"},</p>
            <p>Thank you for your order! We've received your order details and reserved your items. Please complete your payment to secure your purchase.</p>
            
            <!-- Payment Alert Banner -->
            <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <strong>⏰ Payment Required</strong><br>
              <span style="font-size: 14px;">Complete your payment within 24 hours to secure your order</span>
            </div>

            <!-- Order Details Card -->
            <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #007bff;">
              <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Order Details</h3>
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
                      PENDING PAYMENT
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Date:</td>
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
                <tr>
                  <td style="padding: 10px 0; font-weight: bold; color: #555;">Total Amount:</td>
                  <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
                    ₦${total.toLocaleString()}
                  </td>
                </tr>
              </table>
            </div>

            <!-- Items Ordered Section -->
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
              <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Items Ordered</h3>
              <div style="max-height: 300px; overflow-y: auto;">
                ${cartResult.rows
                  .map(
                    (item) => `
                      <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #eee;">
                        <div style="flex: 1;">
                          <strong style="color: #333;">${item.name}</strong><br>
                          <span style="color: #666; font-size: 14px;">Quantity: ${
                            item.quantity
                          }</span>
                        </div>
                        <div style="text-align: right; font-weight: bold; color: #007bff;">
                          ₦${(item.price * item.quantity).toLocaleString()}
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
              
              <!-- Order Summary -->
              <div style="margin-top: 20px; padding-top: 15px; border-top: 2px solid #007bff;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <strong style="font-size: 16px;">Total:</strong>
                  <strong style="font-size: 18px; color: #28a745;">₦${total.toLocaleString()}</strong>
                </div>
              </div>
            </div>

            <!-- Payment Link Section -->
            <div style="background-color: #e8f4f8; padding: 25px; border-radius: 10px; margin: 25px 0; text-align: center; border: 2px dashed #007bff;">
              <h3 style="color: #2c5aa0; margin-top: 0;">💳 Complete Your Payment</h3>
              <p style="margin-bottom: 20px; color: #555;">Click the button below to complete your payment securely with Paystack:</p>
              <a href="${paymentResponse.data.data.authorization_url}" 
                style="display: inline-block; background-color: #007bff; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 10px 0; font-size: 16px; transition: background-color 0.3s;">
                🔒 Pay Securely - ₦${total.toLocaleString()}
              </a>
              <div style="margin-top: 15px; padding: 10px; background-color: #fff; border-radius: 5px;">
                <p style="font-size: 12px; color: #666; margin: 0;">
                  🛡️ <strong>Secure Payment:</strong> Your payment is protected by 256-bit SSL encryption<br>
                  ⏰ <strong>Expires:</strong> This payment link will expire in 24 hours
                </p>
              </div>
            </div>

            <!-- Important Information -->
            <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 8px; margin: 25px 0;">
              <h4 style="margin-top: 0; color: #0c5460;">📋 Important Information</h4>
              <ul style="margin: 10px 0; padding-left: 20px; color: #0c5460; line-height: 1.6;">
                <li>Your items have been reserved and will be held for 24 hours</li>
                <li>You'll receive a payment confirmation email once payment is completed</li>
                <li>Your order will be processed immediately after payment confirmation</li>
                <li>Estimated processing time: 1-2 business days after payment</li>
              </ul>
            </div>

            <!-- Support Section -->
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
              <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
              <p style="margin-bottom: 10px;">Our customer support team is here to help:</p>
              <ul style="list-style: none; padding-left: 0;">
                <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${
                  process.env.EMAIL_USER
                }</li>
                <li style="margin: 8px 0;">📞 <strong>Phone:</strong> +234-XXX-XXXX-XXX</li>
                <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
              </ul>
              <p style="font-size: 14px; color: #666; margin-bottom: 0;">
                Please reference Order ID <strong>#${
                  order.id
                }</strong> when contacting support.
              </p>
            </div>

            <!-- Track Order Section -->
            <div style="text-align: center; margin: 30px 0;">
              <p>Want to track your order?</p>
              <a href="${process.env.BASE_URL}/v1/order/${order.id}/history" 
                style="display: inline-block; background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                📍 Track Your Order
              </a>
            </div>

            <!-- Footer -->
            <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
              <p style="font-size: 18px; margin-bottom: 10px;">Thank you for choosing us! 🛍️</p>
              <p style="color: #666; margin-bottom: 20px;">
                Best regards,<br>
                <strong>The E-commerce API Team</strong>
              </p>
              
              <!-- Email Footer -->
              <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
                <p>This email was sent to <strong>${req.user.email}</strong></p>
                <p>© 2024 E-commerce API. All rights reserved.</p>
                <p>If you didn't place this order, please contact us immediately.</p>
              </div>
            </div>
          </div>
        `,
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log("Order confirmation email sent");
      } catch (emailError) {
        console.log("Order confirmation email failed:", emailError.message);
        // Don't fail the order creation due to email issues
      }

      res.status(201).json({
        success: true,
        data: {
          order_id: order.id,
          payment_url: paymentResponse.data.data.authorization_url,
          reference: paymentReference,
          amount: total,
        },
      });
    } catch (paymentError) {
      console.error("Paystack payment initialization error:", paymentError);
      // Rollback transaction on payment error
      await client.query("ROLLBACK");

      return res.status(500).json({
        success: false,
        message: "Failed to initialize payment",
        error: paymentError.response?.data?.message || paymentError.message,
      });
    }
  } catch (err) {
    console.log("Create order error", err);

    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback error:", rollbackError);
    }

    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: err.message,
    });
  } finally {
    client.release();
  }
};

// verify payment (user)
export const verifyPayment = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { reference } = req.params;
    const userId = req.user.id;

    if (!reference || typeof reference !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid payment reference",
      });
    }

    // Check if user has an order with the payment reference
    const orderCheck = await client.query(
      "SELECT * FROM orders WHERE payment_ref = $1 AND user_id = $2",
      [reference, userId]
    );

    if (orderCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Payment not found or access denied",
      });
    }

    const order = orderCheck.rows[0];

    // Check if payment has already been verified
    if (order.status === "paid") {
      await client.query("COMMIT");
      return res.status(200).json({
        success: true,
        message: 'Payment has already been verified',
        data: {
          order: order,
          payment_status: "paid",
          payment_method: order.payment_method,
          verified_at: order.updated_at,
          verified_by: "webhook"
        }
      })
    }

    // Verify payment with paystack using axios
    try {
      const verificationResponse = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 seconds timeout
        }
      );

      console.log("Paystack verification response:", verificationResponse.data);

      if (!verificationResponse.data.status) {
        await client.query("ROLLBACK");
        return res.status(500).json({
          success: false,
          message: "Payment verification failed",
          error:
            verificationResponse.data.message || "Unknown verification error",
        });
      }

      const data = verificationResponse.data.data;
      const paymentStatus = data.status === "success" ? "paid" : "failed";
      const paymentMethod = data.channel;

      // update order status
      const updateQuery = `
      UPDATE orders
      SET
        status = $1, 
        payment_method = $2,
        order_status = CASE WHEN $1 = 'paid' THEN 'processing' ELSE order_status END, 
        updated_at = now()
      WHERE payment_ref = $3
      RETURNING *
    `;

      const result = await client.query(updateQuery, [
        paymentStatus,
        paymentMethod,
        reference,
      ]);

      const updatedOrder = result.rows[0];

      if (paymentStatus === "paid") {
        // Update Product Inventory
        try {
          await updateProductInventory(updatedOrder.id);
          console.log("Inventory updated successfully");
        } catch (inventoryError) {
          console.log("Inventory update failed:", inventoryError.message);
        }

        // Delete cart items
        await client.query(
          `
            DELETE FROM cart_items 
            WHERE cart_id IN (SELECT id from carts WHERE user_id = $1)
          `,
          [userId]
        );

        console.log("Cleared cart");

        // Log the payment transaction for audit trail
        await client.query(
          `
            INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
            ON CONFLICT (payment_reference) DO NOTHING
          `,
          [
            updatedOrder.id,
            reference,
            paymentStatus,
            updatedOrder.total,
            paymentMethod,
            "user",
            JSON.stringify(data.gateway_response) || "Payment successful",
          ]
        );

        console.log("Payment transaction logged");

        // Update order status history
        await client.query(
          `
            INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)
          `,
          [
            updatedOrder.id,
            "processing",
            "Payment verified and order is being processed",
          ]
        );

        console.log("Order status history updated");

        // Send Payment Confirmation Email
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
          <p style="font-size: 16px;">Hi ${
            req.user.name || "Valued Customer"
          },</p>
          <p>Great news! Your payment for order <strong>#${
            updatedOrder.id
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
                  updatedOrder.id
                }</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Status:</td>
                <td style="padding: 10px 0;">
                  <span style="background-color: #ffc107; color: #000; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
                    ${updatedOrder.order_status.toUpperCase()}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Reference:</td>
                <td style="padding: 10px 0; font-family: monospace; background-color: #e9ecef; padding: 5px 8px; border-radius: 4px;">${reference}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #555;">Payment Method:</td>
                <td style="padding: 10px 0; text-transform: capitalize;">${paymentMethod}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #555;">Amount Paid:</td>
                <td style="padding: 10px 0; font-size: 18px; color: #28a745; font-weight: bold;">
                  ₦${updatedOrder.total.toLocaleString()}
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
            <a href="${process.env.BASE_URL}/v1/order/${updatedOrder.id}/history" 
              style="display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Track Your Order
            </a>
          </div>

          <!-- Support Section -->
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
            <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
            <p style="margin-bottom: 10px;">Our customer support team is here to help:</p>
            <ul style="list-style: none; padding-left: 0;">
              <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${
                process.env.EMAIL_USER
              }</li>
              <li style="margin: 8px 0;">📞 <strong>Phone:</strong> +234-XXX-XXXX-XXX</li>
              <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
            </ul>
            <p style="font-size: 14px; color: #666; margin-bottom: 0;">
              Please reference Order ID <strong>#${
                updatedOrder.id
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
              <p>This email was sent to <strong>${req.user.email}</strong></p>
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
      } else {
        // Log the failed payment
        await client.query(
          `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
          [
            updatedOrder.id,
            reference,
            paymentStatus,
            data.gateway_response || "Payment failed",
            "user",
          ]
        );

        // Add failure entry to order history
        await client.query(
          `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
          [updatedOrder.id, "failed", "Payment verification failed"]
        );
      }

      // Commit transaction
      await client.query("COMMIT");
      console.log("Transaction committed successfully");

      res.status(200).json({
        success: true,
        data: {
          order: result.rows[0],
          payment_status: paymentStatus,
          payment_method: paymentMethod,
          verified_at: new Date().toISOString(),
          verified_by: "user"
        },
      });
    } catch (verificationError) {
      await client.query("ROLLBACK");
      console.error(
        "Paystack verification error:",
        verificationError.response?.data || verificationError.message
      );
      return res.status(500).json({
        success: false,
        message: "Payment verification failed",
        error:
          verificationError.response?.data?.message ||
          verificationError.message,
      });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.log("Verify payment error", err);
    res.status(500).json({
      success: false,
      message: "Payment Verification failed",
      error: err.message,
    });
  } finally {
    client.release();
  }
};

// get all user orders
export const getOrders = async (req, res) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const userId = req.user.id;

    const ordersQuery = `
      SELECT
        o.*,
        a.phone, a.line1, a.city, a.postal_code, a.country,
        COUNT (oi.id) as item_count,
        SUM (oi.quantity * oi.price) as total
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      WHERE o.user_id = $1
      GROUP BY o.id, a.phone, a.line1, a.city, a.postal_code, a.country
      ORDER BY o.placed_at DESC
    `;

    const orders = await client.query(ordersQuery, [userId]);

    if (orders.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No orders found",
      });
    }

    // Commit transaction
    await client.query("COMMIT");

    res.status(200).json({
      success: true,
      data: orders.rows,
    });
  } catch (err) {
    console.log("Error getting orders", err);
    await client.query("ROLLBACK");
    res.status(500).json({
      success: false,
      message: "Error getting orders",
      error: err.message,
    });
  }
};

// get single order
export const getOrder = async (req, res) => {
  try {
    const id = req.params.id;
    const userId = req.user.id;

    if (!id || typeof id !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const orderQuery = `
      SELECT
        o.*,
        a.phone,a.line1, a.city, a.postal_code, a.country
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      WHERE o.id = $1 AND o.user_id = $2
    `;

    const orderResult = await db.query(orderQuery, [id, userId]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orderResult.rows[0];

    // get order items
    const itemsQuery = `
      SELECT
        oi.*,
        p.name as product_name, p.images
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `;

    const items = await db.query(itemsQuery, [id]);
    order.items = items.rows;

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (err) {
    console.log("Error getting order", err);
    res.status(500).json({
      success: false,
      message: "Error getting order",
      error: err.message,
    });
  }
};

// get order history
export const getOrderHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    // Check if order exists for the user
    const orderCheck = await db.query(
      `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
      [orderId, userId]
    );

    if (orderCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Fetch order status history
    const orderHistoryQuery = await db.query(
      `SELECT status, notes, created_at FROM order_status_history WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId]
    );

    res.status(200).json({
      success: true,
      data: orderHistoryQuery.rows,
    });
  } catch (err) {
    console.log("Error fetching order history", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order history",
      error: err.message,
    });
  }
}

// cancel order
export const cancelOrder = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { orderId } = req.params;
    const userId = req.user.id;

    // Check if order belongs to user
    const orderQuery = await client.query(
      `SELECT 
        o.*, u.email, u.name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1 AND o.user_id = $2
      `,
      [orderId, userId]
    );

    if (orderQuery.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Order not found or access denied",
      });
    }

    const order = orderQuery.rows[0];

    // Check if order can be cancelled
    if (!["pending", "processing"].includes(order.order_status)) {
      return res.status(400).json({
        success: false,
        message:
          "Order cannot be cancelled. It is already shipped, delivered or cancelled.",
      });
    }

    let refundProcessed = false;
    let refundError = null;
    let refundData = null;

    // Handle refund if payment was made
    if (order.status === "paid" && order.payment_ref) {
      try {
        const response = await axios.post(
          "https://api.paystack.co/refund",
          {
            transaction: order.payment_ref,
            amount: order.total * 100, // Convert to kobo
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 30000, // 30 seconds timeout
          }
        );
        const result = response.data;

        if (
          result.status &&
          ["pending", "processed"].includes(result.data.status)
        ) {
          refundProcessed = true;
          refundData = result.data;
          console.log("Refund initiated successfully:", result.data);
        } else {
          console.log("Refund failed:", result);
          refundError = result;
        }
      } catch (paystackError) {
        console.log("Error processing refund", paystackError);

        if (paystackError.response && paystackError.response.status === 400) {
          const errorData = paystackError.response.data;

          if (
            errorData.code === "transaction_reversed" &&
            errorData.message === "Transaction has been fully reversed"
          ) {
            refundProcessed = true;
            refundData = {
              status: "already_processed",
              message: errorData.message,
            };
            console.log("Transaction already fully reversed: ", errorData);
          } else {
            console.log("Paystack refund error: ", errorData);
            refundError = errorData;
          }
        } else {
          return res.status(500).json({
            success: false,
            message: "Failed to process refund",
            error: paystackError.message,
          });
        }
      }
    }

    // Update order status to cancelled
    await client.query(
      `UPDATE orders SET order_status = $1, updated_at = NOW() WHERE id = $2`,
      ["cancelled", orderId]
    );

    // Log status change in order_status_history
    await client.query(
      `INSERT INTO order_status_history (order_id, status, notes, created_at) VALUES ($1, $2, $3, NOW())`,
      [orderId, "cancelled", `Order cancelled by user`]
    );

    // Restore product stock
    const itemsQuery = await client.query(
      `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    for (const item of itemsQuery.rows) {
      const productExists = await client.query(
        "SELECT id FROM products WHERE id = $1",
        [item.product_id]
      );

      if (productExists.rows.length > 0) {
        await client.query(
          `UPDATE products SET inventory_qty = inventory_qty + $1 WHERE id=$2`,
          [item.quantity, item.product_id]
        );
      }
    }

    // Commit transaction
    await client.query("COMMIT");

    // Create transporter
    const transporter = createTransporter();

    // Email notification
    let refundMessage = "";
    let refundStatusBadge = "";
    let refundIcon = "";

    if (refundProcessed) {
      if (refundData.status === "processed") {
        refundIcon = "✅";
        refundStatusBadge = `<span style="background-color: #d4edda; color: #155724; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">REFUND PROCESSED</span>`;
        refundMessage = `
          <div style="background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>💰 Refund Successfully Processed</strong>
            <p style="margin: 10px 0 0 0;">Your refund has been processed successfully and should reflect in your account within 1-3 working days depending on your bank.</p>
          </div>`;
      } else if (refundData.status === "pending") {
        refundIcon = "⏳";
        refundStatusBadge = `<span style="background-color: #fff3cd; color: #856404; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">REFUND PENDING</span>`;
        refundMessage = `
          <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>⏳ Refund In Progress</strong>
            <p style="margin: 10px 0 0 0;">A refund has been initiated and is being processed. You should receive your refund within 5-7 working days.</p>
          </div>`;
      } else if (refundData.status === "already_processed") {
        refundIcon = "✅";
        refundStatusBadge = `<span style="background-color: #d4edda; color: #155724; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">ALREADY REFUNDED</span>`;
        refundMessage = `
          <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>ℹ️ Refund Already Processed</strong>
            <p style="margin: 10px 0 0 0;">This transaction was already fully reversed. If you don't see the refund in your account, please contact your bank.</p>
          </div>`;
      } else {
        refundIcon = "🔄";
        refundStatusBadge = `<span style="background-color: #e2e3e5; color: #383d41; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">PROCESSING</span>`;
        refundMessage = `
          <div style="background-color: #e2e3e5; border: 1px solid #d6d8db; color: #383d41; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong>🔄 Refund Being Processed</strong>
            <p style="margin: 10px 0 0 0;">Your refund is being processed and will be completed within 5-7 working days.</p>
          </div>`;
      }
    } else if (refundError) {
      refundIcon = "⚠️";
      refundStatusBadge = `<span style="background-color: #f8d7da; color: #721c24; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">MANUAL PROCESSING</span>`;
      refundMessage = `
        <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <strong>⚠️ Refund Requires Manual Processing</strong>
          <p style="margin: 10px 0;">We encountered a technical issue while processing your refund automatically. Don't worry - your refund is guaranteed!</p>
          
          <div style="background-color: #fff; padding: 15px; border-radius: 5px; margin: 10px 0;">
            <h4 style="margin-top: 0; color: #721c24;">📋 Next Steps:</h4>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Our support team has been notified and will process your refund manually</li>
              <li>You'll receive your refund within 2-3 business days</li>
              <li>If you don't see the refund by then, please contact us with your order ID</li>
            </ul>
          </div>
          
          <p style="margin: 10px 0 0 0;">We apologize for any inconvenience this may cause.</p>
        </div>`;
    } else {
      refundIcon = "ℹ️";
      refundStatusBadge = `<span style="background-color: #d1ecf1; color: #0c5460; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">NO PAYMENT</span>`;
      refundMessage = `
        <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <strong>ℹ️ No Refund Required</strong>
          <p style="margin: 10px 0 0 0;">Since no payment was made for this order, no refund is required. Your order has been cancelled successfully.</p>
        </div>`;
    }

    const mailOptions = {
      from: `E-Commerce API <${process.env.EMAIL_USER}>`,
      to: order.email,
      subject: "Order Cancellation Confirmed",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <!-- Header -->
          <div style="text-align: center; border-bottom: 2px solid #dc3545; padding-bottom: 20px; margin-bottom: 30px;">
            <h1 style="color: #dc3545; margin: 0;">❌ Order Cancelled</h1>
            <p style="color: #666; margin: 5px 0;">Your order has been successfully cancelled</p>
          </div>

          <!-- Greeting -->
          <p style="font-size: 16px;">Dear ${order.name || "Valued Customer"},</p>
          <p>Your order cancellation request has been processed successfully. We're sorry to see you go, but we understand that plans can change.</p>

          <!-- Order Details Card -->
          <div style="background-color: #f8f9fa; padding: 25px; border-radius: 10px; margin: 25px 0; border-left: 4px solid #dc3545;">
            <h3 style="margin-top: 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Cancelled Order Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #555;">Order ID:</td>
                <td style="padding: 10px 0; color: #dc3545; font-weight: bold;">#${
                  order.id
                }</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #555;">Order Status:</td>
                <td style="padding: 10px 0;">
                  <span style="background-color: #dc3545; color: white; padding: 4px 12px; border-radius: 15px; font-size: 12px; font-weight: bold;">
                    CANCELLED
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #555;">Original Total:</td>
                <td style="padding: 10px 0; font-size: 16px; color: #333; font-weight: bold;">
                  ₦${order.total.toLocaleString()}
                </td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #555;">Cancellation Date:</td>
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
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #555;">Refund Status:</td>
                <td style="padding: 10px 0;">${refundStatusBadge}</td>
              </tr>
            </table>
          </div>

          <!-- Refund Information -->
          <div style="margin: 25px 0;">
            <h3 style="color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">
              ${refundIcon} Refund Information
            </h3>
            ${refundMessage}
          </div>

          <!-- What Happens Next -->
          <div style="background-color: #e8f4f8; padding: 20px; border-radius: 8px; margin: 25px 0;">
            <h3 style="margin-top: 0; color: #2c5aa0;">📋 What Happens Next?</h3>
            <ul style="padding-left: 20px; line-height: 1.6; color: #2c5aa0;">
              <li>Your order has been completely removed from our system</li>
              <li>All reserved inventory has been released back to stock</li>
              <li>You will not be charged for this order</li>
              ${
                refundProcessed
                  ? "<li>Your refund is being processed as detailed above</li>"
                  : ""
              }
              <li>You're free to place a new order anytime</li>
            </ul>
          </div>

          <!-- Support Section -->
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0;">
            <h4 style="margin-top: 0; color: #333;">Need Help? 🤝</h4>
            <p style="margin-bottom: 10px;">If you have any questions about this cancellation or need assistance:</p>
            <ul style="list-style: none; padding-left: 0;">
              <li style="margin: 8px 0;">📧 <strong>Email:</strong> ${
                process.env.EMAIL_USER
              }</li>
              <li style="margin: 8px 0;">📞 <strong>Phone:</strong> +234-XXX-XXXX-XXX</li>
              <li style="margin: 8px 0;">💬 <strong>Live Chat:</strong> Available on our website</li>
            </ul>
            <p style="font-size: 14px; color: #666; margin-bottom: 0;">
              Please reference Order ID <strong>#${
                order.id
              }</strong> when contacting support.
            </p>
          </div>

          <!-- Come Back Section -->
          <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #fff3cd; border-radius: 8px;">
            <h4 style="margin-top: 0;">We'd Love to Have You Back! 💝</h4>
            <p style="margin-bottom: 15px;">We're constantly adding new products and improving our service.</p>
            <a href="${process.env.BASE_URL || "#"}" 
              style="display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
              🛍️ Continue Shopping
            </a>
          </div>

          <!-- Footer -->
          <div style="text-align: center; padding-top: 30px; border-top: 1px solid #ddd; margin-top: 40px;">
            <p style="font-size: 16px; margin-bottom: 10px;">Thank you for giving us a try! 🙏</p>
            <p style="color: #666; margin-bottom: 20px;">
              We hope to serve you better in the future.<br>
              <strong>The E-Commerce API Team</strong>
            </p>
            
            <!-- Email Footer -->
            <div style="font-size: 12px; color: #999; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
              <p>This email was sent to <strong>${order.email}</strong></p>
              <p>© 2024 E-Commerce API. All rights reserved.</p>
              <p>If you have any concerns about this cancellation, please contact us immediately.</p>
            </div>
          </div>
        </div>
      `,
    };

    // Send email
    try {
      await transporter.sendMail(mailOptions);
    } catch (emailErr) {
      console.log("Email sending failed:", emailErr);
    }

    // Fetch updated order
    const updatedOrderQuery = await client.query(
      "SELECT * FROM orders WHERE id = $1",
      [orderId]
    );

    const updatedOrder = updatedOrderQuery.rows[0];

    res.status(200).json({
      success: true,
      message: "Order cancelled successfully",
      order: updatedOrder,
      refund: refundProcessed
        ? {
            status: refundData?.status,
            amount: refundData?.amount / 100,
            expected_at: refundData?.expected_at,
          }
        : null,
    });
  } catch (err) {
    console.error("Error Cancelling Order", err);

    await client.query("ROLLBACK");

    res.status(500).json({
      success: false,
      message: "Failed to cancel order",
      error: err.message,
    });
  } finally {
    client.release();
  }
};