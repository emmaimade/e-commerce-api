import "./helpers/setup.js";
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
import { resetDatabase, clearTables, closeDatabase, createUser, countRows } from "./helpers/db.js";

const nigerianAddress = {
  line1: "1 Marina Road",
  city: "Lagos",
  postal_code: "100001",
  country: "Nigeria",
  phone: "08031234567",
};

describe("shipping addresses", () => {
  let user;
  const as = (method, path, owner = user) =>
    request(app)[method](`/v1/shipping${path}`).set("Authorization", `Bearer ${owner.token}`);
  const add = (address = nigerianAddress) => as("post", "").send(address);

  before(resetDatabase);
  beforeEach(async () => {
    await clearTables();
    user = await createUser();
  });
  after(closeDatabase);

  it("saves an address with a normalized phone and country code", async () => {
    const res = await add();

    assert.equal(res.status, 201);
    assert.equal(res.body.shipping_address.country, "NG");
    assert.equal(res.body.shipping_address.phone, "+2348031234567");
  });

  it("rejects unknown countries, bad phones and short fields", async () => {
    const attempts = await Promise.all([
      add({ ...nigerianAddress, country: "Atlantis" }),
      add({ ...nigerianAddress, phone: "123" }),
      add({ ...nigerianAddress, line1: "x" }),
      add({ ...nigerianAddress, city: "x" }),
      add({ ...nigerianAddress, postal_code: "1" }),
      add({ city: "Lagos" }),
    ]);

    assert.deepEqual(attempts.map((r) => r.status), [400, 400, 400, 400, 400, 400]);
    assert.equal(await countRows("addresses"), 0);
  });

  it("rejects fields that aren't text", async () => {
    const res = await add({ ...nigerianAddress, line1: 12345 });

    assert.equal(res.status, 400);
  });

  it("lists and returns only the user's own addresses", async () => {
    const saved = (await add()).body.shipping_address;
    const stranger = await createUser();

    const list = await as("get", "");
    const single = await as("get", `/${saved.id}`);
    const foreign = await as("get", `/${saved.id}`, stranger);

    assert.equal(list.status, 200);
    assert.equal(single.status, 200);
    assert.equal(foreign.status, 404);
  });

  it("updates an address and warns when the phone may not suit the new country", async () => {
    const saved = (await add()).body.shipping_address;

    const city = await as("patch", `/${saved.id}`).send({ city: "Abuja", postal_code: "900001" });
    const country = await as("patch", `/${saved.id}`).send({ country: "Ghana" });

    assert.equal(city.status, 200);
    assert.equal(city.body.shipping_address.city, "Abuja");
    assert.equal(country.status, 200);
    assert.equal(country.body.shipping_address.country, "GH");
    assert.ok(country.body.warning);
  });

  it("rejects invalid updates and empty updates", async () => {
    const saved = (await add()).body.shipping_address;

    const attempts = await Promise.all([
      as("patch", `/${saved.id}`).send({ country: "Atlantis" }),
      as("patch", `/${saved.id}`).send({ phone: "123" }),
      as("patch", `/${saved.id}`).send({ city: "x" }),
      as("patch", `/${saved.id}`).send({}),
    ]);

    assert.deepEqual(attempts.map((r) => r.status), [400, 400, 400, 400]);
  });

  it("doesn't let a user change or delete someone else's address", async () => {
    const saved = (await add()).body.shipping_address;
    const stranger = await createUser();

    const update = await as("patch", `/${saved.id}`, stranger).send({ city: "Abuja" });
    const remove = await as("delete", `/${saved.id}`, stranger);

    assert.deepEqual([update.status, remove.status], [404, 404]);
    assert.equal(await countRows("addresses"), 1);
  });

  it("deletes an address", async () => {
    const saved = (await add()).body.shipping_address;

    const res = await as("delete", `/${saved.id}`);

    assert.equal(res.status, 200);
    assert.equal(await countRows("addresses"), 0);
  });
});
