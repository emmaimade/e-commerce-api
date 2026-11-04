import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { withTransaction } from "../utils/transaction.js";

const findOrCreateCart = async (client, userId) => {
  const cart = await client.query("SELECT id FROM carts WHERE user_id = $1", [userId]);

  if (cart.rows.length > 0) return cart.rows[0].id;

  const newCart = await client.query("INSERT INTO carts (user_id) VALUES ($1) RETURNING id", [userId]);
  return newCart.rows[0].id;
};

export const addItem = (userId, { productId, quantity }) =>
  withTransaction(async (client) => {
    const product = await client.query("SELECT * FROM products WHERE id = $1", [productId]);

    if (product.rows.length === 0) {
      throw new HttpError(404, "Product not found");
    }

    if (product.rows[0].status !== "active") {
      throw new HttpError(400, "This product is not available");
    }

    const cartId = await findOrCreateCart(client, userId);

    const existingItem = await client.query(
      "SELECT * FROM cart_items WHERE cart_id = $1 AND product_id = $2",
      [cartId, productId]
    );

    // checks the cart total, including any already in the cart, against inventory
    const quantityInCart = existingItem.rows[0]?.quantity ?? 0;

    if (quantityInCart + quantity > product.rows[0].inventory_qty) {
      throw new HttpError(400, "Quantity exceeds available inventory", {
        available: product.rows[0].inventory_qty,
        in_cart: quantityInCart,
      });
    }

    if (existingItem.rows.length > 0) {
      await client.query("UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2", [
        quantity,
        existingItem.rows[0].id,
      ]);
    } else {
      await client.query(
        "INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)",
        [cartId, productId, quantity]
      );
    }

    await client.query("UPDATE carts SET updated_at = NOW() WHERE id = $1", [cartId]);
  });

export const getCart = async (userId) => {
  const result = await db.query(
    `SELECT
      c.id as cart_id,
      c.created_at as cart_created_at,
      c.updated_at as cart_updated_at,
      ci.id as item_id,
      ci.quantity,
      ci.added_at,
      p.id as product_id,
      p.name,
      p.price,
      p.images,
      (ci.quantity * p.price) as item_total
    FROM carts c
    LEFT JOIN cart_items ci ON c.id = ci.cart_id
    LEFT JOIN products p ON ci.product_id = p.id
    WHERE c.user_id = $1
    ORDER BY ci.added_at DESC`,
    [userId]
  );

  // User has no cart yet
  if (result.rows.length === 0) {
    return { cart_id: null, items: [], total_items: 0, total_amount: 0 };
  }

  const [first] = result.rows;
  const cart = {
    cart_id: first.cart_id,
    created_at: first.cart_created_at,
    updated_at: first.cart_updated_at,
    items: [],
    total_items: 0,
    total_amount: 0,
  };

  if (first.item_id === null) return cart;

  for (const item of result.rows) {
    cart.items.push({
      item_id: item.item_id,
      product_id: item.product_id,
      product_name: item.name,
      product_price: parseFloat(item.price),
      product_images: item.images,
      quantity: parseInt(item.quantity),
      item_total: parseFloat(item.item_total),
      added_at: item.added_at,
    });

    cart.total_items += parseInt(item.quantity);
    cart.total_amount += parseFloat(item.item_total);
  }

  return cart;
};

export const updateItemQuantity = (userId, itemId, quantity) =>
  withTransaction(async (client) => {
    const result = await client.query(
      `SELECT
        ci.id, ci.cart_id, p.inventory_qty, p.name, p.price
      FROM cart_items ci
      JOIN carts c ON ci.cart_id = c.id
      JOIN products p ON ci.product_id = p.id
      WHERE ci.id = $1 AND c.user_id = $2`,
      [itemId, userId]
    );

    if (result.rows.length === 0) {
      throw new HttpError(404, "Cart item not found");
    }

    const item = result.rows[0];

    if (quantity > item.inventory_qty) {
      throw new HttpError(400, `Only ${item.inventory_qty} items available in stock`);
    }

    await client.query("UPDATE cart_items SET quantity = $1 WHERE id = $2", [quantity, itemId]);

    return quantity * parseFloat(item.price);
  });

export const removeItem = (userId, itemId) =>
  withTransaction(async (client) => {
    const check = await client.query(
      `SELECT
        ci.id, ci.cart_id, ci.quantity, p.name, p.price
      FROM cart_items ci
      JOIN carts c ON ci.cart_id = c.id
      JOIN products p ON ci.product_id = p.id
      WHERE ci.id = $1 AND c.user_id = $2`,
      [itemId, userId]
    );

    if (check.rows.length === 0) {
      throw new HttpError(404, "Cart item not found or unauthorized");
    }

    const item = check.rows[0];

    await client.query("DELETE FROM cart_items WHERE id = $1", [itemId]);
    await client.query("UPDATE carts SET updated_at = NOW() WHERE id = $1", [item.cart_id]);

    const remaining = await client.query(
      "SELECT COUNT(*) as count FROM cart_items WHERE cart_id = $1",
      [item.cart_id]
    );

    return { item, cartEmpty: parseInt(remaining.rows[0].count) === 0 };
  });

export const clearCart = (userId) =>
  withTransaction(async (client) => {
    const deleted = await client.query(
      "DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)",
      [userId]
    );

    if (deleted.rowCount === 0) {
      throw new HttpError(400, "Cart is already empty");
    }

    await client.query("UPDATE carts SET updated_at = NOW() WHERE user_id = $1", [userId]);

    return deleted.rowCount;
  });
