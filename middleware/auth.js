import jwt from "jsonwebtoken";

const auth = async (req, res, next) => {
  try {
    let token = req.headers.authorization;

    if (!token) {
      return res.status(401).json({ error: "Access Denied" });
    }

    token = token.split(" ")[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: "Invalid Token" });
      }

      req.user = decoded;
      next();
    });
  } catch (err) {
    res.status(500).json({
      success: false, 
      message: "Authentication failed",
      error: err.message 
    });
  }
};

const adminAuth = async (req, res, next) => {
  try {
    // verify user is authenticated
    await auth(req, res, () => {});

    // check if user is an admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access Denied, Admin privileges required",
      });
    }

    // if user is authenticated and is admin, proceed to next middleware/route
    next();
  } catch (err) {
    // if user is not authenticated, return error
    res.status(401).json({
      success: false,
      message: "Authentication failed",
      error: err.message,
    });
  }
};

export { auth, adminAuth };
