import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import { UNIQUE_VIOLATION } from "../utils/validators.js";
import { passwordResetEmail } from "../emails/authEmails.js";
import { sendEmail } from "./emailService.js";

const BCRYPT_ROUNDS = 10;
const RESET_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

// Compared against when an email is unknown, so a login takes the same time
// whether or not the account exists
const UNKNOWN_USER_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), BCRYPT_ROUNDS);

// Reset links are stored hashed, so reading the database doesn't give anyone a usable link
const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const register = async ({ name, email, password }) => {
  const existingUser = await db.query("SELECT id FROM users WHERE email = $1", [email]);

  if (existingUser.rows.length > 0) {
    throw new HttpError(400, "User already exists, try logging in");
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    const newUser = await db.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, role, created_at, updated_at",
      [name, email, hashedPassword]
    );

    return newUser.rows[0];
  } catch (err) {
    // Two signups with the same email at the same moment
    if (err.code === UNIQUE_VIOLATION) {
      throw new HttpError(400, "User already exists, try logging in");
    }

    throw err;
  }
};

export const login = async ({ email, password }) => {
  const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
  const user = result.rows[0];

  const passwordMatch = await bcrypt.compare(password, user?.password ?? UNKNOWN_USER_HASH);

  // The same answer for both cases, so this can't be used to find accounts
  if (!user || !passwordMatch) {
    throw new HttpError(401, "Invalid credentials");
  }

  return jwt.sign(
    { id: user.id, tv: user.token_version },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1d" }
  );
};

// Every token the user holds fails its next check in the auth middleware
export const logoutEverywhere = (userId) =>
  db.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [userId]);

// Answers the same whether or not the account exists, and doesn't wait for the
// email, because the time taken would otherwise reveal which case it was
export const requestPasswordReset = async (email) => {
  const resetToken = crypto.randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + RESET_TOKEN_LIFETIME_MS);

  const user = await db.query(
    "UPDATE users SET reset_password_token = $1, reset_token_expiry = $2 WHERE email = $3 RETURNING id",
    [hashResetToken(resetToken), expiry, email]
  );

  if (user.rows.length === 0) return;

  const resetUrl = `${process.env.BASE_URL}/v1/auth/reset-password/${resetToken}`;

  sendEmail({
    to: email,
    subject: "Password Reset Request",
    html: passwordResetEmail({ resetUrl }),
  });
};

// One statement, so a link can't be used twice. Also signs out every session.
export const resetPassword = async (token, password) => {
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const updated = await db.query(
    `UPDATE users
    SET
      password = $1,
      reset_password_token = NULL,
      reset_token_expiry = NULL,
      token_version = token_version + 1,
      updated_at = NOW()
    WHERE reset_password_token = $2 AND reset_token_expiry > NOW()
    RETURNING id`,
    [hashedPassword, hashResetToken(token)]
  );

  if (updated.rows.length === 0) {
    throw new HttpError(400, "Invalid or expired token");
  }
};
