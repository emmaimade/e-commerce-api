import axios from "axios";
import crypto from "crypto";

const BASE_URL = "https://api.paystack.co";

const requestOptions = (timeout) => ({
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
  timeout,
});

export const initializeTransaction = async (payload) => {
  const response = await axios.post(`${BASE_URL}/transaction/initialize`, payload, requestOptions(10000));
  return response.data;
};

export const verifyTransaction = async (reference) => {
  const response = await axios.get(
    `${BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    requestOptions(10000)
  );
  return response.data;
};

export const createRefund = async (reference, amountInKobo) => {
  const response = await axios.post(
    `${BASE_URL}/refund`,
    { transaction: reference, amount: amountInKobo },
    requestOptions(30000)
  );
  return response.data;
};

// Paystack signs the raw body with the secret key. Compared in constant time
// so the response time can't reveal how much of a forged signature was right.
export const isValidWebhookSignature = (rawBody, signature) => {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== "string") return false;

  const expected = Buffer.from(
    crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex")
  );
  const received = Buffer.from(signature);

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};
