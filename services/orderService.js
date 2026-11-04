import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { withTransaction } from "../utils/transaction.js";
import {
  orderCancelledEmail,
  orderConfirmationEmail,
  orderStatusEmail,
} from "../emails/orderEmails.js";
import { sendEmail } from "./emailService.js";
import {
  releaseOrderInventory,
  reserveOrderInventory,
} from "./inventoryService.js";
import { initializeTransaction } from "./paystackService.js";
import { attemptRefund, requestRefund } from "./refundService.js";

// Status an order can move to from each status. Only paid orders reach
// "processing", so unpaid orders can't be shipped, and finished orders can't reopen.
const ORDER_STATUS_TRANSITIONS = {
  pending: ["cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

const outOfStockError = (items) =>
  new HttpError(400, "Some items are out of stock", {
    data: { out_of_stock_items: items },
  });

const addStatusHistory = (client, orderId, status, notes) =>
  client.query(
    "INSERT INTO order_status_history (order_id, status, notes) VALUES ($1, $2, $3)",
    [orderId, status, notes]
  );

// Create the order and reserve its stock in one transaction
const createPendingOrder = (userId, shippingAddressId) =>
  withTransaction(async (client) => {
    const address = await client.query(
      "SELECT * FROM addresses WHERE id = $1 AND user_id = $2",
      [shippingAddressId, userId]
    );

    if (address.rows.length === 0) {
      throw new HttpError(404, "User shipping address not found");
    }

    const cart = await client.query(
      `SELECT
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
      WHERE c.user_id = $1`,
      [userId]
    );

    const items = cart.rows;

    if (items.length === 0) {
      throw new HttpError(400, "Cart is empty");
    }

    const unavailableItems = items.filter((item) => item.status === "inactive");

    if (unavailableItems.length > 0) {
      throw new HttpError(400, "Some items are no longer available", {
        data: {
          unavailable_items: unavailableItems.map((item) => ({
            product_id: item.product_id,
            name: item.name,
          })),
        },
      });
    }

    const outOfStockItems = items.filter((item) => item.quantity > item.stock_quantity);

    if (outOfStockItems.length > 0) {
      throw outOfStockError(
        outOfStockItems.map((item) => ({
          product_id: item.product_id,
          name: item.name,
          requested: item.quantity,
          available: item.stock_quantity,
        }))
      );
    }

    const total = items.reduce((sum, item) => sum + parseInt(item.subtotal), 0);

    const orderResult = await client.query(
      "INSERT INTO orders (user_id, total, shipping_address_id) VALUES ($1, $2, $3) RETURNING *",
      [userId, total, shippingAddressId]
    );
    const order = orderResult.rows[0];

    for (const item of items) {
      await client.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)",
        [order.id, item.product_id, item.quantity, item.price]
      );
    }

    // Reserve stock under lock - the check above can be stale under concurrency
    const insufficientItems = await reserveOrderInventory(order.id, client);

    if (insufficientItems.length > 0) {
      throw outOfStockError(
        insufficientItems.map((item) => ({
          product_id: item.product_id,
          name: item.product_name,
          requested: item.quantity,
          available: item.current_stock,
        }))
      );
    }

    await addStatusHistory(client, order.id, "pending", "Order created");

    const reference = `order-${order.id}-${Date.now()}`;

    await client.query("UPDATE orders SET payment_ref = $1 WHERE id = $2", [reference, order.id]);

    return { order, total, reference, items, address: address.rows[0] };
  });

// Release the stock and remove the order (items and history cascade)
const discardOrder = (orderId) =>
  withTransaction(async (client) => {
    await releaseOrderInventory(orderId, client);
    await client.query("DELETE FROM orders WHERE id = $1", [orderId]);
  });

