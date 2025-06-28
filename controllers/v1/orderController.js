import PaystackApi from "paystack-api";

import db from "../../config/db.js";
import { updateProductInventory } from "./paymentController.js";

const paystack = PaystackApi(process.env.PAYSTACK_SECRET_KEY);

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

    // check shipping_address_id exist for user
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
            ci.product_id
            ci.quantity
            p.price
            p.name
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

    // calculate order total
    const total = cartResult.rows.reduce(
      (sum, item) => sum + parseInt(item.subtotal),
      0
    );

    // create order
    const orderQuery = `
        INSERT INTO orders (user_id, total, shipping_address_id) VALUES ($1, $2, $3);
    `;

    const orderResult = await db.query(orderQuery, [
      userId,
      total,
      shipping_address_id,
    ]);

    const order = orderResult.rows[0];

    // create order_items
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

    // initialize paystack payment
    const paymentData = {
      email: req.user.email,
      amount: total * 100, // convert to kobo
      reference: `order-${order.id}-${Date.now()}`,
      callback_url: `${process.env.BASE_URL}/payment/callback?reference=order-${
        order.id
      }-${Date.now()}`,
      metadata: {
        order_id: order.id,
        user_id: userId,
        custom_fields: [
          {
            display_name: "Order Number",
            variable_name: "order_number",
            value: order.id,
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
            value: `${checkAddress.rows[0].city}, ${checkAddress.rows[0].state}`,
          },
        ],
      },
    };

    const paymentResponse = await paystack.transaction.initialize(paymentData);

    if (!paymentResponse) {
      return res.status(500).json({
        success: false,
        message: "Failed to initialize payment",
      });
    }

    // update order with payment_reference
    await db.query("UPDATE orders SET payment_ref = $1 WHERE id = $2", [
      paymentData.reference,
      order.id,
    ]);

    res.status(200).json({
      success: true,
      data: {
        order_id: order.id,
        payment_url: paymentResponse.data.authorization_url,
        reference: paymentData.reference,
        amount: total,
      },
    });
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

    // check if user has an order with the payment reference
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

    // check if payment has already been verified
    const order = orderCheck.rows[0];
    if (order.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Payment has already been verified",
      });
    }

    // verify payment with paystack
    const verification = await paystack.transaction.verify(reference);

    if (!verification) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
        error: verification.message || "Unknown verification error"
      });
    }

    const { data } = verification;
    const status = data.status === "success" ? "paid" : "failed";
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
      status,
      paymentMethod,
      reference,
    ]);

    if (status === "paid") {
      // Delete cart items
      await db.query(
        `
        DELETE FROM cart_items 
        WHERE cart_id IN (SELECT id from carts WHERE user_id = $1)`,
        [userId]
      );

      // Log the payment transaction for audit trail
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
        [
          result.rows[0].id,
          reference,
          status,
          result.rows[0].total,
          paymentMethod,
          "user",
        ]
      );

      // Update Product Inventory
      try {
        await updateProductInventory(result.rows[0].id);
        console.log("Inventory updated successfully");
      } catch (inventoryError) {
        console.log("Inventory update failed:", inventoryError.message);
      }
    }

    if (status === "failed") {
      // Log the failed payment
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
        [result.rows[0].id, reference, status, data.gateway_response, "user"]
      );
    }

    res.status(200).json({
      success: true,
      data: {
        order: result.rows[0],
        payment_status: status,
        payment_method: paymentMethod,
      },
    });
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

    // get order items for each order
    for (let order of orders.rows) {
      const itemsQuery = `
        SELECT
          oi.*
          p.name as product_name, p.image_url
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
        p.name as product_name, p.image_url
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

// ========================================
// ADMIN-ONLY ORDER CONTROLLERS
// ========================================

// admin get all orders
export const getOrdersAdmin = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const ordersQuery = `
      SELECT
        o.*,
        a.line1, a.city, a.state, a.postal_code, a.country
      FROM orders o
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      ORDER BY o.placed_at DESC
      LIMIT $1 OFFSET $2
    `;

    const orders = await db.query(ordersQuery, [limit, offset]);

    // get order items for each order
    for (let order of orders.rows) {
      const itemsQuery = `
        SELECT
          oi.*
          p.name as product_name, p.image_url
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `;

      const items = await db.query(itemsQuery, [order.id]);
      order.items = items.rows;
    }

    // get total number of orders
    const countResult = await db.query(`SELECT COUNT(*) as total FROM orders`);
    const totalOrders = parseInt(countResult.rows[0].total);

    // calculate pagination
    const totalPages = Math.ceil(totalOrders / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.status(200).json({
      success: true,
      data: {
        orders: orders.rows
      },
      pagination: {
        current_page: page,
        per_page: limit,
        total_orders: totalOrders,
        total_pages: totalPages,
        has_next_page: hasNextPage,
        has_prev_page: hasPrevPage,
        next_page: hasNextPage ? page + 1 : null,
        prev_page: hasPrevPage ? page - 1 : null
      }
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

// admin get single order
export const getOrderAdmin = async (req, res) => {
  try {
    const id = req.params.id;

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
      WHERE o.id = $1
    `;

    const orderResult = await db.query(orderQuery, [id]);

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
        p.name as product_name, p.image_url
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

// verify payment for admin
export const verifyPaymentAdmin = async (req, res) => {
  try {
    const { reference } = req.params;

    // Input validation
    if (!reference || typeof reference !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid payment reference",
      });
    }

    // check for duplicate processing - prevent re-processing already successful payment
    const existingOrder = await db.query(
      "SELECT status FROM orders WHERE payment_ref = $1",
      [reference]
    );

    if (existingOrder.rows[0]?.status === "paid") {
      return res.status(409).json({
        success: false,
        message: "Payment already processed successfully",
      });
    }

    // verify payment with paystack
    const verification = await paystack.transaction.verify(reference);

    if (!verification) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
        error: verification.message || "Unknown verification error",
      });
    }

    const { data } = verification;
    const status = data.status === "success" ? "paid" : "failed";
    const paymentMethod = data.channel;

    // update order status
    const updateQuery = `
      UPDATE orders
      SET
        status = $1, 
        payment_method = $2, 
        updated_at = now()
      WHERE payment_ref = $3 AND status = 'pending'
      RETURNING *
    `;

    const result = await db.query(updateQuery, [
      status,
      paymentMethod,
      reference,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found or already processed",
      });
    }

    if (status === "paid") {
      // Log the payment transaction for audit trail
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
        [
          result.rows[0].id,
          reference,
          status,
          result.rows[0].total,
          paymentMethod,
          "admin",
        ]
      );

      // update product inventory
      try {
        await updateProductInventory(result.rows[0].id);
        console.log("Inventory updated successfully");
      } catch (inventoryError) {
        console.log("Inventory update failed:", inventoryError.message);
      }
    }

    if (status === "failed") {
      // Log the failed payment
      await db.query(
        `INSERT INTO payment_logs (order_id, payment_reference, status, failure_reason, processed_by, created_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (payment_reference) DO NOTHING`,
        [result.rows[0].id, reference, status, data.gateway_response, "admin"]
      );
    }

    res.status(200).json({
      success: true,
      data: {
        order: result.rows[0],
        payment_status: status,
        payment_method: paymentMethod,
        customer_id: result.rows[0].user_id,
        verification_type: "manual",
        verified_by: "admin",
        verified_at: new Date().toISOString(),
        admin_id: req.user.id
      },
    });
  } catch (err) {
    console.log("Verify payment error", err);
    res.status(500).json({
      success: false,
      message: "Payment Verification failed",
      error: err.message,
    });
  }
};
