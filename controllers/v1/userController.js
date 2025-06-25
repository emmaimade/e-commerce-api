import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../../config/db.js";

export const getUser = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters long" });
    }

    const existingUser = await db.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res
        .status(400)
        .json({ message: "User already exists, try logging in" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await db.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *",
      [name, email, hashedPassword]
    );

    res
      .status(201)
      .json({ message: "User registered successfully", user: newUser.rows[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "User not found, try registering" });
    } else {
      const user = result.rows[0];
      const passwordMatch = await bcrypt.compare(password, user.password);

      if (passwordMatch) {
        const token = jwt.sign(
          { id: user.id, role: user.role, email: user.email },
          process.env.JWT_SECRET,
          { expiresIn: "1d" }
        );
        res.status(200).json({ message: "Login successful", token });
      } else {
        res.status(401).json({ message: "Invalid credentials" });
      }
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    // define allowed fields
    const allowedFields = ["name", "email", "password"];
    const allowedUpdates = {};

    // filter only allowed fields
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key) && value !== undefined && value !== "") {
        allowedUpdates[key] = value;
      }
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    // checks if email already exists
    const emailCheck = await db.query(
      "SELECT id FROM users WHERE email = $1 AND id != $2",
      [allowedUpdates.email, userId]
    );

    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // validate and hash password if provided
    if (allowedUpdates.password) {
      if (allowedUpdates.password < 6) {
        return res
          .status(400)
          .json({ message: "Password must be at least 6 characters long" });
      }

      allowedUpdates.password = await bcrypt.hash(allowedUpdates.password, 10);
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
      return res.status(404).json({ message: "User not found" });
    }

    res
      .status(200)
      .json({ message: "User updated successfully", user: result.rows[0] });
  } catch (err) {
    console.log("Update user error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ========================================
// ADMIN-ONLY USER CONTROLLERS
// ========================================

export const adminGetUsers = async (req, res) => {
  try {
    const users = await db.query("SELECT * FROM users");
    if (!users) {
      return res.status(404).json({ message: "No users found" });
    }
    res.status(200).json({ users: users.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const adminGetUser = async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
