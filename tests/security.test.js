import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import request from "supertest";
import app from "../app.js";
import { db, resetDatabase, clearTables, closeDatabase, createUser } from "./helpers/db.js";
import { mockEmail, restoreMocks } from "./helpers/mocks.js";

describe("security headers", () => {
  it("sets standard security headers and hides the framework", async () => {
    const res = await request(app).get("/health");

    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.ok(res.headers["content-security-policy"]);
    assert.equal(res.headers["x-powered-by"], undefined);
  });

  it("keeps the API docs compatible with the content security policy", async () => {
    const res = await request(app).get("/v1/docs/");

    assert.equal(res.status, 200);
    // script-src 'self' blocks inline scripts, so all of them must load from a file
    const inlineScripts = res.text.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? [];
    assert.deepEqual(inlineScripts, []);
  });

  it("allows only configured origins across sites", async () => {
    const allowed = await request(app).get("/health").set("Origin", "https://shop.test");
    const blocked = await request(app).get("/health").set("Origin", "https://evil.test");

    assert.equal(allowed.headers["access-control-allow-origin"], "https://shop.test");
    assert.equal(blocked.headers["access-control-allow-origin"], undefined);
  });
});

describe("password reset tokens", () => {
  before(resetDatabase);
  beforeEach(clearTables);
  afterEach(restoreMocks);
  after(closeDatabase);

  const requestToken = async (user) => {
    const sent = mockEmail();
    await request(app).post("/v1/auth/forgot-password").send({ email: user.email });
    return sent[0].html.match(/reset-password\/([0-9a-f]+)/)[1];
  };

  const storedToken = async (user) =>
    (await db.query("SELECT reset_password_token FROM users WHERE id = $1", [user.id])).rows[0]
      .reset_password_token;

  it("stores a hash, so a database leak doesn't expose usable links", async () => {
    const user = await createUser();

    const token = await requestToken(user);

    const stored = await storedToken(user);
    assert.notEqual(stored, token);
    assert.equal(stored, crypto.createHash("sha256").update(token).digest("hex"));
  });

  it("rejects the stored hash when used as a token", async () => {
    const user = await createUser();
    await requestToken(user);

    const res = await request(app)
      .post(`/v1/auth/reset-password/${await storedToken(user)}`)
      .send({ password: "new-password", confirmPassword: "new-password" });

    assert.equal(res.status, 400);
  });

  it("rejects an expired token", async () => {
    const user = await createUser();
    const token = await requestToken(user);
    await db.query("UPDATE users SET reset_token_expiry = now() - interval '1 hour' WHERE id = $1", [user.id]);

    const res = await request(app)
      .post(`/v1/auth/reset-password/${token}`)
      .send({ password: "new-password", confirmPassword: "new-password" });

    assert.equal(res.status, 400);
  });
});
