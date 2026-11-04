import db from "../../config/db.js";

export const adminGetUsers = async (req, res) => {
  try {
    const users = await db.query(
      "SELECT id, name, email, role, created_at, updated_at FROM users"
    );
    res.status(200).json({ users: users.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const adminGetUser = async (req, res) => {
  try {
    const userId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await db.query(
      "SELECT id, name, email, role, created_at, updated_at FROM users WHERE id = $1",
      [userId]
    );
    if (user.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
