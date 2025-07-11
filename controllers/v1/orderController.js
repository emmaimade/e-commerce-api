import axios from "axios";

import db from "../../config/db.js";
import { updateProductInventory } from "./paymentController.js";

// create order
export const createOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { shipping_address_id } = req.body;

    if (!shipping_address_id) {
      return res.status(400).json({
        success: false,
        message: "Shipping Address is required!",
      });
    }

    // Check shipping_address_id exist for user
    const checkAddress = await db.query(
      "SELECT * FROM addresses WHERE id =$1 AND user_id = $2",
      [shipping_address_id, userId]
    );

    if (checkAddress.rows.length === 0) {
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

    const cartResult = await db.query(cartQuery, [userId]);

    if (cartResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
      });
    }

    console.log(cartResult.rows);

    // Check stock availability
    const outOfStockItems = cartResult.rows.filter(item => item.quantity > item.stock_quantity);

    if (outOfStockItems.length > 0) {
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

    const orderResult = await db.query(orderQuery, [
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
      await db.query(orderItemsQuery, [
        order.id,
        item.product_id,
        item.quantity,
        item.price,
      ]);
    }

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
        }
      );

      console.log("Paystack initialization response:", paymentResponse.data);

      if (!paymentResponse.data.status) {
        return res.status(500).json({
          success: false,
          message: "Failed to initialize payment",
          error: paymentResponse.data.message || "Unknown payment error",
        });
      }

      // update order with payment_reference
      await db.query("UPDATE orders SET payment_ref = $1 WHERE id = $2", [
        paymentReference,
        order.id,
      ]);

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

      // If payment initialization fails, rollback order creation
      await db.query("DELETE FROM order_items WHERE order_id = $1", [order.id]);

      await db.query("DELETE FROM orders WHERE id = $1", [order.id]);

      return res.status(500).json({
        success: false,
        message: "Failed to initialize payment",
        error: paymentError.response?.data?.message || paymentError.message,
      });
    }
  } catch (err) {
    console.log("Create order error", err);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: err.message,
    });
  }
};

// verify payment (user)
export const verifyPayment = async (req, res) => {
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
      return res.status(400).json({
        success: false,
        message: "Payment has already been verified",
      });
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
        }
      );

      console.log("Paystack verification response:", verificationResponse.data);

      if (!verificationResponse.data.status) {
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
        updated_at = now()
      WHERE payment_ref = $3
      RETURNING *
    `;

      const result = await db.query(updateQuery, [
        paymentStatus,
        paymentMethod,
        reference,
      ]);

      if (paymentStatus === "paid") {
        // Delete cart items
        await db.query(
          `
        DELETE FROM cart_items 
        WHERE cart_id IN (SELECT id from carts WHERE user_id = $1)`,
          [userId]
        );

        // Update Product Inventory
        try {
          await updateProductInventory(result.rows[0].id);
          console.log("Inventory updated successfully");
        } catch (inventoryError) {
          console.log("Inventory update failed:", inventoryError.message);
        }

        // Log the payment transaction for audit trail
        await db.query(
          `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
          [
            result.rows[0].id,
            reference,
            paymentStatus,
            result.rows[0].total,
            paymentMethod,
            "user",
            JSON.stringify(data.gateway_response) || "Payment successful",
          ]
        );
      } else {
        // Log the failed payment
        await db.query(
          `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
          [
            result.rows[0].id,
            reference,
            paymentStatus,
            data.gateway_response || "Payment failed",
            "user",
          ]
        );
      }

      res.status(200).json({
        success: true,
        data: {
          order: result.rows[0],
          payment_status: paymentStatus,
          payment_method: paymentMethod,
          verified_at: new Date().toISOString(),
        },
      });
    } catch (verificationError) {
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
    console.log("Verify payment error", err);
    res.status(500).json({
      success: false,
      message: "Payment Verification failed",
      error: err.message,
    });
  }
};

// get all user orders
export const getOrders = async (req, res) => {
  try {
    const userId = req.user.id;

    const ordersQuery = `
      SELECT
        o.*,
        a.line1, a.city, a.state, a.postal_code, a.country
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      WHERE o.user_id = $1
      ORDER BY o.placed_at DESC
    `;

    const orders = await db.query(ordersQuery, [userId]);

    if (orders.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No orders found",
      });
    }

    // get order items for each order
    for (let order of orders.rows) {
      const itemsQuery = `
        SELECT
          oi.*
          p.name as product_name, p.images
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `;

      const items = await db.query(itemsQuery, [order.id]);
      order.items = items.rows;
    }

    res.status(200).json({
      success: false,
      data: orders.rows,
    });
  } catch (err) {
    console.log("Error getting orders", err);
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
        a.line1, a.city, a.state, a.postal_code, a.country
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
        oi.*
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
