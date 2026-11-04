import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import {
  db, resetDatabase, clearTables, closeDatabase, createUser, createAddress,
  createProduct, addToCart, getStock, getOrder, countRows, leakedConnections, openTransactions,
} from "./helpers/db.js";
import { mockEmail, mockPaystackInit, restoreMocks } from "./helpers/mocks.js";

const checkout = (user, addressId) =>
  request(app)
    .post("/v1/order")
    .set("Authorization", `Bearer ${user.token}`)
    .send({ shipping_address_id: addressId });

describe("POST /v1/order (checkout)", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    mockEmail();
  });
  afterEach(restoreMocks);
  after(closeDatabase);

  it("creates the order, reserves stock and returns a payment link", async () => {
    mockPaystackInit();
    const user = await createUser();
    const addressId = await createAddress(user.id);
    const productId = await createProduct({ price: 1500, stock: 5 });
    await addToCart(user.id, productId, 2);

    const res = await checkout(user, addressId);

    assert.equal(res.status, 201);
    assert.equal(res.body.data.amount, 3000);
    assert.equal(res.body.data.payment_url, "https://checkout.paystack.test/abc");

    const order = await getOrder(res.body.data.order_id);
    assert.equal(order.status, "pending");
    assert.equal(order.inventory_reserved, true);
    assert.equal(order.payment_ref, res.body.data.reference);
    assert.equal(await getStock(productId), 3);
  });

  it("rejects the order without reserving anything when stock is short", async () => {
    mockPaystackInit();
    const user = await createUser();
    const addressId = await createAddress(user.id);
    const productId = await createProduct({ stock: 1 });
    await addToCart(user.id, productId, 2);

    const res = await checkout(user, addressId);

    assert.equal(res.status, 400);
    assert.equal(res.body.data.out_of_stock_items[0].available, 1);
    assert.equal(await countRows("orders"), 0);
    assert.equal(await getStock(productId), 1);
  });

  // End-to-end check only: the requests don't always overlap, so the locking
  // itself is verified deterministically in inventory.test.js
  it("only lets one of two simultaneous checkouts buy the last unit", async () => {
    mockPaystackInit();
    const productId = await createProduct({ stock: 1 });
    const buyers = [];
    for (let i = 0; i < 2; i++) {
      const user = await createUser();
      const addressId = await createAddress(user.id);
      await addToCart(user.id, productId, 1);
      buyers.push({ user, addressId });
    }

    const results = await Promise.all(buyers.map((b) => checkout(b.user, b.addressId)));

    assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
    assert.equal(await getStock(productId), 0);
    assert.equal(await countRows("orders"), 1);
  });

  it("removes the order and releases stock when Paystack rejects initialization", async () => {
    mockPaystackInit({ ok: false });
    const user = await createUser();
    const addressId = await createAddress(user.id);
    const productId = await createProduct({ stock: 5 });
    await addToCart(user.id, productId, 2);

    const res = await checkout(user, addressId);

    assert.equal(res.status, 500);
    assert.equal(await countRows("orders"), 0);
    assert.equal(await getStock(productId), 5);
  });

  it("removes the order and releases stock when Paystack is unreachable", async () => {
    mockPaystackInit({ networkError: true });
    const user = await createUser();
    const addressId = await createAddress(user.id);
    const productId = await createProduct({ stock: 5 });
    await addToCart(user.id, productId, 2);

    const res = await checkout(user, addressId);

    assert.equal(res.status, 500);
    assert.equal(await countRows("orders"), 0);
    assert.equal(await getStock(productId), 5);
  });

  it("sends Paystack a callback URL the app actually serves", async () => {
    const initialize = mockPaystackInit();
    const user = await createUser();
    const addressId = await createAddress(user.id);
    await addToCart(user.id, await createProduct(), 1);

    await checkout(user, addressId);

    const { callback_url } = initialize.mock.calls[0].arguments[1];
    const { pathname, search } = new URL(callback_url);
    assert.equal(pathname, "/v1/payments/callback");
    // Paystack adds trxref and reference to the query string itself
    assert.equal(search, "");
  });

  it("returns its connection when listing orders", async () => {
    const user = await createUser();

    const res = await request(app)
      .get("/v1/order")
      .set("Authorization", `Bearer ${user.token}`);

    assert.equal(res.status, 200);
    assert.equal(leakedConnections(), 0);
    assert.equal(await openTransactions(), 0);
  });

  it("refuses checkout when a cart product is no longer for sale", async () => {
    mockPaystackInit();
    const user = await createUser();
    const addressId = await createAddress(user.id);
    const productId = await createProduct({ stock: 5 });
    await addToCart(user.id, productId, 1);
    await db.query("UPDATE products SET status = 'inactive' WHERE id = $1", [productId]);

    const res = await checkout(user, addressId);

    assert.equal(res.status, 400);
    assert.equal(await countRows("orders"), 0);
    assert.equal(await getStock(productId), 5);
  });

  it("rejects a shipping address that belongs to another user", async () => {
    mockPaystackInit();
    const user = await createUser();
    const otherUser = await createUser();
    const otherAddressId = await createAddress(otherUser.id);
    const productId = await createProduct();
    await addToCart(user.id, productId, 1);

    const res = await checkout(user, otherAddressId);

    assert.equal(res.status, 404);
    assert.equal(await countRows("orders"), 0);
  });
});
