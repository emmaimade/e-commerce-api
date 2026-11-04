import "./helpers/setup.js";
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import { resetDatabase, clearTables, closeDatabase, createUser } from "./helpers/db.js";

describe("auth and admin access", () => {
  before(resetDatabase);
  beforeEach(clearTables);
  after(closeDatabase);

  it("rejects admin routes without a token", async () => {
    const res = await request(app).get("/v1/admin/users");
    assert.equal(res.status, 401);
  });

  it("rejects admin routes with an invalid token", async () => {
    const res = await request(app)
      .get("/v1/admin/users")
      .set("Authorization", "Bearer not-a-jwt");
    assert.equal(res.status, 403);
  });

  it("rejects admin routes for customers", async () => {
    const customer = await createUser();
    const res = await request(app)
      .get("/v1/admin/users")
      .set("Authorization", `Bearer ${customer.token}`);
    assert.equal(res.status, 403);
  });

  it("allows admins", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await request(app)
      .get("/v1/admin/users")
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(res.status, 200);
  });

  it("never returns password hashes", async () => {
    const register = await request(app).post("/v1/auth/register").send({
      name: "New User",
      email: "new@test.com",
      password: "secret123",
      confirmPassword: "secret123",
    });
    assert.equal(register.status, 201);
    assert.equal(register.body.user.password, undefined);

    const login = await request(app)
      .post("/v1/auth/login")
      .send({ email: "new@test.com", password: "secret123" });
    const profile = await request(app)
      .get("/v1/user/profile")
      .set("Authorization", `Bearer ${login.body.token}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.password, undefined);
    assert.equal(profile.body.user.reset_password_token, undefined);
  });

  it("never returns password hashes or reset tokens from admin user endpoints", async () => {
    const admin = await createUser({ role: "admin" });
    const auth = ["Authorization", `Bearer ${admin.token}`];

    const list = await request(app).get("/v1/admin/users").set(...auth);
    const single = await request(app).get(`/v1/admin/users/${admin.id}`).set(...auth);

    assert.equal(list.status, 200);
    assert.equal(single.status, 200);
    for (const user of [list.body.users[0], single.body.user]) {
      assert.equal(user.email, admin.email);
      assert.equal("password" in user, false);
      assert.equal("reset_password_token" in user, false);
    }
  });

  it("returns 404 for an admin lookup of a user that doesn't exist", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await request(app)
      .get("/v1/admin/users/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(res.status, 404);
  });

  it("rejects the test webhook for non-admins", async () => {
    const customer = await createUser();
    const res = await request(app)
      .post("/v1/payments/test-webhook")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ reference: "anything" });
    assert.equal(res.status, 403);
  });
});
