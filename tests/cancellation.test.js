import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import { expireUnpaidOrders } from "../utils/orderExpiry.js";
import {
  db, resetDatabase, clearTables, closeDatabase, createUser, createAddress,
  createProduct, addToCart, getStock, getOrder, countRows,
} from "./helpers/db.js";
import { mockEmail, mockPaystackInit, restoreMocks } from "./helpers/mocks.js";

const placeOrder = async ({ productId, stock = 5, quantity = 2 } = {}) => {
  const user = await createUser();
  const addressId = await createAddress(user.id);
  productId ??= await createProduct({ stock });
  await addToCart(user.id, productId, quantity);

  const res = await request(app)
    .post("/v1/order")
    .set("Authorization", `Bearer ${user.token}`)
    .send({ shipping_address_id: addressId });
  assert.equal(res.status, 201);

  return { user, productId, orderId: res.body.data.order_id };
};

const backdate = (orderId, hours) =>
  db.query("UPDATE orders SET placed_at = now() - make_interval(hours => $1) WHERE id = $2", [
    hours,
    orderId,
  ]);

describe("order cancellation and expiry", () => {
  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    mockEmail();
    mockPaystackInit();
  });
  afterEach(restoreMocks);
  after(closeDatabase);

  it("returns reserved stock when the customer cancels an unpaid order", async () => {
    const { user, productId, orderId } = await placeOrder({ stock: 5, quantity: 2 });
    assert.equal(await getStock(productId), 3);

    const res = await request(app)
      .delete(`/v1/order/${orderId}`)
      .set("Authorization", `Bearer ${user.token}`);

    assert.equal(res.status, 200);
    const order = await getOrder(orderId);
    assert.equal(order.order_status, "cancelled");
    assert.equal(order.inventory_reserved, false);
    assert.equal(await getStock(productId), 5);
  });

  it("refuses to cancel the same order twice", async () => {
    const { user, productId, orderId } = await placeOrder({ stock: 5, quantity: 2 });
    const cancel = () =>
      request(app).delete(`/v1/order/${orderId}`).set("Authorization", `Bearer ${user.token}`);

    await cancel();
    const res = await cancel();

    assert.equal(res.status, 400);
    assert.equal(await getStock(productId), 5);
  });

  it("returns stock when an admin cancels an order", async () => {
    const { productId, orderId } = await placeOrder({ stock: 5, quantity: 2 });
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .put(`/v1/admin/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "cancelled", notes: "Customer request" });

    assert.equal(res.status, 200);
    assert.equal(await getStock(productId), 5);
  });

  it("expires unpaid orders past the 24h window and releases their stock", async () => {
    const productId = await createProduct({ stock: 10 });
    const stale = await placeOrder({ productId, quantity: 2 });
    const fresh = await placeOrder({ productId, quantity: 3 });
    await backdate(stale.orderId, 25);

    await expireUnpaidOrders();

    assert.equal((await getOrder(stale.orderId)).order_status, "cancelled");
    assert.equal((await getOrder(fresh.orderId)).order_status, "pending");
    assert.equal(await getStock(productId), 7);
    assert.equal(
      await countRows("order_status_history", "order_id = $1 AND status = 'cancelled'", [
        stale.orderId,
      ]),
      1
    );
  });

  it("never expires paid orders", async () => {
    const { productId, orderId } = await placeOrder({ stock: 5, quantity: 2 });
    await db.query("UPDATE orders SET status = 'paid', order_status = 'processing' WHERE id = $1", [
      orderId,
    ]);
    await backdate(orderId, 48);

    await expireUnpaidOrders();

    assert.equal((await getOrder(orderId)).order_status, "processing");
    assert.equal(await getStock(productId), 3);
  });
});
