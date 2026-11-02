import jwt from "jsonwebtoken";

const auth = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access Denied" });
  }

  const token = header.split(" ")[1];

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(403).json({ error: "Invalid Token" });
  }

  next();
};

const adminAuth = (req, res, next) => {
  // verify user is authenticated, then check if user is an admin
  auth(req, res, () => {
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
