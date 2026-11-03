import "./helpers/setup.js";
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { reserveOrderInventory, releaseOrderInventory } from "../utils/inventory.js";
import {
  db, resetDatabase, clearTables, closeDatabase, createUser, createProduct, getStock,
} from "./helpers/db.js";

const createOrder = async (productId, quantity) => {
  const user = await createUser();
  const order = await db.query(
    "INSERT INTO orders (user_id, total) VALUES ($1, 0) RETURNING id",
    [user.id]
  );
  const orderId = order.rows[0].id;
  await db.query(
    "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, 0)",
    [orderId, productId, quantity]
  );
  return orderId;
};

describe("inventory reservation", () => {
  before(resetDatabase);
  beforeEach(clearTables);
  after(closeDatabase);

  it("makes a concurrent reservation wait for the first one and then see the updated stock", async () => {
    const productId = await createProduct({ stock: 1 });
    const firstOrder = await createOrder(productId, 1);
    const secondOrder = await createOrder(productId, 1);

    const first = await db.connect();
    const second = await db.connect();

    try {
      await first.query("BEGIN");
      assert.deepEqual(await reserveOrderInventory(firstOrder, first), []);

      // Start the second reservation while the first transaction is still open
      await second.query("BEGIN");
      const secondReservation = reserveOrderInventory(secondOrder, second);
      await sleep(200);

      await first.query("COMMIT");
      const insufficient = await secondReservation;
      await second.query("ROLLBACK");

      assert.equal(insufficient.length, 1);
      assert.equal(insufficient[0].current_stock, 0);
      assert.equal(await getStock(productId), 0);
    } finally {
      first.release();
      second.release();
    }
  });

  it("only releases stock once when called repeatedly", async () => {
    const productId = await createProduct({ stock: 5 });
    const orderId = await createOrder(productId, 2);
    const client = await db.connect();

    try {
      await reserveOrderInventory(orderId, client);
      assert.equal(await releaseOrderInventory(orderId, client), true);
      assert.equal(await releaseOrderInventory(orderId, client), false);
      assert.equal(await getStock(productId), 5);
    } finally {
      client.release();
    }
  });

  it("checks the total when the same product appears on several order lines", async () => {
    const productId = await createProduct({ stock: 3 });
    const orderId = await createOrder(productId, 2);
    await db.query(
      "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, 2, 0)",
      [orderId, productId]
    );
    const client = await db.connect();

    try {
      const insufficient = await reserveOrderInventory(orderId, client);
      assert.equal(insufficient[0].quantity, 4);
      assert.equal(await getStock(productId), 3);
    } finally {
      client.release();
    }
  });
});
