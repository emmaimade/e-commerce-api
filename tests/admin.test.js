import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import request from "supertest";
import app from "../app.js";
import cloudinary from "../config/cloudinary.js";
import { reserveOrderInventory } from "../services/inventoryService.js";
import {
  db, resetDatabase, clearTables, closeDatabase, createUser, createAddress,
  createProduct, addToCart, getStock, countRows,
} from "./helpers/db.js";
import { mockEmail, mockPaystackInit, mockPaystackVerify, restoreMocks } from "./helpers/mocks.js";

const product = async (id) =>
  (await db.query("SELECT * FROM products WHERE id = $1", [id])).rows[0];

describe("admin products", () => {
  let admin;
  const as = (method, path) =>
    request(app)[method](`/v1/admin${path}`).set("Authorization", `Bearer ${admin.token}`);
  const adjustStock = (id, inventory_qty, extra = {}) =>
    as("patch", `/products/${id}`).send({ inventory_qty, ...extra });

  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    admin = await createUser({ role: "admin" });
  });
  afterEach(restoreMocks);

  it("adds to and removes from stock", async () => {
    const id = await createProduct({ stock: 5 });

    assert.equal((await adjustStock(id, 3)).status, 200);
    assert.equal(await getStock(id), 8);
    assert.equal((await adjustStock(id, "-2")).status, 200);
    assert.equal(await getStock(id), 6);
  });

  it("refuses to take stock below zero", async () => {
    const id = await createProduct({ stock: 5 });

    const res = await adjustStock(id, -6);

    assert.equal(res.status, 400);
    assert.equal(await getStock(id), 5);
  });

  it("marks a product out of stock when stock reaches zero, and active when it returns", async () => {
    const id = await createProduct({ stock: 5 });

    assert.equal((await adjustStock(id, -5)).status, 200);
    assert.equal((await product(id)).status, "out_of_stock");
    assert.equal((await adjustStock(id, 2)).status, 200);
    assert.equal((await product(id)).status, "active");
  });

  it("doesn't reactivate an inactive product when stock changes", async () => {
    const id = await createProduct({ stock: 5 });
    await db.query("UPDATE products SET status = 'inactive' WHERE id = $1", [id]);

    await adjustStock(id, 3);

    assert.equal((await product(id)).status, "inactive");
  });

  it("respects a status sent with a stock change", async () => {
    const id = await createProduct({ stock: 5 });

    await adjustStock(id, 3, { status: "inactive" });

    assert.equal((await product(id)).status, "inactive");
    assert.equal(await getStock(id), 8);
  });

  it("doesn't overwrite a reservation that happens during a stock change", async () => {
    const user = await createUser();
    const id = await createProduct({ stock: 5 });
    const order = await db.query("INSERT INTO orders (user_id, total) VALUES ($1, 0) RETURNING id", [user.id]);
    const orderId = order.rows[0].id;
    await db.query(
      "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, 1, 0)",
      [orderId, id]
    );
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      await reserveOrderInventory(orderId, client);

      // The stock change starts while the reservation is uncommitted
      const change = adjustStock(id, 5).then((res) => res);
      await sleep(200);
      await client.query("COMMIT");

      assert.equal((await change).status, 200);
      assert.equal(await getStock(id), 9);
    } finally {
      client.release();
    }
  });

  it("updates other product fields", async () => {
    const id = await createProduct();

    const res = await as("patch", `/products/${id}`).send({ name: "Renamed", description: "New" });

    assert.equal(res.status, 200);
    assert.equal(res.body.product.name, "Renamed");
  });

  it("rejects invalid prices and empty updates", async () => {
    const id = await createProduct();

    const attempts = await Promise.all([
      as("patch", `/products/${id}`).send({ price: "abc" }),
      as("patch", `/products/${id}`).send({ price: -1 }),
      as("patch", `/products/${id}`).send({ inventory_qty: "abc" }),
      as("patch", `/products/${id}`).send({}),
    ]);

    assert.deepEqual(attempts.map((r) => r.status), [400, 400, 400, 400]);
  });

  it("returns 404 for a product that doesn't exist", async () => {
    const res = await as("patch", "/products/00000000-0000-0000-0000-000000000000").send({ name: "x" });

    assert.equal(res.status, 404);
  });

  it("uploads product images to Cloudinary", async () => {
    mock.method(cloudinary.uploader, "upload", (url, options, callback) => {
      callback(null, { secure_url: "https://img.test/a.png", public_id: "products/a", width: 1, height: 1, format: "png" });
    });

    const res = await as("post", "/products").send({
      name: "Lamp",
      description: "A lamp",
      price: 1000,
      inventory_qty: 3,
      image_urls: ["https://example.test/a.png"],
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.product.images[0].public_id, "products/a");
    assert.equal(res.body.product.images[0].is_primary, true);
  });

  it("removes an image and promotes the next one", async () => {
    const id = await createProduct();
    await db.query("UPDATE products SET images = $1 WHERE id = $2", [
      JSON.stringify([
        { url: "a", public_id: "products/a", is_primary: true, display_order: 0 },
        { url: "b", public_id: "products/b", is_primary: false, display_order: 1 },
      ]),
      id,
    ]);
    const destroy = mock.method(cloudinary.uploader, "destroy", async () => ({ result: "ok" }));

    const res = await as("patch", `/products/${id}/images`).send({ publicId: "products/a" });

    assert.equal(res.status, 200);
    assert.equal(destroy.mock.callCount(), 1);
    const { images } = await product(id);
    assert.equal(images.length, 1);
    assert.equal(images[0].public_id, "products/b");
    assert.equal(images[0].is_primary, true);
  });

  it("deletes an unused product and its images", async () => {
    const id = await createProduct();
    await db.query("UPDATE products SET images = $1 WHERE id = $2", [
      JSON.stringify([{ url: "a", public_id: "products/a" }]),
      id,
    ]);
    const destroy = mock.method(cloudinary.uploader, "destroy", async () => ({ result: "ok" }));

    const res = await as("delete", `/products/${id}`);

    assert.equal(res.status, 200);
    assert.equal(destroy.mock.callCount(), 1);
    assert.equal(await countRows("products"), 0);
  });
});

