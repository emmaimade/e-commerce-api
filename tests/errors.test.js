import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import request from "supertest";
import app from "../app.js";
import {
  db, resetDatabase, clearTables, closeDatabase, createUser, createAddress,
  createProduct, addToCart, getStock, countRows,
} from "./helpers/db.js";
import { mockEmail, mockPaystackInit, signedWebhook, restoreMocks } from "./helpers/mocks.js";

const bearer = (user) => ["Authorization", `Bearer ${user.token}`];
const assertJson = (res) => assert.match(res.headers["content-type"], /application\/json/);

describe("error handling and validation", () => {
  before(resetDatabase);
  beforeEach(clearTables);
  afterEach(restoreMocks);
  after(closeDatabase);

  it("returns JSON for malformed request bodies", async () => {
    const res = await request(app)
      .post("/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{bad json");

    assert.equal(res.status, 400);
    assertJson(res);
    assert.equal(res.body.success, false);
  });

  it("says which field failed validation", async () => {
    const res = await request(app).post("/v1/auth/login").send({ email: "someone@test.com" });

    assert.equal(res.status, 400);
    assert.equal(res.body.errors[0].field, "password");
  });

  it("rejects an invalid email at registration", async () => {
    const res = await request(app).post("/v1/auth/register").send({
      name: "Test",
      email: "not-an-email",
      password: "secret123",
      confirmPassword: "secret123",
    });

    assert.equal(res.status, 400);
    assert.equal(await countRows("users"), 0);
  });

  it("returns 400 for ids that aren't UUIDs", async () => {
    const user = await createUser();
    const admin = await createUser({ role: "admin" });
    const requests = [
      request(app).get("/v1/order/nope").set(...bearer(user)),
      request(app).get("/v1/order/nope/history").set(...bearer(user)),
      request(app).delete("/v1/order/nope").set(...bearer(user)),
      request(app).patch("/v1/cart/nope").set(...bearer(user)).send({ quantity: 1 }),
      request(app).delete("/v1/cart/nope").set(...bearer(user)),
      request(app).get("/v1/shipping/nope").set(...bearer(user)),
      request(app).delete("/v1/shipping/nope").set(...bearer(user)),
      request(app).get("/v1/admin/users/nope").set(...bearer(admin)),
      request(app).get("/v1/admin/products/nope").set(...bearer(admin)),
      request(app).delete("/v1/admin/products/nope").set(...bearer(admin)),
      request(app).get("/v1/admin/orders/nope").set(...bearer(admin)),
    ];

    for (const res of await Promise.all(requests)) {
      assert.equal(res.status, 400, res.request.url);
      assertJson(res);
    }
  });

  it("rejects cart quantities that aren't whole numbers", async () => {
    const user = await createUser();
    const productId = await createProduct();

    const res = await request(app).post("/v1/cart").set(...bearer(user)).send({ productId, quantity: 1.5 });

    assert.equal(res.status, 400);
    assert.equal(await countRows("cart_items"), 0);
  });

  it("requires a valid shipping address id at checkout", async () => {
    const user = await createUser();

    const missing = await request(app).post("/v1/order").set(...bearer(user)).send({});
    const malformed = await request(app)
      .post("/v1/order")
      .set(...bearer(user))
      .send({ shipping_address_id: "nope" });

    assert.deepEqual([missing.status, malformed.status], [400, 400]);
  });

  it("rejects an unknown order status", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .put("/v1/admin/orders/00000000-0000-0000-0000-000000000000/status")
      .set(...bearer(admin))
      .send({ status: "teleported" });

    assert.equal(res.status, 400);
  });

  it("rejects bad filters on the payment logs", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .get("/v1/admin/payments/logs?order_id=nope")
      .set(...bearer(admin));

    assert.equal(res.status, 400);
  });

  it("rejects non-string profile fields", async () => {
    const user = await createUser();

    const res = await request(app)
      .patch("/v1/user/updateprofile")
      .set(...bearer(user))
      .send({ name: 123 });

    assert.equal(res.status, 400);
  });

  it("accepts numbers in admin product updates", async () => {
    const admin = await createUser({ role: "admin" });
    const productId = await createProduct({ price: 1000 });

    const res = await request(app)
      .patch(`/v1/admin/products/${productId}`)
      .set(...bearer(admin))
      .send({ price: 2000 });

    assert.equal(res.status, 200);
    assert.equal(res.body.product.price, 2000);
  });

  it("rejects an unknown product status", async () => {
    const admin = await createUser({ role: "admin" });
    const productId = await createProduct();

    const res = await request(app)
      .patch(`/v1/admin/products/${productId}`)
      .set(...bearer(admin))
      .send({ status: "teleported" });

    assert.equal(res.status, 400);
  });

  it("returns JSON when an upload isn't an image", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .post("/v1/admin/products")
      .set(...bearer(admin))
      .attach("images", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });

    assert.equal(res.status, 400);
    assertJson(res);
  });

  it("returns JSON when too many images are uploaded", async () => {
    const admin = await createUser({ role: "admin" });
    let upload = request(app).post("/v1/admin/products").set(...bearer(admin));
    for (let i = 0; i < 6; i++) {
      upload = upload.attach("images", Buffer.from("x"), { filename: `${i}.png`, contentType: "image/png" });
    }

    const res = await upload;

    assert.equal(res.status, 400);
    assertJson(res);
  });

  it("explains why an ordered product can't be deleted", async () => {
    mockEmail();
    mockPaystackInit();
    const user = await createUser();
    const admin = await createUser({ role: "admin" });
    const addressId = await createAddress(user.id);
    const productId = await createProduct();
    await addToCart(user.id, productId, 1);
    await request(app).post("/v1/order").set(...bearer(user)).send({ shipping_address_id: addressId });

    const res = await request(app).delete(`/v1/admin/products/${productId}`).set(...bearer(admin));

    assert.equal(res.status, 409);
    assert.equal(await getStock(productId), 4);
  });

  it("explains why an address used by an order can't be deleted", async () => {
    mockEmail();
    mockPaystackInit();
    const user = await createUser();
    const addressId = await createAddress(user.id);
    await addToCart(user.id, await createProduct(), 1);
    await request(app).post("/v1/order").set(...bearer(user)).send({ shipping_address_id: addressId });

    const res = await request(app).delete(`/v1/shipping/${addressId}`).set(...bearer(user));

    assert.equal(res.status, 409);
    assert.equal(await countRows("addresses"), 1);
  });

  it("returns an empty list when nothing matches", async () => {
    const user = await createUser();

    const products = await request(app).get("/v1/product?search=nothing").set(...bearer(user));
    const orders = await request(app).get("/v1/order").set(...bearer(user));

    assert.equal(products.status, 200);
    assert.deepEqual(products.body.data.products, []);
    assert.equal(orders.status, 200);
    assert.deepEqual(orders.body.data, []);
  });

  it("never sends internal error details to clients", async () => {
    const user = await createUser();
    const admin = await createUser({ role: "admin" });
    const productId = await createProduct();
    mock.method(db, "query", async () => {
      throw new Error("password authentication failed for user secret_db_user");
    });
    const originalError = console.error;
    console.error = () => {};

    try {
      const responses = await Promise.all([
        request(app).get("/v1/product").set(...bearer(user)),
        request(app).get(`/v1/product/${productId}`).set(...bearer(user)),
        request(app).get("/v1/user/profile").set(...bearer(user)),
        request(app).get("/v1/order").set(...bearer(user)),
        request(app).get("/v1/shipping").set(...bearer(user)),
        request(app).get("/v1/admin/users").set(...bearer(admin)),
        request(app).get("/v1/admin/orders").set(...bearer(admin)),
        request(app).post("/v1/auth/login").send({ email: "a@test.com", password: "x" }),
      ]);

      for (const res of responses) {
        assert.equal(res.status, 500, res.request.url);
        assertJson(res);
        assert.doesNotMatch(res.text, /secret_db_user/, res.request.url);
      }
    } finally {
      console.error = originalError;
    }
  });

  it("doesn't let shared caches store customer responses", async () => {
    mockEmail();
    mockPaystackInit();
    const user = await createUser();
    const addressId = await createAddress(user.id);
    const productId = await createProduct();
    await addToCart(user.id, productId, 1);
    const order = await request(app)
      .post("/v1/order")
      .set(...bearer(user))
      .send({ shipping_address_id: addressId });
    const { reference } = order.body.data;
    const { body, signature } = signedWebhook({
      event: "charge.success",
      data: { reference, channel: "card", amount: 100000, customer: { email: user.email } },
    });
    await request(app)
      .post("/v1/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(body);

    const list = await request(app).get("/v1/product").set(...bearer(user));
    const detail = await request(app).get(`/v1/product/${productId}`).set(...bearer(user));
    const status = await request(app).get(`/v1/payments/status/${reference}`).set(...bearer(user));

    assert.equal(status.status, 200);
    for (const res of [list, detail, status]) {
      assert.doesNotMatch(res.headers["cache-control"], /public/, res.request.url);
    }
    assert.match(status.headers["cache-control"], /no-store/);
  });

  it("keeps data access and external calls out of controllers", () => {
    const dir = new URL("../controllers/v1/", import.meta.url);

    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(new URL(file, dir), "utf8");
      assert.doesNotMatch(source, /config\/db\.js|from "axios"|withTransaction/, `${file}: move this to a service`);
    }
  });

  it("keeps manual transactions out of services", () => {
    const dir = new URL("../services/", import.meta.url);

    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(new URL(file, dir), "utf8");
      assert.doesNotMatch(source, /query\("BEGIN"\)/, `${file}: use withTransaction`);
    }
  });
});
