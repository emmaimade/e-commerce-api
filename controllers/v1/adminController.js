import PaystackApi from "paystack-api";

import db from "../../config/db.js";
import { updateProductInventory } from "./paymentController.js";

const paystack = PaystackApi(process.env.PAYSTACK_SECRET_KEY);

// ========================================
// USER CONTROLLERS
// ========================================

export const adminGetUsers = async (req, res) => {
  try {
    const users = await db.query("SELECT * FROM users");
    if (!users) {
      return res.status(404).json({ message: "No users found" });
    }
    res.status(200).json({ users: users.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const adminGetUser = async (req, res) => {
  try {
    const userId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ========================================
// PRODUCT CONTROLLERS
// ========================================

export const addProduct = async (req, res) => {
  try {
    const { name, price, inventory_qty } = req.body;

    if (!name || !price || !inventory_qty) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (isNaN(price) || isNaN(inventory_qty)) {
      return res
        .status(400)
        .json({ message: "Price and inventory must be numbers" });
    }

    if (price <= 0 || inventory_qty <= 0) {
      return res
        .status(400)
        .json({ message: "Price and inventory must be greater than 0" });
    }

    const newProduct = await db.query(
      "INSERT INTO products (name, price, inventory_qty) VALUES ($1, $2, $3) RETURNING *",
      [name, price, inventory_qty]
    );

    res.status(201).json({
      message: "Product added successfully",
      product: newProduct.rows[0],
    });
  } catch (err) {
    console.log("Error adding product", err);
    res.status(500).json({ error: err.message });
  }
};

export const updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const updates = req.body;

    // define allowed fields
    const allowedFields = [
      "name",
      "price",
      "description",
      "inventory_qty",
      "image_url",
    ];
    const allowedUpdates = {};

    // filter only allowed fields
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined && value !== "") {
        allowedUpdates[key] = value;
      }
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    // checks if price is a number
    if (allowedUpdates.price) {
      if (isNaN(allowedUpdates.price)) {
        return res.status(400).json({ message: "Price must be a number" });
      }
      // checks if price is greater than one
      if (allowedUpdates.price <= 0) {
        return res
          .status(400)
          .json({ message: "Price must be greater than 0" });
      }
    }

    // check if inventory_qty is a number
    if (allowedUpdates.inventory_qty) {
      if (isNaN(allowedUpdates.inventory_qty)) {
        return res.status(400).json({ message: "Inventory must be a number" });
      }
      // checks if inventory_qty is greater than one
      if (allowedUpdates.inventory_qty <= 0) {
        return res
          .status(400)
          .json({ message: "Inventory must be greater than 0" });
      }
    }

    // dynamic sql query
    const fields = Object.keys(allowedUpdates);
    const values = Object.values(allowedUpdates);
    const setClause = fields
      .map((field, index) => `${field} = $${index + 1}`)
      .join(", ");

    const query = `UPDATE products SET ${setClause}, updated_at = NOW() WHERE id = $${
      fields.length + 1
    } RETURNING *`;

    // update product
    const result = await db.query(query, [...values, productId]);

    res.status(200).json({
      message: "Product updated successfully",
      product: result.rows[0],
    });
  } catch (err) {
    console.log("Error updating product", err);
    res.status(500).json({ error: err.message });
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    const product = await db.query("SELECT * FROM products WHERE id = $1", [
      productId,
    ]);

    if (product.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    await db.query("DELETE FROM products WHERE id = $1", [productId]);

    res.status(200).json({ message: "Product deleted successfully" });
  } catch (err) {
    console.log("Error deleting product", err);
    res.status(500).json({ error: err.message });
  }
};

// ========================================
// ORDER CONTROLLERS
// ========================================

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
