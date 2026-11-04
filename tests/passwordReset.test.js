import "./helpers/setup.js";
import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import { resetDatabase, clearTables, closeDatabase } from "./helpers/db.js";
import { mockEmail, restoreMocks } from "./helpers/mocks.js";

const email = "reset@test.com";
const oldPassword = "old-password";
const newPassword = "new-password";

const register = () =>
  request(app)
    .post("/v1/auth/register")
    .send({ name: "Reset User", email, password: oldPassword, confirmPassword: oldPassword });

// Request a reset and return the path of the link in the email
const requestResetLink = async (sent) => {
  await request(app).post("/v1/auth/forgot-password").send({ email });
  const link = sent[0].html.match(/href="([^"]+)"/)[1];
  return new URL(link).pathname;
};

describe("password reset", () => {
  let sent;

  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    sent = mockEmail();
    await register();
  });
  afterEach(restoreMocks);
  after(closeDatabase);

  it("emails a link that opens a reset form", async () => {
    const path = await requestResetLink(sent);

    const res = await request(app).get(path);

    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.text, /<form/);
    assert.match(res.text, /name="confirmPassword"/);
    // The token is in the URL, so don't leak it to other sites
    assert.equal(res.headers["referrer-policy"], "no-referrer");
  });

  it("resets the password when the form is submitted", async () => {
    const path = await requestResetLink(sent);

    const res = await request(app)
      .post(path)
      .type("form")
      .send({ password: newPassword, confirmPassword: newPassword });

    assert.equal(res.status, 200);
    const login = await request(app).post("/v1/auth/login").send({ email, password: newPassword });
    assert.equal(login.status, 200);
  });

  it("only lets a link be used once", async () => {
    const path = await requestResetLink(sent);
    const submit = () =>
      request(app).post(path).send({ password: newPassword, confirmPassword: newPassword });

    await submit();
    const second = await submit();

    assert.equal(second.status, 400);
  });
});
