import axios from "axios";

import db from "../../config/db.js";
import {
  reserveOrderInventory,
  releaseOrderInventory,
  updateProductInventory,
} from "../../utils/inventory.js";
import { refundOrder } from "../../utils/refunds.js";
import { withTransaction } from "../../utils/transaction.js";
import { HttpError } from "../../utils/httpError.js";
import createTransporter from "../../utils/email.js";
import { orderConfirmationEmail, orderCancelledEmail } from "../../emails/orderEmails.js";
import { paymentConfirmedEmail } from "../../emails/paymentEmails.js";

const outOfStockError = (items) =>
  new HttpError(400, "Some items are out of stock", {
    data: { out_of_stock_items: items },
  });

// create order
export const createOrder = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { shipping_address_id } = req.body;

    const { order, total, paymentReference, checkAddress, cartResult } = await withTransaction(async (client) => {
      // Check shipping_address_id exist for user
      const checkAddress = await client.query(
        "SELECT * FROM addresses WHERE id =$1 AND user_id = $2",
        [shipping_address_id, userId]
      );

      if (checkAddress.rows.length === 0) {
        throw new HttpError(404, "User shipping address not found");
      }

      // check if user has a cart with items inside
      const cartQuery = `
            SELECT
            ci.product_id,
            ci.quantity,
            p.price,
            p.name,
            p.inventory_qty as stock_quantity,
            p.status,
            (ci.quantity * p.price) as subtotal
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            JOIN carts c ON ci.cart_id = c.id
            WHERE c.user_id = $1
        `;

      const cartResult = await client.query(cartQuery, [userId]);

      if (cartResult.rows.length === 0) {
        throw new HttpError(400, "Cart is empty");
      }

      // Check every product is still for sale
      const unavailableItems = cartResult.rows.filter(item => item.status === "inactive");

      if (unavailableItems.length > 0) {
        throw new HttpError(400, "Some items are no longer available", {
          data: {
            unavailable_items: unavailableItems.map(item => ({
              product_id: item.product_id,
              name: item.name,
            })),
          },
        });
      }

      // Check stock availability
      const outOfStockItems = cartResult.rows.filter(item => item.quantity > item.stock_quantity);

      if (outOfStockItems.length > 0) {
        throw outOfStockError(outOfStockItems.map(item => ({
          product_id: item.product_id,
          name: item.name,
          requested: item.quantity,
          available: item.stock_quantity
        })));
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

      // Reserve stock under lock - the check above can be stale under concurrency
      const insufficientItems = await reserveOrderInventory(order.id, client);

      if (insufficientItems.length > 0) {
        throw outOfStockError(insufficientItems.map(item => ({
          product_id: item.product_id,
          name: item.product_name,
          requested: item.quantity,
          available: item.current_stock
        })));
      }

      // Log order creation history
      await client.query(
        `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, 'pending', 'Order created')`,
        [order.id]
      );

      // Generate unique payment reference
      const paymentReference = `order-${order.id}-${Date.now()}`;

      await client.query("UPDATE orders SET payment_ref = $1 WHERE id = $2", [
        paymentReference,
        order.id,
      ]);

      return { order, total, paymentReference, checkAddress, cartResult };
    });

    // Release the stock and remove the order (items and history cascade)
    // if payment can't be initialized. Paystack is called after committing so
    // no transaction is held open during the HTTP request.
    const discardOrder = () =>
      withTransaction(async (client) => {
        await releaseOrderInventory(order.id, client);
        await client.query("DELETE FROM orders WHERE id = $1", [order.id]);
      });

    // Initialize paystack payment
    const paymentData = {
      email: req.user.email,
      amount: total * 100, // convert to kobo
      reference: paymentReference,
      callback_url: `${process.env.BASE_URL}/v1/payments/callback`,
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

    let paymentResponse;

    try {
      paymentResponse = await axios.post(
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
    } catch (paymentError) {
      console.error("Paystack payment initialization error:", paymentError);
      await discardOrder();
      throw new HttpError(500, "Failed to initialize payment");
    }

    console.log("Paystack initialization response:", paymentResponse.data);

    if (!paymentResponse.data.status) {
      await discardOrder();
      throw new HttpError(500, "Failed to initialize payment");
    }

    const transporter = createTransporter();

    const mailOptions = {
      from: `E-commerce API <${process.env.EMAIL_USER}>`,
      to: req.user.email,
      subject: "Order Confirmation - Complete Your Payment",
      html: orderConfirmationEmail({
          user: req.user,
          order,
          total,
          items: cartResult.rows,
          paymentUrl: paymentResponse.data.data.authorization_url,
        }),
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
  } catch (err) {
    next(err);
  }
};

// verify payment (user)
export const verifyPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;
    const userId = req.user.id;

    if (!reference || typeof reference !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid payment reference",
      });
    }

    // Check if user has an order with the payment reference
    const orderCheck = await db.query(
      "SELECT * FROM orders WHERE payment_ref = $1 AND user_id = $2",
      [reference, userId]
    );

    if (orderCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Payment not found or access denied",
      });
    }

    const order = orderCheck.rows[0];

    // Check if payment has already been verified
    if (order.status === "paid") {
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

    // Verify payment with paystack before opening a transaction, so none is held open during HTTP
    let verificationResponse;

    try {
      verificationResponse = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 seconds timeout
        }
      );
    } catch (verificationError) {
      console.error(
        "Paystack verification error:",
        verificationError.response?.data || verificationError.message
      );
      throw new HttpError(500, "Payment verification failed");
    }

    console.log("Paystack verification response:", verificationResponse.data);

    if (!verificationResponse.data.status) {
      throw new HttpError(500, "Payment verification failed");
    }

    const data = verificationResponse.data.data;

    // abandoned/ongoing/pending: customer hasn't finished paying yet
    if (!["success", "failed"].includes(data.status)) {
      return res.status(200).json({
        success: true,
        message: "Payment has not been completed yet",
        data: { payment_status: data.status },
      });
    }

    const paymentStatus = data.status === "success" ? "paid" : "failed";
    const paymentMethod = data.channel;

    const updatedOrder = await withTransaction(async (client) => {
      // update order status
      const updateQuery = `
      UPDATE orders
      SET
        status = $1,
        payment_method = $2,
        order_status = CASE WHEN $1 = 'paid' THEN 'processing' ELSE order_status END,
        updated_at = now()
      WHERE payment_ref = $3 AND (status = 'pending' OR ($1 = 'paid' AND status = 'failed')) AND order_status <> 'cancelled'
      RETURNING *
    `;

      const result = await client.query(updateQuery, [
        paymentStatus,
        paymentMethod,
        reference,
      ]);

      // Webhook processed this payment while we were verifying, or the order
      // was cancelled/expired
      if (result.rows.length === 0) {
        throw new HttpError(409, "Order is no longer awaiting payment");
      }

      const updatedOrder = result.rows[0];

      if (paymentStatus === "paid") {
        // Update Product Inventory in the same transaction as the order update
        await updateProductInventory(updatedOrder.id, client);
        console.log("Inventory updated successfully");

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
            ON CONFLICT (payment_reference, status) DO NOTHING
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
      } else {
        // Log the failed payment
        await client.query(
          `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (payment_reference, status) DO NOTHING`,
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

      return updatedOrder;
    });

    if (paymentStatus === "paid") {
      // Send Payment Confirmation Email
      const customer = { email: req.user.email };
      const transporter = createTransporter();

      // Email options
      const mailOptions = {
        from: `E-commerce API <${process.env.EMAIL_USER}>`,
        to: customer.email,
        subject: "Payment Confirmed - Your Order is Being Processed",
        html: paymentConfirmedEmail({ user: req.user, updatedOrder, reference, paymentMethod }),
      };

      // Send email
      try {
        await transporter.sendMail(mailOptions);
        console.log("Payment Confirmation Email sent successfully");
      } catch (emailError) {
        console.log("Email sending failed:", emailError.message);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        order: updatedOrder,
        payment_status: paymentStatus,
        payment_method: paymentMethod,
        verified_at: new Date().toISOString(),
        verified_by: "user"
      },
    });
  } catch (err) {
    next(err);
  }
};

