import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import {
  resetDatabase, clearTables, closeDatabase, createUser, createAddress, createProduct, addToCart,
} from "./helpers/db.js";
import {
  mockEmail, mockPaystackInit, mockPaystackVerify, mockPaystackRefund, signedWebhook, restoreMocks,
} from "./helpers/mocks.js";

// Every email goes through its real code path, so a template using a missing
// variable fails here instead of at a customer's checkout
describe("customer emails", () => {
  let sent;
  let user;
  let admin;

  const hook = (payload) => {
    const { body, signature } = signedWebhook(payload);
    return request(app)
      .post("/v1/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(body);
  };

  const chargeSuccess = (reference) =>
    hook({
      event: "charge.success",
      data: { reference, channel: "card", amount: 300000, gateway_response: "Approved", customer: { email: user.email } },
    });

  const placeOrder = async () => {
    const addressId = await createAddress(user.id);
    await addToCart(user.id, await createProduct({ price: 1500, stock: 5 }), 2);
    const res = await request(app)
      .post("/v1/order")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ shipping_address_id: addressId });
    assert.equal(res.status, 201);
    return res.body.data;
  };

  const placePaidOrder = async () => {
    const order = await placeOrder();
    await chargeSuccess(order.reference);
    sent.length = 0;
    return order;
  };

  const cancel = (orderId) =>
    request(app).delete(`/v1/order/${orderId}`).set("Authorization", `Bearer ${user.token}`);

  const assertEmail = (subject, ...contents) => {
    const email = sent.find((message) => message.subject === subject);
    assert.ok(email, `no email with subject "${subject}"`);
    assert.doesNotMatch(email.html, /undefined|\[object Object\]/);
    for (const text of contents) assert.ok(email.html.includes(text), `missing "${text}"`);
    return email;
  };

  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    sent = mockEmail();
    mockPaystackInit();
    user = await createUser();
    admin = await createUser({ role: "admin" });
  });
  afterEach(restoreMocks);
  after(closeDatabase);

  it("sends an order confirmation with the payment link and items", async () => {
    const order = await placeOrder();

    const email = assertEmail(
      "Order Confirmation - Complete Your Payment",
      order.order_id,
      "https://checkout.paystack.test/abc",
      "Test Product",
      "3,000"
    );
    assert.equal(email.to, user.email);
  });

  it("confirms a payment received by webhook", async () => {
    const order = await placeOrder();
    sent.length = 0;

    await chargeSuccess(order.reference);

    assertEmail("Payment Confirmed - Your Order is Being Processed", order.order_id, order.reference, "3,000");
  });

  it("confirms a payment verified by the customer", async () => {
    const order = await placeOrder();
    sent.length = 0;
    mockPaystackVerify({ status: "success", channel: "card", gateway_response: "Approved" });

    const res = await request(app)
      .get(`/v1/order/payment/verify/${order.reference}`)
      .set("Authorization", `Bearer ${user.token}`);

    assert.equal(res.status, 200);
    assertEmail("Payment Confirmed - Your Order is Being Processed", order.order_id);
  });

  it("confirms a payment verified by an admin", async () => {
    const order = await placeOrder();
    sent.length = 0;
    mockPaystackVerify({ status: "success", channel: "card", gateway_response: "Approved" });

    const res = await request(app)
      .post("/v1/admin/orders/payment/verify")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ reference: order.reference });

    assert.equal(res.status, 200);
    assertEmail("Payment Confirmed - Your Order is Being Processed", order.order_id);
  });

  it("tells the customer when a refund has been processed", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund();
    await cancel(order.order_id);
    sent.length = 0;

    await hook({
      event: "refund.processed",
      data: { transaction_reference: order.reference, amount: 300000, id: 7, customer: { email: user.email } },
    });

    assertEmail("Refund Processed - Your Money is on the Way!", order.order_id, "3,000");
  });

  it("sends a status update with the admin's notes", async () => {
    const order = await placePaidOrder();

    await request(app)
      .put(`/v1/admin/orders/${order.order_id}/status`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "shipped", notes: "Left the warehouse" });

    assertEmail("Order Update - Shipped", order.order_id, "Left the warehouse");
  });

  for (const [name, refund, text] of [
    ["a processed refund", { status: "processed" }, "Refund Successfully Processed"],
    ["a pending refund", { status: "pending" }, "Refund In Progress"],
    ["a failed refund", { rejected: true }, "⚠️"],
  ]) {
    it(`explains ${name} when a paid order is cancelled`, async () => {
      const order = await placePaidOrder();
      mockPaystackRefund(refund);

      const res = await cancel(order.order_id);

      assert.equal(res.status, 200);
      assertEmail("Order Cancellation Confirmed", order.order_id, text);
    });
  }

  it("confirms cancellation of an unpaid order", async () => {
    const order = await placeOrder();
    sent.length = 0;

    await cancel(order.order_id);

    assertEmail("Order Cancellation Confirmed", order.order_id);
  });

  it("sends a password reset link", async () => {
    await request(app).post("/v1/auth/forgot-password").send({ email: user.email });

    assertEmail("Password Reset Request", "/v1/auth/reset-password/");
  });
});
