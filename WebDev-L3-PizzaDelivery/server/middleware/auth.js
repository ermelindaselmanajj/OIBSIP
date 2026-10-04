const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Admin = require("../models/Admin");

// Authenticate the signed identity before deciding whether its role is allowed.
const requireRole = (role) => async (req, res, next) => {
  const authorization = req.headers?.authorization;
  const match = typeof authorization === "string" && authorization.match(/^Bearer ([^\s]+)$/i);
  if (!match) return res.status(401).json({ message: "Authentication required" });

  let claims;
  try {
    claims = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ["HS256"] });
    if (!claims || typeof claims !== "object" ||
        !["user", "admin"].includes(claims.role) ||
        typeof claims.sub !== "string" || !/^[a-f\d]{24}$/i.test(claims.sub) ||
        !Number.isInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ message: "Invalid or expired session. Please log in again." });
    }
  } catch {
    return res.status(401).json({ message: "Invalid or expired session. Please log in again." });
  }

  try {
    const Model = claims.role === "user" ? User : Admin;
    const identity = await Model.findById(claims.sub);
    if (!identity || (claims.role === "user" && !identity.isVerified)) {
      return res.status(401).json({ message: "Invalid session. Please log in again." });
    }
    if (claims.role !== role) {
      return res.status(403).json({ message: "Access denied" });
    }
    req.identity = identity;
    req.authRole = claims.role;
    return next();
  } catch {
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = { requireRole };
