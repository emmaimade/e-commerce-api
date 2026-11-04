import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import {
  resetDatabase, clearTables, closeDatabase, createUser, createAddress, createProduct,
  addToCart, getStock, getOrder, countRows, openTransactions, leakedConnections,
} from "./helpers/db.js";
import {
  mockEmail, mockPaystackInit, mockPaystackRefund, signedWebhook, restoreMocks,
} from "./helpers/mocks.js";

const sendWebhook = (payload) => {
  const { body, signature } = signedWebhook(payload);
  return request(app)
    .post("/v1/payments/webhook")
    .set("Content-Type", "application/json")
    .set("x-paystack-signature", signature)
    .send(body);
};

const chargeSuccess = (reference, email) => ({
  event: "charge.success",
  data: { reference, channel: "card", amount: 200000, gateway_response: "Approved", customer: { email } },
});

const placeOrder = async () => {
  const user = await createUser();
  const addressId = await createAddress(user.id);
  const productId = await createProduct({ price: 1000, stock: 5 });
  await addToCart(user.id, productId, 2);

  const res = await request(app)
    .post("/v1/order")
    .set("Authorization", `Bearer ${user.token}`)
    .send({ shipping_address_id: addressId });
  assert.equal(res.status, 201);

  return { user, productId, orderId: res.body.data.order_id, reference: res.body.data.reference };
};

const placePaidOrder = async () => {
  const placed = await placeOrder();
  await sendWebhook(chargeSuccess(placed.reference, placed.user.email));
  return placed;
};

const cancelAsCustomer = ({ user, orderId }) =>
  request(app).delete(`/v1/order/${orderId}`).set("Authorization", `Bearer ${user.token}`);

const setStatus = (admin, orderId, status) =>
  request(app)
    .put(`/v1/admin/orders/${orderId}/status`)
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ status });

const logCount = (orderId, status) =>
  countRows("payment_logs", "order_id = $1 AND status = $2", [orderId, status]);

let sent;

after(closeDatabase);

describe("refund webhooks", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    sent = mockEmail();
    mockPaystackInit();
  });
  afterEach(restoreMocks);

  const refundEvent = (event, reference, email) => ({
    event,
    data: { transaction_reference: reference, amount: 200000, id: 1, customer: { email } },
  });

  it("records a processed refund alongside the original payment", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund();
    await cancelAsCustomer(order);

    const res = await sendWebhook(refundEvent("refund.processed", order.reference, order.user.email));

    assert.equal(res.status, 200);
    assert.equal((await getOrder(order.orderId)).status, "refunded");
    assert.equal(await logCount(order.orderId, "paid"), 1);
    assert.equal(await logCount(order.orderId, "refunded"), 1);
  });

  it("handles a repeated refund.processed event only once", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund();
    await cancelAsCustomer(order);
    const event = refundEvent("refund.processed", order.reference, order.user.email);

    await sendWebhook(event);
    const emailsAfterFirst = sent.length;
    const res = await sendWebhook(event);

    assert.equal(res.status, 200);
    assert.equal(await logCount(order.orderId, "refunded"), 1);
    assert.equal(
      await countRows("order_status_history", "order_id = $1 AND status = 'refunded'", [order.orderId]),
      1
    );
    assert.equal(sent.length, emailsAfterFirst);
  });

  for (const [event, status] of [
    ["refund.failed", "refund_failed"],
    ["refund.pending", "refund_pending"],
  ]) {
    it(`records ${event} and tolerates duplicates`, async () => {
      const order = await placePaidOrder();
      const payload = refundEvent(event, order.reference, order.user.email);

      await sendWebhook(payload);
      const res = await sendWebhook(payload);

      assert.equal(res.status, 200);
      assert.equal(await logCount(order.orderId, status), 1);
      assert.equal(
        await countRows("order_status_history", "order_id = $1 AND status = $2", [order.orderId, status]),
        1
      );
    });
  }
});

describe("retrying a failed payment", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    sent = mockEmail();
    mockPaystackInit();
  });
  afterEach(restoreMocks);

  it("marks the order paid when a charge succeeds after a failure", async () => {
    const { user, orderId, reference } = await placeOrder();

    await sendWebhook({
      event: "charge.failed",
      data: { reference, gateway_response: "Insufficient funds", customer: { email: user.email } },
    });
    await sendWebhook(chargeSuccess(reference, user.email));

    const order = await getOrder(orderId);
    assert.equal(order.status, "paid");
    assert.equal(order.order_status, "processing");
    assert.equal(await logCount(orderId, "failed"), 1);
    assert.equal(await logCount(orderId, "paid"), 1);
  });
});

