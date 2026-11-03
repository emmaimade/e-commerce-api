import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import {
  db, resetDatabase, clearTables, closeDatabase, createUser, createAddress,
  createProduct, addToCart, getStock, getOrder, countRows,
} from "./helpers/db.js";
import {
  mockEmail, mockPaystackInit, mockPaystackVerify, signedWebhook, restoreMocks,
} from "./helpers/mocks.js";

// Check out a cart of `quantity` units and return the created order
const placeOrder = async ({ stock = 5, quantity = 2 } = {}) => {
  const user = await createUser();
  const addressId = await createAddress(user.id);
  const productId = await createProduct({ price: 1000, stock });
  await addToCart(user.id, productId, quantity);

  const res = await request(app)
    .post("/v1/order")
    .set("Authorization", `Bearer ${user.token}`)
    .send({ shipping_address_id: addressId });
  assert.equal(res.status, 201);

  return { user, productId, orderId: res.body.data.order_id, reference: res.body.data.reference };
};

const sendWebhook = (payload, signature) => {
  const signed = signedWebhook(payload);
  return request(app)
    .post("/v1/payments/webhook")
    .set("Content-Type", "application/json")
    .set("x-paystack-signature", signature ?? signed.signature)
    .send(signed.body);
};

const chargeSuccess = (reference, email) => ({
  event: "charge.success",
  data: {
    reference,
    channel: "card",
    amount: 200000,
    gateway_response: "Approved",
    customer: { email },
  },
});

after(closeDatabase);

describe("Paystack webhook", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    mockEmail();
    mockPaystackInit();
  });
  afterEach(restoreMocks);

  it("marks the order paid without deducting reserved stock a second time", async () => {
    const { user, productId, orderId, reference } = await placeOrder({ stock: 5, quantity: 2 });

    const res = await sendWebhook(chargeSuccess(reference, user.email));

    assert.equal(res.status, 200);
    const order = await getOrder(orderId);
    assert.equal(order.status, "paid");
    assert.equal(order.order_status, "processing");
    assert.equal(await getStock(productId), 3);
    assert.equal(await countRows("payment_logs", "order_id = $1", [orderId]), 1);
    assert.equal(await countRows("cart_items"), 0);
  });

  it("is idempotent when Paystack delivers the same event twice", async () => {
    const { user, productId, orderId, reference } = await placeOrder();

    await sendWebhook(chargeSuccess(reference, user.email));
    const res = await sendWebhook(chargeSuccess(reference, user.email));

    assert.equal(res.status, 200);
    assert.equal(await getStock(productId), 3);
    assert.equal(await countRows("payment_logs", "order_id = $1", [orderId]), 1);
    assert.equal(
      await countRows("order_status_history", "order_id = $1 AND status = 'processing'", [orderId]),
      1
    );
  });

  it("rejects a request with an invalid signature", async () => {
    const { user, orderId, reference } = await placeOrder();

    const res = await sendWebhook(chargeSuccess(reference, user.email), "forged-signature");

    assert.equal(res.status, 400);
    assert.equal((await getOrder(orderId)).status, "pending");
  });

  it("does not revive an order that was cancelled before payment arrived", async () => {
    const { user, productId, orderId, reference } = await placeOrder({ stock: 5, quantity: 2 });
    const cancel = await request(app)
      .delete(`/v1/order/${orderId}`)
      .set("Authorization", `Bearer ${user.token}`);
    assert.equal(cancel.status, 200);

    const res = await sendWebhook(chargeSuccess(reference, user.email));

    assert.equal(res.status, 200);
    const order = await getOrder(orderId);
    assert.equal(order.order_status, "cancelled");
    assert.equal(order.status, "pending");
    assert.equal(await getStock(productId), 5);
  });

  it("deducts stock on payment for orders placed before checkout reservations existed", async () => {
    const { user, productId, orderId, reference } = await placeOrder({ stock: 5, quantity: 2 });
    // Simulate a legacy order: no stock was held at checkout
    await db.query("UPDATE orders SET inventory_reserved = false WHERE id = $1", [orderId]);
    await db.query("UPDATE products SET inventory_qty = 5 WHERE id = $1", [productId]);

    await sendWebhook(chargeSuccess(reference, user.email));

    assert.equal(await getStock(productId), 3);
    assert.equal((await getOrder(orderId)).inventory_reserved, true);
  });

  it("marks the order failed on charge.failed and keeps stock reserved", async () => {
    const { user, productId, orderId, reference } = await placeOrder();

    const res = await sendWebhook({
      event: "charge.failed",
      data: { reference, gateway_response: "Insufficient funds", customer: { email: user.email } },
    });

    assert.equal(res.status, 200);
    assert.equal((await getOrder(orderId)).status, "failed");
    assert.equal(await getStock(productId), 3);
  });
});

describe("GET /v1/order/payment/verify/:reference", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    mockEmail();
    mockPaystackInit();
  });
  afterEach(restoreMocks);

  const verify = (user, reference) =>
    request(app)
      .get(`/v1/order/payment/verify/${reference}`)
      .set("Authorization", `Bearer ${user.token}`);

  it("marks the order paid when Paystack reports success", async () => {
    const { user, productId, orderId, reference } = await placeOrder({ stock: 5, quantity: 2 });
    mockPaystackVerify({ status: "success", channel: "card", gateway_response: "Approved" });

    const res = await verify(user, reference);

    assert.equal(res.status, 200);
    const order = await getOrder(orderId);
    assert.equal(order.status, "paid");
    assert.equal(order.order_status, "processing");
    assert.equal(await getStock(productId), 3);
    assert.equal(await countRows("cart_items"), 0);
  });

  it("leaves the order pending while the customer is still paying", async () => {
    const { user, orderId, reference } = await placeOrder();
    mockPaystackVerify({ status: "abandoned" });

    const res = await verify(user, reference);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.payment_status, "abandoned");
    assert.equal((await getOrder(orderId)).status, "pending");
  });

  it("does not let a user verify someone else's order", async () => {
    const { reference } = await placeOrder();
    const stranger = await createUser();

    const res = await verify(stranger, reference);

    assert.equal(res.status, 400);
  });
});