// The order is committed first so no transaction is open during the Paystack call
const startPayment = async ({ user, order, total, reference, items, address }) => {
  let response;

  try {
    response = await initializeTransaction({
      email: user.email,
      amount: total * 100, // convert to kobo
      reference,
      callback_url: `${process.env.BASE_URL}/v1/payments/callback`,
      metadata: {
        order_id: order.id,
        user_id: user.id,
        custom_fields: [
          { display_name: "Order Number", variable_name: "order_number", value: order.id.toString() },
          { display_name: "Customer", variable_name: "customer_name", value: user.name },
          { display_name: "Items", variable_name: "item_count", value: `${items.length} items` },
          { display_name: "Shipping", variable_name: "shipping_address", value: `${address.city}, ${address.country}` },
        ],
      },
    });
  } catch (err) {
    console.error("Paystack payment initialization error:", err.response?.data || err.message);
    await discardOrder(order.id);
    throw new HttpError(500, "Failed to initialize payment");
  }

  if (!response.status) {
    await discardOrder(order.id);
    throw new HttpError(500, "Failed to initialize payment");
  }

  return response.data.authorization_url;
};

export const placeOrder = async (user, shippingAddressId) => {
  const pending = await createPendingOrder(user.id, shippingAddressId);
  const { order, total, reference, items } = pending;
  const paymentUrl = await startPayment({ user, ...pending });

  await sendEmail({
    to: user.email,
    subject: "Order Confirmation - Complete Your Payment",
    html: orderConfirmationEmail({ user, order, total, items, paymentUrl }),
  });

  return { order_id: order.id, payment_url: paymentUrl, reference, amount: total };
};

export const listCustomerOrders = async (userId) => {
  const orders = await db.query(
    `SELECT
      o.*,
      a.phone, a.line1, a.city, a.postal_code, a.country,
      COUNT (oi.id) as item_count,
      SUM (oi.quantity * oi.price) as total
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN addresses a ON o.shipping_address_id = a.id
    WHERE o.user_id = $1
    GROUP BY o.id, a.phone, a.line1, a.city, a.postal_code, a.country
    ORDER BY o.placed_at DESC`,
    [userId]
  );

  return orders.rows;
};

const orderItems = async (orderId) => {
  const items = await db.query(
    `SELECT
      oi.*,
      p.name as product_name, p.images
    FROM order_items oi
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = $1`,
    [orderId]
  );

  return items.rows;
};

export const getCustomerOrder = async (orderId, userId) => {
  const result = await db.query(
    `SELECT
      o.*,
      a.phone, a.line1, a.city, a.postal_code, a.country
    FROM orders o
    LEFT JOIN addresses a ON o.shipping_address_id = a.id
    WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, userId]
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "Order not found");
  }

  return { ...result.rows[0], items: await orderItems(orderId) };
};

export const getCustomerOrderHistory = async (orderId, userId) => {
  const order = await db.query("SELECT id FROM orders WHERE id = $1 AND user_id = $2", [orderId, userId]);

  if (order.rows.length === 0) {
    throw new HttpError(404, "Order not found");
  }

  const history = await db.query(
    `SELECT status, notes, updated_at AS created_at
    FROM order_status_history
    WHERE order_id = $1
    ORDER BY updated_at DESC`,
    [orderId]
  );

  return history.rows;
};

export const cancelCustomerOrder = async (orderId, userId) => {
  const { order, pendingRefund } = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT
        o.*, u.email, u.name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = $1 AND o.user_id = $2
      FOR UPDATE OF o`,
      [orderId, userId]
    );

    if (result.rows.length === 0) {
      throw new HttpError(404, "Order not found or access denied");
    }

    const lockedOrder = result.rows[0];

    if (!["pending", "processing"].includes(lockedOrder.order_status)) {
      throw new HttpError(400, "Order cannot be cancelled. It is already shipped, delivered or cancelled.");
    }

    await client.query(
      "UPDATE orders SET order_status = 'cancelled', updated_at = NOW() WHERE id = $1",
      [orderId]
    );
    await addStatusHistory(client, orderId, "cancelled", "Order cancelled by user");
    await releaseOrderInventory(orderId, client);

    const pendingRefund =
      lockedOrder.status === "paid" && lockedOrder.payment_ref
        ? await requestRefund(client, { order: lockedOrder, amount: lockedOrder.total, requestedBy: "user" })
        : null;

    return { order: lockedOrder, pendingRefund };
  });

  // Refund after committing so no lock is held during the Paystack call
  const refund = pendingRefund ? await attemptRefund(pendingRefund.id) : {};
  const refundProcessed = refund.processed === true;

  await sendEmail({
    to: order.email,
    subject: "Order Cancellation Confirmed",
    html: orderCancelledEmail({
      order,
      refundProcessed,
      refundData: refund.data,
      refundError: refund.error,
    }),
  });

  const updatedOrder = await db.query("SELECT * FROM orders WHERE id = $1", [orderId]);

  let refundSummary = null;

  if (refundProcessed) {
    refundSummary = {
      status: refund.data?.status,
      amount: refund.data?.amount / 100,
      expected_at: refund.data?.expected_at,
    };
  } else if (refund.error) {
    refundSummary = {
      status: "failed",
      message: "Your refund could not be processed automatically. Our team will follow up.",
    };
  }

  return { order: updatedOrder.rows[0], refund: refundSummary };
};

