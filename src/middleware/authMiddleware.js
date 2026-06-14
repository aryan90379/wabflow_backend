import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "Access denied. Bearer token required." });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ success: false, error: "Access denied. Token missing." });
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret());
    const userId = payload.userId || payload._id || payload.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: "Invalid token payload." });
    }

    req.user = { ...payload, userId };
    req.userId = userId;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, error: "Token expired." });
    }
    return res.status(401).json({ success: false, error: "Invalid token." });
  }
}
