import db from "../config/db.js";
import { HttpError } from "../utils/httpError.js";

const PUBLIC_COLUMNS = "id, name, email, role, created_at, updated_at";

export const listUsers = async () => {
  const users = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users`);
  return users.rows;
};

export const getUser = async (userId) => {
  const user = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [userId]);

  if (user.rows.length === 0) {
    throw new HttpError(404, "User not found");
  }

  return user.rows[0];
};

export const updateProfile = async (userId, updates) => {
  const fields = Object.keys(updates).filter((field) => updates[field] !== undefined);

  if (fields.length === 0) {
    throw new HttpError(400, "No fields to update");
  }

  if (updates.email) {
    const emailCheck = await db.query(
      "SELECT id FROM users WHERE email = $1 AND id != $2",
      [updates.email, userId]
    );

    if (emailCheck.rows.length > 0) {
      throw new HttpError(400, "Email already exists");
    }
  }

  const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(", ");
  const values = fields.map((field) => updates[field]);

  const result = await db.query(
    `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = $${fields.length + 1} RETURNING ${PUBLIC_COLUMNS}`,
    [...values, userId]
  );

  if (result.rows.length === 0) {
    throw new HttpError(404, "User not found");
  }

  return result.rows[0];
};
