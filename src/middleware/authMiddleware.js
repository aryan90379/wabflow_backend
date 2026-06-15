import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { StaffSession } from "../models/StaffSession.js";
import { BusinessMember } from "../models/BusinessMember.js";

export async function authMiddleware(req, res, next) {
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

    if (payload.authType === "staff") {
      // It's a staff token
      const session = await StaffSession.findOne({ sessionId: payload.sessionId, status: "active" });
      if (!session) {
        return res.status(401).json({ success: false, error: "ACCESS_REVOKED", message: "Session invalid or revoked." });
      }

      const member = await BusinessMember.findById(payload.memberId);
      if (!member || member.status !== "active") {
        return res.status(401).json({ success: false, error: "ACCESS_REVOKED", message: "Staff access revoked." });
      }

      if (session.tokenVersion !== member.passwordVersion) {
        return res.status(401).json({ success: false, error: "ACCESS_REVOKED", message: "Password was changed." });
      }

      req.authType = "staff";
      req.memberId = member._id;
      req.businessId = member.businessId;
      req.permissions = member.permissions;
      req.sessionId = session.sessionId;
      req.actor = { type: "staff", memberId: member._id, name: member.name };
      req.user = { ...payload }; // Keep payload for reference
      
      return next();
    } else {
      // Original owner logic
      const userId = payload.userId || payload._id || payload.id;

      if (!userId) {
        return res.status(401).json({ success: false, error: "Invalid token payload." });
      }

      req.authType = "owner";
      req.user = { ...payload, userId };
      req.userId = userId;
      req.actor = { type: "owner", userId };
      return next();
    }
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, error: "Token expired." });
    }
    return res.status(401).json({ success: false, error: "Invalid token." });
  }
}