// get all user orders
export const getOrders = async (req, res) => {
  try {
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

    const orders = await db.query(ordersQuery, [userId]);

    res.status(200).json({
      success: true,
      data: orders.rows,
    });
  } catch (err) {
    console.log("Error getting orders", err);
    res.status(500).json({
      success: false,
      message: "Error getting orders",
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
    });
  }
}

// cancel order
export const cancelOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await withTransaction(async (client) => {
      // Check if order belongs to user
      const orderQuery = await client.query(
        `SELECT
        o.*, u.email, u.name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1 AND o.user_id = $2
      FOR UPDATE OF o
      `,
        [orderId, userId]
      );

      if (orderQuery.rows.length === 0) {
        throw new HttpError(404, "Order not found or access denied");
      }

      const order = orderQuery.rows[0];

      // Check if order can be cancelled
      if (!["pending", "processing"].includes(order.order_status)) {
        throw new HttpError(400, "Order cannot be cancelled. It is already shipped, delivered or cancelled.");
      }

      // Update order status to cancelled
      await client.query(
        `UPDATE orders SET order_status = $1, updated_at = NOW() WHERE id = $2`,
        ["cancelled", orderId]
      );

      // Log status change in order_status_history
      await client.query(
        `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
        [orderId, "cancelled", `Order cancelled by user`]
      );

      // Restore product stock held by this order
      await releaseOrderInventory(orderId, client);

      return order;
    });

    // Refund after committing so no lock is held during the Paystack call
    const refund =
      order.status === "paid" && order.payment_ref
        ? await refundOrder(order, "user")
        : {};
    const refundProcessed = refund.processed === true;
    const refundData = refund.data;
    const refundError = refund.error;

    // Create transporter
    const transporter = createTransporter();

    const mailOptions = {
      from: `E-Commerce API <${process.env.EMAIL_USER}>`,
      to: order.email,
      subject: "Order Cancellation Confirmed",
      html: orderCancelledEmail({ order, refundProcessed, refundData, refundError }),
    };

    // Send email
    try {
      await transporter.sendMail(mailOptions);
    } catch (emailErr) {
      console.log("Email sending failed:", emailErr);
    }

    // Fetch updated order
    const updatedOrderQuery = await db.query(
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
        : refundError
        ? { status: "failed", message: "Your refund could not be processed automatically. Our team will follow up." }
        : null,
    });
  } catch (err) {
    next(err);
  }
};
