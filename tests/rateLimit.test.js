import "./helpers/setup.js";
import { describe, it, before, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import { resetDatabase, closeDatabase } from "./helpers/db.js";
import { mockEmail, restoreMocks } from "./helpers/mocks.js";

const post = (path, body) => request(app).post(path).send(body);

// Limits are per client address and shared across the app, so each test uses its own route
describe("rate limiting", () => {
  before(resetDatabase);
  afterEach(restoreMocks);
  after(closeDatabase);

  it("blocks repeated failed logins with a JSON response", async () => {
    const attempt = () => post("/v1/auth/login", { email: "nobody@test.com", password: "wrong" });

    for (let i = 0; i < 10; i++) {
      assert.equal((await attempt()).status, 401);
    }
    const blocked = await attempt();

    assert.equal(blocked.status, 429);
    assert.match(blocked.headers["content-type"], /application\/json/);
    assert.equal(blocked.body.success, false);
  });

  it("limits password reset emails", async () => {
    mockEmail();
    const attempt = () => post("/v1/auth/forgot-password", { email: "nobody@test.com" });

    for (let i = 0; i < 5; i++) {
      assert.equal((await attempt()).status, 200);
    }

    assert.equal((await attempt()).status, 429);
  });

  it("limits account creation", async () => {
    const attempt = (i) =>
      post("/v1/auth/register", {
        name: "Test",
        email: `signup-${i}@test.com`,
        password: "secret123",
        confirmPassword: "secret123",
      });

    for (let i = 0; i < 10; i++) {
      assert.equal((await attempt(i)).status, 201);
    }

    assert.equal((await attempt(10)).status, 429);
  });
});