describe("cancelling a paid order", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    sent = mockEmail();
    mockPaystackInit();
  });
  afterEach(restoreMocks);

  it("refunds the customer and returns the stock", async () => {
    const order = await placePaidOrder();
    const refund = mockPaystackRefund();

    const res = await cancelAsCustomer(order);

    assert.equal(res.status, 200);
    assert.equal(refund.mock.callCount(), 1);
    assert.equal(refund.mock.calls[0].arguments[1].amount, 200000);
    assert.equal((await getOrder(order.orderId)).order_status, "cancelled");
    assert.equal(await getStock(order.productId), 5);
  });

  it("holds no transaction open while calling Paystack", async () => {
    const order = await placePaidOrder();
    let openDuringRefund;
    mockPaystackRefund({
      onCall: async () => {
        openDuringRefund = await openTransactions();
      },
    });

    await cancelAsCustomer(order);

    assert.equal(openDuringRefund, 0);
    assert.equal(leakedConnections(), 0);
  });

  for (const [name, failure] of [
    ["rejects", { rejected: true }],
    ["can't be reached", { networkError: true }],
  ]) {
    it(`keeps the cancellation and records a failed refund when Paystack ${name}`, async () => {
      const order = await placePaidOrder();
      mockPaystackRefund(failure);

      const res = await cancelAsCustomer(order);

      assert.equal(res.status, 200);
      const saved = await getOrder(order.orderId);
      assert.equal(saved.order_status, "cancelled");
      assert.equal(saved.status, "paid");
      assert.equal(await logCount(order.orderId, "refund_failed"), 1);
      assert.equal(await getStock(order.productId), 5);
    });
  }

  it("refunds when an admin cancels a paid order", async () => {
    const order = await placePaidOrder();
    const admin = await createUser({ role: "admin" });
    const refund = mockPaystackRefund();

    const res = await setStatus(admin, order.orderId, "cancelled");

    assert.equal(res.status, 200);
    assert.equal(refund.mock.callCount(), 1);
    assert.equal(await getStock(order.productId), 5);
  });

  it("doesn't call Paystack when an admin cancels an unpaid order", async () => {
    const order = await placeOrder();
    const admin = await createUser({ role: "admin" });
    const refund = mockPaystackRefund();

    const res = await setStatus(admin, order.orderId, "cancelled");

    assert.equal(res.status, 200);
    assert.equal(refund.mock.callCount(), 0);
  });
});

describe("admin order status changes", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    sent = mockEmail();
    mockPaystackInit();
  });
  afterEach(restoreMocks);

  it("moves a paid order through shipping to delivery", async () => {
    const { orderId } = await placePaidOrder();
    const admin = await createUser({ role: "admin" });

    const shipped = await setStatus(admin, orderId, "shipped");
    const delivered = await setStatus(admin, orderId, "delivered");

    assert.deepEqual([shipped.status, delivered.status], [200, 200]);
    assert.equal((await getOrder(orderId)).order_status, "delivered");
  });

  it("refuses to ship an order that hasn't been paid", async () => {
    const { orderId } = await placeOrder();
    const admin = await createUser({ role: "admin" });

    const res = await setStatus(admin, orderId, "shipped");

    assert.equal(res.status, 409);
    assert.equal((await getOrder(orderId)).order_status, "pending");
  });

  it("refuses to reopen a cancelled order", async () => {
    const order = await placeOrder();
    const admin = await createUser({ role: "admin" });
    await cancelAsCustomer(order);

    for (const status of ["processing", "shipped", "delivered", "cancelled"]) {
      const res = await setStatus(admin, order.orderId, status);
      assert.equal(res.status, 409, status);
    }
    assert.equal((await getOrder(order.orderId)).order_status, "cancelled");
  });

  it("refuses to move a delivered order backwards", async () => {
    const { orderId } = await placePaidOrder();
    const admin = await createUser({ role: "admin" });
    await setStatus(admin, orderId, "shipped");
    await setStatus(admin, orderId, "delivered");

    const res = await setStatus(admin, orderId, "processing");

    assert.equal(res.status, 409);
    assert.equal((await getOrder(orderId)).order_status, "delivered");
  });

  it("commits before emailing the customer", async () => {
    const { orderId } = await placePaidOrder();
    const admin = await createUser({ role: "admin" });
    let openDuringEmail;
    restoreMocks();
    sent = mockEmail({
      onSend: async () => {
        openDuringEmail = await openTransactions();
      },
    });

    await setStatus(admin, orderId, "shipped");

    assert.equal(openDuringEmail, 0);
    assert.equal(sent.length, 1);
  });
});
