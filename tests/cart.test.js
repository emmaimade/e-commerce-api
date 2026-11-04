import "./helpers/setup.js";
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import {
  db, resetDatabase, clearTables, closeDatabase, createUser, createProduct, addToCart,
  openTransactions, leakedConnections,
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
