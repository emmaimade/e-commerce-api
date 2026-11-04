// Import this before anything that loads config/db.js, so the app connects to
// the test database. dotenv never overrides variables that are already set.
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const testDbUrl = process.env.TEST_DATABASE_URL;

// Tests wipe the database, so never run them against a hosted one
if (!testDbUrl || !/@(localhost|127\.0\.0\.1)[:/]/.test(testDbUrl)) {
  throw new Error("TEST_DATABASE_URL must point to a local database (tests wipe it)");
}

process.env.DATABASE_URL = testDbUrl;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.PAYSTACK_SECRET_KEY = "test-paystack-secret";
process.env.BASE_URL = "http://localhost:3000";
process.env.CORS_ORIGINS = "https://shop.test";

// Tests must never send real email, even ones that don't check it. mockEmail
// replaces this when a test wants to inspect what was sent.
nodemailer.createTransport = () => ({ sendMail: async () => ({}) });

// The app logs heavily; set DEBUG=1 to see it
if (!process.env.DEBUG) console.log = () => {};
