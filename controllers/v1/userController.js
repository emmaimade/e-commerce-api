import bcrypt from "bcrypt";
import db from "../../config/db.js";

export const getUser = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "User retrieved successfully",
      user: user.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // define allowed fields
    const allowedFields = ["name", "email"];
    const allowedUpdates = {};

    // filter only allowed fields
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value.trim() && value !== undefined && value !== "") {
        allowedUpdates[key] = value.trim();
      }
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    if (allowedUpdates.name && allowedUpdates.name.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Name must be at least 3 characters long",
      });
    }

    // checks if email already exists
    const emailCheck = await db.query(
      "SELECT id FROM users WHERE email = $1 AND id != $2",
      [allowedUpdates.email, userId]
    );

    if (emailCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email already exists",
      });
    }

    // dynamic sql query
    const fields = Object.keys(allowedUpdates);
    const values = Object.values(allowedUpdates);
    const setClause = fields
      .map((field, index) => `${field} = $${index + 1}`)
      .join(", ");

    const query = `UPDATE users SET ${setClause}, updated_at = NOW() WHERE id = $${
      fields.length + 1
    } RETURNING *`;

    // update user
    const result = await db.query(query, [...values, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.log("Update user error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update user",
      error: err.message,
    });
  }
};