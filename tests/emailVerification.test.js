import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { setTimeout as sleep } from "node:timers/promises";
import request from "supertest";
import app from "../app.js";
import { db, resetDatabase, clearTables, closeDatabase, countRows } from "./helpers/db.js";
import { mockEmail, restoreMocks } from "./helpers/mocks.js";

const email = "person@test.com";
const password = "secret123";

// Rate limits are per client, so each request here counts as a different one
let nextClient = 1;
const post = (path, body) =>
  request(app).post(path).set("X-Forwarded-For", `10.1.0.${nextClient++}`).send(body);

const register = (overrides = {}) =>
  post("/v1/auth/register", { name: "Person", email, password, confirmPassword: password, ...overrides });

const login = (credentials = { email, password }) => post("/v1/auth/login", credentials);

// Emails are sent in the background
const nextEmail = async (sent) => {
  for (let i = 0; i < 50 && sent.length === 0; i++) await sleep(10);
  return sent.shift();
};

const linkPath = (message) => new URL(message.html.match(/href="([^"]+)"/)[1]).pathname;

describe("email verification", () => {
  let sent;

  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    sent = mockEmail();
  });
  afterEach(restoreMocks);
  after(closeDatabase);

  it("answers the same whether or not the email is already registered", async () => {
    const first = await register();
    const second = await register();

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.deepEqual(first.body, second.body);
    assert.equal(first.body.user, undefined);
    assert.equal(await countRows("users"), 1);
  });

  it("emails a verification link to a new user", async () => {
    await register();

    const message = await nextEmail(sent);

    assert.equal(message.to, email);
    assert.equal(message.subject, "Verify Your Email");
    assert.match(linkPath(message), /^\/v1\/auth\/verify-email\//);
    assert.doesNotMatch(message.html, /undefined/);
  });

  it("never puts signup form text in an email to an unproven address", async () => {
    await register({ name: "<a href='https://evil.test'>Claim your prize</a>" });

    const message = await nextEmail(sent);

    assert.doesNotMatch(message.html, /evil\.test|Claim your prize/);
  });

  it("tells the real owner when someone signs up with their email", async () => {
    await register();
    await nextEmail(sent);

    await register({ name: "Somebody Else", password: "different1", confirmPassword: "different1" });

    const message = await nextEmail(sent);
    assert.equal(message.to, email);
    assert.equal(message.subject, "Someone Tried to Register With Your Email");
    assert.doesNotMatch(message.html, /undefined/);
  });

  it("doesn't change the account when the email is already registered", async () => {
    await register();
    const before = (await db.query("SELECT password, name FROM users")).rows[0];

    await register({ name: "Somebody Else", password: "different1", confirmPassword: "different1" });

    assert.deepEqual((await db.query("SELECT password, name FROM users")).rows[0], before);
  });

  it("blocks login until the email is verified, but only with the right password", async () => {
    await register();

    const right = await login();
    const wrong = await login({ email, password: "wrong-password" });

    assert.equal(right.status, 403);
    assert.equal(wrong.status, 401);
  });

  it("lets the user log in after following the link", async () => {
    await register();
    const message = await nextEmail(sent);

    const page = await request(app).get(linkPath(message));
    const res = await login();

    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\/html/);
    assert.match(page.text, /verified/i);
    assert.equal(page.headers["referrer-policy"], "no-referrer");
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  it("rejects an invalid, reused or expired link", async () => {
    await register();
    const path = linkPath(await nextEmail(sent));

    const invalid = await request(app).get("/v1/auth/verify-email/not-a-real-token");
    await db.query("UPDATE users SET verification_token_expiry = now() - interval '1 hour'");
    const expired = await request(app).get(path);
    await db.query("UPDATE users SET verification_token_expiry = now() + interval '1 hour'");
    const valid = await request(app).get(path);
    const reused = await request(app).get(path);

    assert.deepEqual([invalid.status, expired.status, valid.status, reused.status], [400, 400, 200, 400]);
  });

  it("stores the token hashed", async () => {
    await register();
    const token = linkPath(await nextEmail(sent)).split("/").pop();

    const stored = (await db.query("SELECT verification_token FROM users")).rows[0].verification_token;

    assert.notEqual(stored, token);
    assert.equal(stored, crypto.createHash("sha256").update(token).digest("hex"));
  });

  it("resends a link, answering the same for every email", async () => {
    await register();
    await nextEmail(sent);

    const known = await post("/v1/auth/resend-verification", { email });
    const message = await nextEmail(sent);
    const unknown = await post("/v1/auth/resend-verification", { email: "nobody@test.com" });

    assert.equal(known.status, 200);
    assert.deepEqual(known.body, unknown.body);
    assert.equal(message.subject, "Verify Your Email");
    assert.equal((await request(app).get(linkPath(message))).status, 200);
  });

  it("doesn't resend to a verified account", async () => {
    await register();
    await request(app).get(linkPath(await nextEmail(sent)));

    await post("/v1/auth/resend-verification", { email });
    await sleep(50);

    assert.equal(sent.length, 0);
  });

  it("treats a password reset as proof of the email", async () => {
    await register();
    await nextEmail(sent);
    await post("/v1/auth/forgot-password", { email });
    const token = linkPath(await nextEmail(sent)).split("/").pop();

    await post(`/v1/auth/reset-password/${token}`, { password: "new-password", confirmPassword: "new-password" });

    assert.equal((await login({ email, password: "new-password" })).status, 200);
  });
});
