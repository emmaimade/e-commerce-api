import { mock } from "node:test";
import crypto from "crypto";
import axios from "axios";
import nodemailer from "nodemailer";

// Controllers share these module objects, so replacing their methods mocks every call

export const mockEmail = () =>
  mock.method(nodemailer, "createTransport", () => ({ sendMail: async () => ({}) }));

export const mockPaystackInit = ({ ok = true, networkError = false } = {}) =>
  mock.method(axios, "post", async () => {
    if (networkError) throw new Error("connect ETIMEDOUT");
    return ok
      ? { data: { status: true, data: { authorization_url: "https://checkout.paystack.test/abc" } } }
      : { data: { status: false, message: "Initialization failed" } };
  });

export const mockPaystackVerify = (transaction) =>
  mock.method(axios, "get", async () => ({ data: { status: true, data: transaction } }));

// Sign a webhook body the way Paystack does
export const signedWebhook = (payload) => {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(body)
    .digest("hex");
  return { body, signature };
};

export const restoreMocks = () => mock.restoreAll();