describe("admin orders and payments", () => {
  let admin;
  let customer;
  let orderId;
  let reference;
  const as = (method, path) =>
    request(app)[method](`/v1/admin${path}`).set("Authorization", `Bearer ${admin.token}`);

  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    mockEmail();
    mockPaystackInit();
    admin = await createUser({ role: "admin" });
    customer = await createUser();
    const addressId = await createAddress(customer.id);
    await addToCart(customer.id, await createProduct(), 2);
    const res = await request(app)
      .post("/v1/order")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ shipping_address_id: addressId });
    ({ order_id: orderId, reference } = res.body.data);
  });
  afterEach(restoreMocks);

  it("lists and filters orders", async () => {
    const all = await as("get", "/orders");
    const pending = await as("get", "/orders?order_status=pending");
    const shipped = await as("get", "/orders?order_status=shipped");

    assert.equal(all.status, 200);
    assert.equal(pending.status, 200);
    assert.equal(shipped.status, 200);
    assert.equal(JSON.stringify(pending.body).includes(orderId), true);
    assert.equal(JSON.stringify(shipped.body).includes(orderId), false);
  });

  it("returns a single order with its items", async () => {
    const found = await as("get", `/orders/${orderId}`);
    const missing = await as("get", "/orders/00000000-0000-0000-0000-000000000000");

    assert.equal(found.status, 200);
    assert.equal(JSON.stringify(found.body).includes(orderId), true);
    assert.equal(missing.status, 404);
  });

  it("verifies a payment manually and reports it in logs and analytics", async () => {
    mockPaystackVerify({ status: "success", channel: "card", gateway_response: "Approved" });

    const verify = await as("post", "/orders/payment/verify").send({ reference });
    const again = await as("post", "/orders/payment/verify").send({ reference });
    const status = await as("get", `/payments/status/${reference}`);
    const logs = await as("get", "/payments/logs?status=paid");
    const analytics = await as("get", "/payments/analytics?period=7d");

    assert.equal(verify.status, 200);
    assert.equal(again.status, 409);
    assert.equal(status.status, 200);
    assert.equal(logs.status, 200);
    assert.equal(JSON.stringify(logs.body).includes(reference), true);
    assert.equal(analytics.status, 200);
  });

  it("clears the customer's cart when a payment is verified manually", async () => {
    mockPaystackVerify({ status: "success", channel: "card", gateway_response: "Approved" });

    await as("post", "/orders/payment/verify").send({ reference });

    assert.equal(await countRows("cart_items"), 0);
  });

  it("leaves the order pending while the customer is still paying", async () => {
    mockPaystackVerify({ status: "abandoned" });

    const res = await as("post", "/orders/payment/verify").send({ reference });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.payment_status, "abandoned");
  });

  it("records a failed payment found during manual verification", async () => {
    mockPaystackVerify({ status: "failed", channel: "card", gateway_response: "Declined" });

    const res = await as("post", "/orders/payment/verify").send({ reference });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.payment_status, "failed");
    assert.equal(await countRows("payment_logs", "status = 'failed'"), 1);
  });

  it("filters payment logs by date and rejects bad dates", async () => {
    const ok = await as("get", "/payments/logs?date_from=2026-01-01&date_to=2026-12-31");
    const bad = await as("get", "/payments/logs?date_to=31-12-2026");

    assert.equal(ok.status, 200);
    assert.equal(bad.status, 400);
  });
});

after(closeDatabase);