export const listOrders = async ({ page: pageParam, limit: limitParam, order_status, payment_status }) => {
  const page = Math.max(1, parseInt(pageParam) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(limitParam) || 10));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (order_status) {
    params.push(order_status);
    conditions.push(`o.order_status = $${params.length}`);
  }

  if (payment_status) {
    params.push(payment_status);
    conditions.push(`o.status = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const orders = await db.query(
    `SELECT
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
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const count = await db.query(`SELECT COUNT(*) as total FROM orders o ${whereClause}`, params);
  const totalOrders = parseInt(count.rows[0].total);

  const totalPages = Math.ceil(totalOrders / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return {
    orders: orders.rows.length > 0 ? orders.rows : "No orders found",
    pagination: {
      current_page: page,
      per_page: limit,
      total_orders: totalOrders,
      total_pages: totalPages,
      has_next_page: hasNextPage,
      has_prev_page: hasPrevPage,
      next_page: hasNextPage ? page + 1 : null,
      prev_page: hasPrevPage ? page - 1 : null,
    },
  };
};

export const getOrder = async (orderId) => {
  const result = await db.query(
    `SELECT
      o.*,
      u.name as customer_name, u.email as customer_email,
      a.phone, a.line1, a.city, a.postal_code, a.country
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN addresses a ON o.shipping_address_id = a.id
    WHERE o.id = $1`,
    [orderId]
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "Order not found");
  }

  return { ...result.rows[0], items: await orderItems(orderId) };
};

export const changeOrderStatus = async (orderId, status, notes) => {
  const { currentOrder, previousStatus, updatedOrder, pendingRefund } = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT
        o.*,
        u.email, u.name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = $1
      FOR UPDATE OF o`,
      [orderId]
    );

    if (current.rows.length === 0) {
      throw new HttpError(404, "Order not found");
    }

    const currentOrder = current.rows[0];
    const previousStatus = currentOrder.order_status;
    const allowedStatuses = ORDER_STATUS_TRANSITIONS[previousStatus] ?? [];

    if (!allowedStatuses.includes(status)) {
      throw new HttpError(409, `Cannot change order status from ${previousStatus} to ${status}`, {
        allowed_statuses: allowedStatuses,
      });
    }

    const updated = await client.query(
      "UPDATE orders SET order_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [status, orderId]
    );

    // Return held stock to inventory when an order is cancelled
    if (status === "cancelled") {
      await releaseOrderInventory(orderId, client);
    }

    await addStatusHistory(client, orderId, status, notes);

    const pendingRefund =
      status === "cancelled" && currentOrder.status === "paid" && currentOrder.payment_ref
        ? await requestRefund(client, { order: currentOrder, amount: currentOrder.total, requestedBy: "admin" })
        : null;

    return { currentOrder, previousStatus, updatedOrder: updated.rows[0], pendingRefund };
  });

  // Refund after committing so no lock is held during the Paystack call
  const refund = pendingRefund ? await attemptRefund(pendingRefund.id) : null;

  await sendEmail({
    to: currentOrder.email,
    subject: `Order Update - ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    html: orderStatusEmail({ status, currentOrder, previousStatus, orderId, notes }),
  });

  return {
    ...updatedOrder,
    email_sent: true,
    previous_status: previousStatus,
    refund: refund && {
      status: refund.processed ? refund.data.status : "failed",
      message: refund.error?.message,
    },
  };
};
