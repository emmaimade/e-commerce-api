import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";
import * as authService from "./authService.js";

const PUBLIC_COLUMNS = "id, name, email, role, created_at, updated_at";
const PROFILE_COLUMNS = `${PUBLIC_COLUMNS}, email_verified`;
const normalizeEmail = (email) => email.trim().toLowerCase();

export const listUsers = async () => {
  const users = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users`);
  return users.rows;
};

export const getUser = async (userId) => {
  const user = await db.query(
    `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1`,
    [userId],
  );

  if (user.rows.length === 0) {
    throw new HttpError(404, "User not found");
  }

  return user.rows[0];
};

export const updateProfile = async (userId, updates) => {
  const currentUser = await db.query("SELECT email FROM users WHERE id = $1", [
    userId,
  ]);

  if (currentUser.rows.length === 0) {
    throw new HttpError(404, "User not found");
  }

  const profileChanges = { ...updates };
  const currentEmail = currentUser.rows[0].email;

  if (profileChanges.email !== undefined) {
    const newEmail = profileChanges.email.trim();
    const normalizedCurrentEmail = normalizeEmail(currentEmail);
    const normalizedNewEmail = normalizeEmail(newEmail);

    if (normalizedNewEmail === normalizedCurrentEmail) {
      delete profileChanges.email;
    } else {
      const emailCheck = await db.query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2",
        [normalizedNewEmail, userId],
      );

      if (emailCheck.rows.length > 0) {
        throw new HttpError(400, "Email already exists");
      }

      profileChanges.email = normalizedNewEmail;
      profileChanges.email_verified = false;
    }
  }

  const fields = Object.keys(profileChanges).filter(
    (field) => profileChanges[field] !== undefined,
  );

  if (fields.length === 0) {
    throw new HttpError(400, "No fields to update");
  }

  const setClause = fields
    .map((field, index) => `${field} = $${index + 1}`)
    .join(", ");
  const values = fields.map((field) => profileChanges[field]);

  const result = await db.query(
    `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = $${fields.length + 1} RETURNING ${PROFILE_COLUMNS}`,
    [...values, userId],
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "User not found");
  }

  if (
    profileChanges.email &&
    normalizeEmail(profileChanges.email) !== normalizeEmail(currentEmail)
  ) {
    await authService.resendVerification(profileChanges.email);
  }

  return result.rows[0];
};
