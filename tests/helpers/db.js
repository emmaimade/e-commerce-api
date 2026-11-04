import fs from "fs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import pg from "pg";
import db from "../../config/db.js";

const schema = fs.readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");

// Rebuild the schema from schema.sql so tests run against the real table definitions
export const resetDatabase = async () => {
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await db.query(schema);
};

export const clearTables = () =>
  db.query(
    `TRUNCATE users, addresses, products, carts, cart_items, orders, order_items,
      order_status_history, payment_logs, refunds RESTART IDENTITY CASCADE`
  );

export const closeDatabase = () => db.end();

export const createUser = async ({ role = "customer" } = {}) => {
  const email = `user-${crypto.randomUUID()}@test.com`;
  const result = await db.query(
    "INSERT INTO users (name, email, password, role) VALUES ($1, $2, 'not-a-real-hash', $3) RETURNING id, email, role",
    ["Test User", email, role]
  );
  const user = result.rows[0];
  user.token = jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET
  );
  return user;
};

export const createAddress = async (userId) => {
  const result = await db.query(
    `INSERT INTO addresses (user_id, line1, city, postal_code, country, phone)
    VALUES ($1, '1 Test Street', 'Lagos', '100001', 'Nigeria', '+2348000000000') RETURNING id`,
    [userId]
  );
  return result.rows[0].id;
};

export const createProduct = async ({ price = 1000, stock = 5 } = {}) => {
  const result = await db.query(
    "INSERT INTO products (name, description, price, inventory_qty) VALUES ('Test Product', 'A product', $1, $2) RETURNING id",
    [price, stock]
  );
  return result.rows[0].id;
};

export const addToCart = async (userId, productId, quantity) => {
  const existing = await db.query("SELECT id FROM carts WHERE user_id = $1", [userId]);
  const cartId =
    existing.rows[0]?.id ??
    (await db.query("INSERT INTO carts (user_id) VALUES ($1) RETURNING id", [userId])).rows[0].id;

  await db.query(
    "INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)",
    [cartId, productId, quantity]
  );
};

export const getStock = async (productId) =>
  (await db.query("SELECT inventory_qty FROM products WHERE id = $1", [productId])).rows[0]
    .inventory_qty;

export const getOrder = async (orderId) =>
  (await db.query("SELECT * FROM orders WHERE id = $1", [orderId])).rows[0];

export const countRows = async (table, where = "TRUE", params = []) =>
  (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0].n;

export { db };

// Connections checked out of the pool and not returned
export const leakedConnections = () => db.totalCount - db.idleCount;

// Uses its own connection: the pool could hand back the very connection being measured
export const openTransactions = async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await client.query(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'"
  );
  await client.end();
  return result.rows[0].n;
};
