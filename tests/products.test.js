import "./helpers/setup.js";
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import {
  resetDatabase, clearTables, closeDatabase, createUser, createProduct,
  countRows, leakedConnections, openTransactions,
} from "./helpers/db.js";

describe("products", () => {
  before(resetDatabase);
  beforeEach(clearTables);
  after(closeDatabase);

  const get = (user, id) =>
    request(app).get(`/v1/product/${id}`).set("Authorization", `Bearer ${user.token}`);

  it("returns a product by id", async () => {
    const user = await createUser();
    const productId = await createProduct({ price: 2500 });

    const res = await get(user, productId);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.product.id, productId);
    assert.equal(res.body.data.product.price, 2500);
  });

  it("returns 400 for a malformed id and 404 for an unknown one", async () => {
    const user = await createUser();

    const malformed = await get(user, "not-a-uuid");
    const unknown = await get(user, "00000000-0000-0000-0000-000000000000");

    assert.equal(malformed.status, 400);
    assert.equal(unknown.status, 404);
  });

  it("returns its connection after adding products", async () => {
    const admin = await createUser({ role: "admin" });

    const res = await request(app)
      .post("/v1/admin/products")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Lamp", description: "A lamp", price: 1000, inventory_qty: 3 });

    assert.equal(res.status, 201);
    assert.equal(await countRows("products"), 1);
    assert.equal(leakedConnections(), 0);
  });

  it("leaves nothing open after rejecting a product", async () => {
    const admin = await createUser({ role: "admin" });
    const post = (body) =>
      request(app)
        .post("/v1/admin/products")
        .set("Authorization", `Bearer ${admin.token}`)
        .send(body);

    const missing = await post({ name: "Lamp" });
    const notNumeric = await post({ name: "Lamp", description: "A", price: "abc", inventory_qty: 1 });
    const negative = await post({ name: "Lamp", description: "A", price: -1, inventory_qty: 1 });

    assert.deepEqual([missing.status, notNumeric.status, negative.status], [400, 400, 400]);
    assert.equal(await openTransactions(), 0);
    assert.equal(leakedConnections(), 0);
  });
});
