import "./helpers/setup.js";
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import {
  db, resetDatabase, clearTables, closeDatabase, createUser, createProduct, addToCart,
  openTransactions, leakedConnections, countRows,
} from "./helpers/db.js";

const add = (user, body) =>
  request(app).post("/v1/cart").set("Authorization", `Bearer ${user.token}`).send(body);

const update = (user, itemId, quantity) =>
  request(app)
    .patch(`/v1/cart/${itemId}`)
    .set("Authorization", `Bearer ${user.token}`)
    .send({ quantity });

const cartItem = async () => (await db.query("SELECT * FROM cart_items")).rows[0];

describe("cart", () => {
  before(resetDatabase);
  beforeEach(clearTables);
  after(closeDatabase);

  it("changes the quantity of a cart item", async () => {
    const user = await createUser();
    const productId = await createProduct({ price: 1000, stock: 5 });
    await addToCart(user.id, productId, 1);
    const item = await cartItem();

    const res = await update(user, item.id, 3);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.item_total, 3000);
    assert.equal((await cartItem()).quantity, 3);
  });

  it("leaves no transaction open after rejecting an add", async () => {
    const user = await createUser();
    const productId = await createProduct({ stock: 1 });

    const invalid = await add(user, { productId, quantity: "abc" });
    const zero = await add(user, { productId, quantity: 0 });
    const tooMany = await add(user, { productId, quantity: 2 });

    assert.deepEqual([invalid.status, zero.status, tooMany.status], [400, 400, 400]);
    assert.equal(await openTransactions(), 0);
    assert.equal(leakedConnections(), 0);
  });

  it("leaves no transaction open after rejecting a quantity change", async () => {
    const user = await createUser();
    const productId = await createProduct({ stock: 2 });
    await addToCart(user.id, productId, 1);
    const item = await cartItem();

    const invalid = await update(user, item.id, 0);
    const tooMany = await update(user, item.id, 3);

    assert.deepEqual([invalid.status, tooMany.status], [400, 400]);
    assert.equal(await openTransactions(), 0);
    assert.equal(leakedConnections(), 0);
  });

  it("doesn't let repeated adds go past the available stock", async () => {
    const user = await createUser();
    const productId = await createProduct({ stock: 5 });

    const first = await add(user, { productId, quantity: 4 });
    const second = await add(user, { productId, quantity: 2 });

    assert.deepEqual([first.status, second.status], [200, 400]);
    assert.equal((await cartItem()).quantity, 4);
  });

  it("merges repeated adds of the same product", async () => {
    const user = await createUser();
    const productId = await createProduct({ stock: 5 });

    await add(user, { productId, quantity: 2 });
    await add(user, { productId, quantity: 3 });

    assert.equal((await cartItem()).quantity, 5);
    assert.equal(await countRows("cart_items"), 1);
  });

  it("refuses products that aren't for sale", async () => {
    const user = await createUser();
    const productId = await createProduct();
    await db.query("UPDATE products SET status = 'inactive' WHERE id = $1", [productId]);

    const res = await add(user, { productId, quantity: 1 });

    assert.equal(res.status, 400);
    assert.equal(await countRows("cart_items"), 0);
  });

  it("returns 404 when adding a product that doesn't exist", async () => {
    const user = await createUser();

    const res = await add(user, { productId: "00000000-0000-0000-0000-000000000000", quantity: 1 });

    assert.equal(res.status, 404);
  });

  it("returns the cart with totals", async () => {
    const user = await createUser();
    await addToCart(user.id, await createProduct({ price: 1000 }), 2);
    await addToCart(user.id, await createProduct({ price: 500 }), 1);

    const res = await request(app).get("/v1/cart").set("Authorization", `Bearer ${user.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 2);
    assert.equal(res.body.data.total_items, 3);
    assert.equal(res.body.data.total_amount, 2500);
  });

  it("returns an empty cart for a new user", async () => {
    const user = await createUser();

    const res = await request(app).get("/v1/cart").set("Authorization", `Bearer ${user.token}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.items, []);
  });

  it("removes one item and reports when the cart is empty", async () => {
    const user = await createUser();
    await addToCart(user.id, await createProduct(), 1);
    const item = await cartItem();

    const res = await request(app)
      .delete(`/v1/cart/${item.id}`)
      .set("Authorization", `Bearer ${user.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.cart_empty, true);
    assert.equal(await countRows("cart_items"), 0);
  });

  it("doesn't let a user touch someone else's cart item", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await addToCart(owner.id, await createProduct(), 1);
    const item = await cartItem();

    const change = await update(stranger, item.id, 2);
    const remove = await request(app)
      .delete(`/v1/cart/${item.id}`)
      .set("Authorization", `Bearer ${stranger.token}`);

    assert.deepEqual([change.status, remove.status], [404, 404]);
    assert.equal((await cartItem()).quantity, 1);
  });

  it("clears the cart, and says so if it was already empty", async () => {
    const user = await createUser();
    await addToCart(user.id, await createProduct(), 1);
    const clear = () =>
      request(app).delete("/v1/cart").set("Authorization", `Bearer ${user.token}`);

    const first = await clear();
    const second = await clear();

    assert.deepEqual([first.status, second.status], [200, 400]);
    assert.equal(await countRows("cart_items"), 0);
  });

  it("doesn't lose another user's save after a rejected request", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const productId = await createProduct();

    await add(alice, { productId, quantity: 0 });
    await request(app)
      .patch("/v1/user/updateprofile")
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ name: "Bob Changed" });

    // Rolling back from a clean connection would only reach committed data
    assert.equal(await openTransactions(), 0);
    const saved = await db.query("SELECT name FROM users WHERE id = $1", [bob.id]);
    assert.equal(saved.rows[0].name, "Bob Changed");
  });
});
