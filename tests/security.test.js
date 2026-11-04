import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import request from "supertest";
import app from "../app.js";
import jwt from "jsonwebtoken";
import { sslConfig } from "../config/db.js";
import { db, resetDatabase, clearTables, closeDatabase, createUser } from "./helpers/db.js";
import { mockEmail, signedWebhook, restoreMocks } from "./helpers/mocks.js";

after(closeDatabase);

// Rate limits are per client, so each request here counts as a different one
let nextClient = 1;
const newClientIp = () => `10.0.0.${nextClient++}`;

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

describe("account privacy", () => {
  before(resetDatabase);
  beforeEach(clearTables);
  afterEach(restoreMocks);

  const register = () =>
    request(app).post("/v1/auth/register").send({
      name: "Known User",
      email: "known@test.com",
      password: "secret123",
      confirmPassword: "secret123",
    });

  it("answers the same for an unknown email and a wrong password", async () => {
    await register();

    const unknown = await request(app)
      .post("/v1/auth/login")
      .send({ email: "unknown@test.com", password: "secret123" });
    const wrong = await request(app)
      .post("/v1/auth/login")
      .send({ email: "known@test.com", password: "wrong-password" });

    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(unknown.body, wrong.body);
  });

  it("answers the same to a reset request whether or not the account exists", async () => {
    await register();
    const sent = mockEmail();

    const unknown = await request(app).post("/v1/auth/forgot-password").set("X-Forwarded-For", newClientIp()).send({ email: "unknown@test.com" });
    const known = await request(app).post("/v1/auth/forgot-password").set("X-Forwarded-For", newClientIp()).send({ email: "known@test.com" });

    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.deepEqual(unknown.body, known.body);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "known@test.com");
  });

  it("doesn't reveal a mail failure to the client", async () => {
    await register();
    mockEmail({
      onSend: async () => {
        throw new Error("smtp down");
      },
    });
    const originalError = console.error;
    console.error = () => {};

    try {
      const res = await request(app).post("/v1/auth/forgot-password").set("X-Forwarded-For", newClientIp()).send({ email: "known@test.com" });

      assert.equal(res.status, 200);
    } finally {
      console.error = originalError;
    }
  });
});

describe("token revocation", () => {
  before(resetDatabase);
  beforeEach(clearTables);
  afterEach(restoreMocks);

  const profile = (token) =>
    request(app).get("/v1/user/profile").set("Authorization", `Bearer ${token}`);

  const registerAndLogin = async () => {
    const credentials = { email: "person@test.com", password: "secret123" };
    await request(app)
      .post("/v1/auth/register")
      .send({ name: "Person", ...credentials, confirmPassword: credentials.password });
    await db.query("UPDATE users SET email_verified = true");
    const login = await request(app).post("/v1/auth/login").send(credentials);
    return login.body.token;
  };

  it("logs out every session", async () => {
    const token = await registerAndLogin();
    assert.equal((await profile(token)).status, 200);

    const logout = await request(app).post("/v1/auth/logout").set("Authorization", `Bearer ${token}`);

    assert.equal(logout.status, 200);
    assert.equal((await profile(token)).status, 401);
  });

  it("revokes existing tokens when the password is reset", async () => {
    const token = await registerAndLogin();
    const sent = mockEmail();
    await request(app).post("/v1/auth/forgot-password").set("X-Forwarded-For", newClientIp()).send({ email: "person@test.com" });
    const resetToken = sent[0].html.match(/reset-password\/([0-9a-f]+)/)[1];

    await request(app)
      .post(`/v1/auth/reset-password/${resetToken}`)
      .send({ password: "new-password", confirmPassword: "new-password" });

    assert.equal((await profile(token)).status, 401);
  });

  it("removes admin access as soon as the role changes", async () => {
    const admin = await createUser({ role: "admin" });
    const users = () =>
      request(app).get("/v1/admin/users").set("Authorization", `Bearer ${admin.token}`);
    assert.equal((await users()).status, 200);

    await db.query("UPDATE users SET role = 'customer' WHERE id = $1", [admin.id]);

    assert.equal((await users()).status, 403);
  });

  it("rejects tokens for deleted users", async () => {
    const user = await createUser();

    await db.query("DELETE FROM users WHERE id = $1", [user.id]);

    assert.equal((await profile(user.token)).status, 401);
  });

  it("rejects tokens signed with another secret or algorithm", async () => {
    const user = await createUser();
    const claims = { id: user.id, role: "admin", email: user.email };
    const wrongSecret = jwt.sign(claims, "not-the-secret");
    const hs512 = jwt.sign(claims, process.env.JWT_SECRET, { algorithm: "HS512" });
    const unsigned = jwt.sign(claims, "", { algorithm: "none" });

    for (const token of [wrongSecret, hs512, unsigned]) {
      assert.equal((await profile(token)).status, 403);
    }
  });
});

describe("webhook verification", () => {
  before(resetDatabase);

  const post = (body, signature) => {
    const req = request(app).post("/v1/payments/webhook").set("Content-Type", "application/json");
    if (signature !== undefined) req.set("x-paystack-signature", signature);
    return req.send(body);
  };

  it("rejects missing and wrong-length signatures without crashing", async () => {
    const { body } = signedWebhook({ event: "charge.success", data: {} });

    assert.equal((await post(body)).status, 400);
    assert.equal((await post(body, "short")).status, 400);
  });

  it("checks the signature before reading the body", async () => {
    const originalLog = console.log;
    const logged = [];
    console.log = (...args) => logged.push(args.join(" "));

    try {
      const unsigned = await post("{not json, customer@private.test", "forged");

      assert.equal(unsigned.status, 400);
      assert.equal(unsigned.body.message, "Invalid signature");
      assert.equal(logged.some((line) => line.includes("private.test")), false);
    } finally {
      console.log = originalLog;
    }
  });
});

describe("database TLS", () => {
  const hosted = "postgresql://user:pass@db.example.com:5432/app";

  it("skips TLS for a local database", () => {
    assert.equal(sslConfig("postgresql://user:pass@localhost:5432/app"), false);
  });

  it("verifies the server certificate when a CA is configured", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----";

    assert.deepEqual(sslConfig(hosted, pem), {
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
    });
  });

  it("restores line breaks from a one-line environment variable", () => {
    const { ca } = sslConfig(hosted, "line1\\nline2");

    assert.equal(ca, "line1\nline2");
  });

  it("still encrypts without a CA, but can't verify the server", () => {
    assert.deepEqual(sslConfig(hosted), { rejectUnauthorized: false });
  });
});

describe("password reset tokens", () => {
  before(resetDatabase);
  beforeEach(clearTables);
  afterEach(restoreMocks);

  const requestToken = async (user) => {
    const sent = mockEmail();
    await request(app).post("/v1/auth/forgot-password").set("X-Forwarded-For", newClientIp()).send({ email: user.email });
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

  it("stores the expiry with a time zone", async () => {
    const column = await db.query(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'reset_token_expiry'"
    );

    assert.equal(column.rows[0].data_type, "timestamp with time zone");
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
