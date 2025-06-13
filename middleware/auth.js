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
    res.status(500).json({ error: err.message });
  }
};

export default auth;