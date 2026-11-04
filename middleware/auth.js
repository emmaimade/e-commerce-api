import jwt from "jsonwebtoken";
import db from "../config/db.js";

// Tokens only prove who someone is. Their role and whether the token is still
// valid come from the database, so changes apply immediately, not at expiry.
const auth = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access Denied" });
  }

  const token = header.split(" ")[1];
  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    return res.status(403).json({ error: "Invalid Token" });
  }

  try {
    const result = await db.query(
      "SELECT id, name, email, role, token_version FROM users WHERE id = $1",
      [payload.id]
    );
    const user = result.rows[0];

    // Tokens from before token_version existed have no tv claim
    if (!user || user.token_version !== (payload.tv ?? 0)) {
      return res.status(401).json({ error: "Token has been revoked" });
    }

    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
};

const adminAuth = (req, res, next) => {
  // verify user is authenticated, then check if user is an admin
  auth(req, res, (err) => {
    if (err) return next(err);

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access Denied, Admin privileges required",
      });
    }

    next();
  });
};

export { auth, adminAuth };
