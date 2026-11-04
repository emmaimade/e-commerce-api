import axios from "axios";
import db from "../../config/db.js";
import { releaseOrderInventory, updateProductInventory } from "../../utils/inventory.js";
import { refundOrder } from "../../utils/refunds.js";
import { withTransaction } from "../../utils/transaction.js";
import { HttpError } from "../../utils/httpError.js";
import createTransporter from "../../utils/email.js";
import { orderStatusEmail } from "../../emails/orderEmails.js";
import { paymentVerifiedByAdminEmail } from "../../emails/paymentEmails.js";

export const getOrdersAdmin = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    // Search by order status and payment status
    const { order_status, payment_status } = req.query;

    let whereClause = "";
    const queryParams = [];
    let paramIndex = 1;

    // Handle order status filtering
    if (order_status) {
      whereClause += whereClause ? " AND" : " WHERE";
      whereClause += ` o.order_status = $${paramIndex}`;
      queryParams.push(order_status);
      paramIndex++;
    }

    // Handle payment status filtering
    if (payment_status) {
      whereClause += whereClause ? " AND" : " WHERE";
      whereClause += ` o.status = $${paramIndex}`;
      queryParams.push(payment_status);
      paramIndex++;
    }

    // Add limit and offset
    queryParams.push(limit, offset);

    // Get orders
    const ordersQuery = `
      SELECT
        o.*,
        u.name as customer_name, u.email as customer_email,
        a.phone, a.line1, a.city, a.postal_code, a.country,
        COUNT(oi.id) as item_count,
        SUM(oi.quantity * oi.price) as total
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses a ON o.shipping_address_id = a.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      ${whereClause}
      GROUP BY u.name, u.email, o.id, a.phone, a.line1, a.city, a.postal_code, a.country
      ORDER BY o.placed_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const orders = await db.query(ordersQuery, queryParams);

    // Get total number of orders
    const countQuery = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const countParams = queryParams.slice(0, -2);
    const countResult = await db.query(countQuery, countParams);
    const totalOrders = parseInt(countResult.rows[0].total);

    // Calculate pagination
    const totalPages = Math.ceil(totalOrders / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.status(200).json({
      success: true,
      data: {
        orders: orders.rows.length > 0 ? orders.rows : "No orders found",
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
        u.name as customer_name, u.email as customer_email,
        a.phone, a.line1, a.city, a.postal_code, a.country
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
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

export const verifyPaymentAdmin = async (req, res, next) => {
  try {
    const { reference } = req.body;

    // Input validation
    if (!reference || typeof reference !== "string") {
      return res.status(400).json({
        success: false,
        message: "Invalid payment reference",
      });
    }

    // Check if order exists
    const existingOrder = await db.query(
      "SELECT * FROM orders WHERE payment_ref = $1",
      [reference]
    );

    if (existingOrder.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Payment reference not found",
      });
    }

    const order = existingOrder.rows[0];

    // Check if payment has already been verified
    if (order.status === "paid") {
      return res.status(409).json({
        success: true,
        message: "Payment already verified",
        data: {
          order: order,
          payment_status: "paid",
          payment_method: order.payment_method,
          customer_id: order.user_id,
          verification_type: "already_processed",
          verified_at: order.updated_at,
        },
      });
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

    console.log(
      "Admin Paystack verification response:",
      verificationResponse.data
    );

    if (!verificationResponse.data.status) {
      console.error("Paystack verification failed:", verificationResponse.data);
      throw new HttpError(400, "Payment verification failed");
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

      // Order was no longer pending (e.g. webhook processed it concurrently,
      // or it was cancelled/expired)
      if (result.rows.length === 0) {
        throw new HttpError(409, "Order is no longer awaiting payment");
      }

      const updatedOrder = result.rows[0];

      if (paymentStatus === "paid") {
        // Update product inventory in the same transaction as the order update
        await updateProductInventory(updatedOrder.id, client);
        console.log("Inventory updated successfully");

        // Log the payment transaction for audit trail
        await client.query(
          `INSERT INTO payment_logs (order_id, payment_reference, status, amount, payment_method, processed_by, gateway_response, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now()) ON CONFLICT (payment_reference, status) DO NOTHING`,
          [
            updatedOrder.id,
            reference,
            paymentStatus,
            updatedOrder.total,
            paymentMethod,
            "admin",
            JSON.stringify(data.gateway_response) || "Payment successful",
          ]
        );

        // Update order status history
        await client.query(
          `INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)`,
          [updatedOrder.id, "processing", "Payment verified by admin, order is being processed"]
        );
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
            "admin",
          ]
        );

        // Update order status history
        await client.query(
          "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
          [updatedOrder.id, "failed", "Payment verification failed"]
        );
      }

      return updatedOrder;
    });

    if (paymentStatus === "paid") {
      // Send email to customer
      try {
        const customerQuery = await db.query(
          "SELECT email, name FROM users WHERE id = $1",
          [updatedOrder.user_id]
        );
        
        if (customerQuery.rows.length > 0) {
          const customer = customerQuery.rows[0];
          const transporter = createTransporter();

          const mailOptions = {
            from: `E-commerce API <${process.env.EMAIL_USER}>`,
            to: customer.email,
            subject: "Payment Confirmed - Your Order is Being Processed",
            html: paymentVerifiedByAdminEmail({ customer, updatedOrder, reference, paymentMethod }),
          };

          await transporter.sendMail(mailOptions);
          console.log("Payment Confirmation Email sent successfully");
        }
      } catch (emailError) {
        console.error("Email sending failed:", emailError.message);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        order: updatedOrder,
        payment_status: paymentStatus,
        payment_method: paymentMethod,
        customer_id: updatedOrder.user_id,
        verification_type: "manual",
        verified_by: "admin",
        verified_at: new Date().toISOString(),
        admin_id: req.user.id,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Status an order can move to from each status. Only paid orders reach
// "processing", so unpaid orders can't be shipped, and finished orders can't reopen.
const ORDER_STATUS_TRANSITIONS = {
  pending: ["cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    const orderId = req.params.id;
    const { status, notes } = req.body;

    const { currentOrder, previousStatus, result } = await withTransaction(async (client) => {
      // Get current user order with customer details
      const currentOrderQuery = await client.query(
        `SELECT
        o.*,
        u.email, u.name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
      FOR UPDATE OF o`,
        [orderId]
      );

      if (currentOrderQuery.rows.length === 0) {
        throw new HttpError(404, "Order not found");
      }

      const currentOrder = currentOrderQuery.rows[0];
      const previousStatus = currentOrder.order_status;

      // Check the order is allowed to move to this status
      const allowedStatuses = ORDER_STATUS_TRANSITIONS[previousStatus] ?? [];
      if (!allowedStatuses.includes(status)) {
        throw new HttpError(409, `Cannot change order status from ${previousStatus} to ${status}`, {
          allowed_statuses: allowedStatuses,
        });
      }

      const query = `
      UPDATE orders
        SET order_status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

      const result = await client.query(query, [status, orderId]);

      // Return held stock to inventory when an order is cancelled
      if (status === "cancelled") {
        await releaseOrderInventory(orderId, client);
      }

      // Update Order Status History
      await client.query(
        "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
        [orderId, status, notes]
      );

      return { currentOrder, previousStatus, result };
    });

    // Refund after committing so no lock is held during the Paystack call
    const refund =
      status === "cancelled" && currentOrder.status === "paid" && currentOrder.payment_ref
        ? await refundOrder(currentOrder, "admin")
        : null;

    // Notify the customer. Commits first, so this only reports saved changes
    try {
      const transporter = createTransporter();

      const mailOptions = {
        from: `E-commerce API <${process.env.EMAIL_USER}>`,
        to: currentOrder.email,
        subject: `Order Update - ${status.charAt(0).toUpperCase() + status.slice(1)}`,
        html: orderStatusEmail({ status, currentOrder, previousStatus, orderId, notes }),
      };

      await transporter.sendMail(mailOptions);
      console.log(`Order status update email sent for status: ${status}`);
    } catch (emailError) {
      console.error("Email sending failed:", emailError.message);
    }

    res.status(200).json({
      success: true,
      message: "Order status updated successfully",
      data: {
        ...result.rows[0],
        email_sent: true,
        previous_status: previousStatus,
        refund: refund && {
          status: refund.processed ? refund.data.status : "failed",
          message: refund.error?.message,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};
