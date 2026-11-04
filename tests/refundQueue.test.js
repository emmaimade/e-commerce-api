import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import { retryDueRefunds } from "../services/refundService.js";
import {
  db, resetDatabase, clearTables, closeDatabase, createUser, createAddress, createProduct,
  addToCart, getOrder, countRows, leakedConnections,
} from "./helpers/db.js";
import {
  mockEmail, mockPaystackInit, mockPaystackRefund, mockPaystackVerify, signedWebhook, restoreMocks,
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
  await addToCart(user.id, await createProduct({ price: 1000, stock: 5 }), 2);

  const res = await request(app)
    .post("/v1/order")
    .set("Authorization", `Bearer ${user.token}`)
    .send({ shipping_address_id: addressId });
  assert.equal(res.status, 201);

  return { user, orderId: res.body.data.order_id, reference: res.body.data.reference };
};

const placePaidOrder = async () => {
  const placed = await placeOrder();
  await sendWebhook(chargeSuccess(placed.reference, placed.user.email));
  return placed;
};

const cancel = ({ user, orderId }) =>
  request(app).delete(`/v1/order/${orderId}`).set("Authorization", `Bearer ${user.token}`);

const refundFor = async (reference) =>
  (await db.query("SELECT * FROM refunds WHERE payment_reference = $1", [reference])).rows[0];

const makeDue = (reference) =>
  db.query("UPDATE refunds SET next_attempt_at = now() - interval '1 minute' WHERE payment_reference = $1", [reference]);

const logCount = (orderId, status) =>
  countRows("payment_logs", "order_id = $1 AND status = $2", [orderId, status]);

after(closeDatabase);

describe("refund queue", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    mockEmail();
    mockPaystackInit();
  });
  afterEach(restoreMocks);

  it("records the refund before calling Paystack", async () => {
    const order = await placePaidOrder();
    let savedDuringCall;
    mockPaystackRefund({
      onCall: async () => {
        savedDuringCall = await refundFor(order.reference);
      },
    });

    await cancel(order);

    assert.equal(savedDuringCall.status, "processing");
    assert.equal(savedDuringCall.amount, 2000);
    assert.equal((await refundFor(order.reference)).status, "pending");
    assert.equal(leakedConnections(), 0);
  });

  it("schedules a retry when Paystack can't be reached", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ networkError: true });

    const res = await cancel(order);

    const refund = await refundFor(order.reference);
    assert.equal(res.status, 200);
    assert.equal(res.body.refund.status, "pending");
    assert.equal(refund.status, "required");
    assert.equal(refund.attempts, 1);
    assert.ok(refund.next_attempt_at > new Date());
    assert.equal(await logCount(order.orderId, "refund_failed"), 0);
  });

  it("completes a scheduled refund once Paystack is back", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ networkError: true });
    await cancel(order);
    await makeDue(order.reference);
    restoreMocks();
    mockEmail();
    const refund = mockPaystackRefund();

    await retryDueRefunds();

    assert.equal(refund.mock.callCount(), 1);
    assert.equal((await refundFor(order.reference)).status, "pending");
  });

  it("leaves refunds that aren't due yet alone", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ networkError: true });
    await cancel(order);
    restoreMocks();
    mockEmail();
    const refund = mockPaystackRefund();

    await retryDueRefunds();

    assert.equal(refund.mock.callCount(), 0);
  });

  it("stops retrying once Paystack reports the refund, so a timed-out request can't pay twice", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ networkError: true });
    await cancel(order);
    await makeDue(order.reference);
    restoreMocks();
    mockEmail();
    const refund = mockPaystackRefund();

    await sendWebhook({
      event: "refund.pending",
      data: { transaction_reference: order.reference, amount: 200000, id: 1, customer: { email: order.user.email } },
    });
    await retryDueRefunds();

    assert.equal(refund.mock.callCount(), 0);
    assert.equal((await refundFor(order.reference)).status, "pending");
  });

  it("marks the refund failed at once when Paystack rejects it", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ rejected: true });

    const res = await cancel(order);

    const refund = await refundFor(order.reference);
    assert.equal(res.body.refund.status, "failed");
    assert.equal(refund.status, "failed");
    assert.equal(refund.last_error, "Refund rejected");
    assert.equal(await logCount(order.orderId, "refund_failed"), 1);
  });

  it("gives up after the maximum number of attempts", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ networkError: true });
    await cancel(order);

    for (let i = 0; i < 4; i++) {
      await makeDue(order.reference);
      await retryDueRefunds();
    }

    const refund = await refundFor(order.reference);
    assert.equal(refund.attempts, 5);
    assert.equal(refund.status, "failed");
    assert.equal(await logCount(order.orderId, "refund_failed"), 1);
  });

  it("only sends a due refund once when two workers run together", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ networkError: true });
    await cancel(order);
    await makeDue(order.reference);
    restoreMocks();
    mockEmail();
    const refund = mockPaystackRefund();

    await Promise.all([retryDueRefunds(), retryDueRefunds()]);

    assert.equal(refund.mock.callCount(), 1);
  });

  it("picks up a refund left mid-attempt by a crash", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ networkError: true });
    await cancel(order);
    await db.query(
      "UPDATE refunds SET status = 'processing', updated_at = now() - interval '1 hour' WHERE payment_reference = $1",
      [order.reference]
    );
    restoreMocks();
    mockEmail();
    const refund = mockPaystackRefund();

    await retryDueRefunds();

    assert.equal(refund.mock.callCount(), 1);
  });

  it("marks the refund processed when Paystack confirms it", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund();
    await cancel(order);

    await sendWebhook({
      event: "refund.processed",
      data: { transaction_reference: order.reference, amount: 200000, id: 1, customer: { email: order.user.email } },
    });

    assert.equal((await refundFor(order.reference)).status, "processed");
    assert.equal((await getOrder(order.orderId)).status, "refunded");
  });

  for (const event of ["refund.failed", "refund.needs-attention"]) {
    it(`marks the refund failed on ${event}`, async () => {
      const order = await placePaidOrder();
      mockPaystackRefund();
      await cancel(order);

      const res = await sendWebhook({
        event,
        data: { transaction_reference: order.reference, id: 1, customer: { email: order.user.email } },
      });

      assert.equal(res.status, 200);
      assert.equal((await refundFor(order.reference)).status, "failed");
      assert.equal(await logCount(order.orderId, "refund_failed"), 1);
    });
  }
});

describe("late payments", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    mockEmail();
    mockPaystackInit();
  });
  afterEach(restoreMocks);

  it("refunds a payment that arrives after the order was cancelled", async () => {
    const order = await placeOrder();
    await cancel(order);
    const refund = mockPaystackRefund();

    const res = await sendWebhook(chargeSuccess(order.reference, order.user.email));

    assert.equal(res.status, 200);
    assert.equal(refund.mock.callCount(), 1);
    assert.equal(refund.mock.calls[0].arguments[1].amount, 200000);
    assert.equal((await refundFor(order.reference)).requested_by, "late_payment");
    assert.equal(await logCount(order.orderId, "late_payment"), 1);
    assert.equal((await getOrder(order.orderId)).order_status, "cancelled");
  });

  it("only refunds once when the webhook is delivered twice", async () => {
    const order = await placeOrder();
    await cancel(order);
    const refund = mockPaystackRefund();

    await sendWebhook(chargeSuccess(order.reference, order.user.email));
    await sendWebhook(chargeSuccess(order.reference, order.user.email));

    assert.equal(refund.mock.callCount(), 1);
    assert.equal(await countRows("refunds"), 1);
  });

  it("refunds a late payment found by the customer's verify request", async () => {
    const order = await placeOrder();
    await cancel(order);
    mockPaystackVerify({ status: "success", channel: "card", amount: 200000, gateway_response: "Approved" });
    const refund = mockPaystackRefund();

    const res = await request(app)
      .get(`/v1/order/payment/verify/${order.reference}`)
      .set("Authorization", `Bearer ${order.user.token}`);

    assert.equal(res.status, 409);
    assert.equal(refund.mock.callCount(), 1);
  });

  it("doesn't refund a repeated webhook for a normal paid order", async () => {
    const order = await placePaidOrder();
    const refund = mockPaystackRefund();

    await sendWebhook(chargeSuccess(order.reference, order.user.email));

    assert.equal(refund.mock.callCount(), 0);
    assert.equal(await countRows("refunds"), 0);
  });
});

describe("admin refunds", () => {
  let admin;
  const as = (method, path) =>
    request(app)[method](`/v1/admin${path}`).set("Authorization", `Bearer ${admin.token}`);

  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    mockEmail();
    mockPaystackInit();
    admin = await createUser({ role: "admin" });
  });
  afterEach(restoreMocks);

  it("lists refunds and filters by status", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ rejected: true });
    await cancel(order);

    const failed = await as("get", "/refunds?status=failed");
    const pending = await as("get", "/refunds?status=pending");

    assert.equal(failed.status, 200);
    assert.equal(failed.body.data.refunds.length, 1);
    assert.equal(failed.body.data.refunds[0].payment_reference, order.reference);
    assert.equal(failed.body.data.refunds[0].last_error, "Refund rejected");
    assert.equal(pending.body.data.refunds.length, 0);
  });

  it("retries a failed refund", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund({ rejected: true });
    await cancel(order);
    const { id } = await refundFor(order.reference);
    restoreMocks();
    mockEmail();
    const refund = mockPaystackRefund();

    const res = await as("post", `/refunds/${id}/retry`);

    assert.equal(res.status, 200);
    assert.equal(refund.mock.callCount(), 1);
    assert.equal((await refundFor(order.reference)).status, "pending");
  });

  it("refuses to retry a refund that hasn't failed", async () => {
    const order = await placePaidOrder();
    mockPaystackRefund();
    await cancel(order);
    const { id } = await refundFor(order.reference);

    const res = await as("post", `/refunds/${id}/retry`);

    assert.equal(res.status, 409);
  });

  it("rejects bad ids, unknown refunds and bad filters", async () => {
    const attempts = await Promise.all([
      as("post", "/refunds/nope/retry"),
      as("post", "/refunds/999999/retry"),
      as("get", "/refunds?status=teleported"),
    ]);

    assert.deepEqual(attempts.map((r) => r.status), [400, 404, 400]);
  });

  it("is for admins only", async () => {
    const customer = await createUser();

    const res = await request(app)
      .get("/v1/admin/refunds")
      .set("Authorization", `Bearer ${customer.token}`);

    assert.equal(res.status, 403);
  });
});
