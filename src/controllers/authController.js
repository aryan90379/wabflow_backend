import { OAuth2Client } from "google-auth-library";
import appleSignin from "apple-signin-auth";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import bcrypt from "bcryptjs";

import { User } from "../models/User.js";
import { BusinessMember } from "../models/BusinessMember.js";
import { Business } from "../models/Business.js";
import { StaffSession } from "../models/StaffSession.js";
import { AuditLog } from "../models/AuditLog.js";
import { env } from "../config/env.js";

const googleClient = new OAuth2Client();
const STAFF_SESSION_DAYS = 365;

function createAppToken(user) {
  return jwt.sign(
    {
      userId: String(user._id),
      email: user.email || null,
      authProvider: user.appleId ? "apple" : user.googleId ? "google" : "unknown",
    },
    env.jwtSecret(),
    { expiresIn: "30d" }
  );
}

function createStaffToken(member, sessionId) {
  return jwt.sign(
    {
      authType: "staff",
      memberId: member._id,
      sessionId,
    },
    env.jwtSecret(),
    { expiresIn: `${STAFF_SESSION_DAYS}d` }
  );
}

function makeFallbackAppleEmail(appleId) {
  const hash = crypto
    .createHash("sha256")
    .update(String(appleId))
    .digest("hex")
    .slice(0, 24);

  return `apple_${hash}@apple-user.wabflow.local`;
}

function cleanName(...parts) {
  return parts
    .filter(Boolean)
    .map((p) => String(p).trim())
    .filter(Boolean)
    .join(" ");
}

export async function googleAuth(req, res) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: "idToken is required.",
      });
    }

    if (!env.googleClientIds.length) {
      return res.status(500).json({
        success: false,
        error: "Google client ID is not configured.",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.googleClientIds,
    });

    const payload = ticket.getPayload();
    const googleId = payload?.sub;
    const email = String(payload?.email || "").toLowerCase();

    if (!payload?.email_verified || !email || !googleId) {
      return res.status(400).json({
        success: false,
        error: "Verified Google email is required.",
      });
    }

    let user = await User.findOne({
      $or: [{ googleId }, { email }],
    });

    if (!user) {
      user = await User.create({
        googleId,
        email,
        name: payload.name || "",
        profilepic: payload.picture || "",
        lastLoginAt: new Date(),
      });
    } else {
      user.googleId = googleId;
      user.email = user.email || email;
      user.name = payload.name || user.name;
      user.profilepic = payload.picture || user.profilepic;
      user.lastLoginAt = new Date();
      await user.save();
    }

    return res.json({
      success: true,
      token: createAppToken(user),
      user,
    });
  } catch (error) {
    console.error("❌ Google auth error:", {
      message: error.message,
      name: error.name,
    });

    return res.status(500).json({
      success: false,
      error: "Google authentication failed.",
    });
  }
}

export async function appleAuth(req, res) {
  try {
    const { identityToken, email, firstName, lastName, fullName } = req.body;

    if (!identityToken) {
      return res.status(400).json({
        success: false,
        error: "identityToken is required.",
      });
    }

    if (!env.appleClientId) {
      return res.status(500).json({
        success: false,
        error: "APPLE_CLIENT_ID is not configured.",
      });
    }

    const claims = await appleSignin.verifyIdToken(identityToken, {
      audience: env.appleClientId,
      ignoreExpiration: false,
    });

    const appleId = claims?.sub;

    if (!appleId) {
      return res.status(400).json({
        success: false,
        error: "Invalid Apple token.",
      });
    }

    let finalEmail = String(claims.email || email || "").trim().toLowerCase();

    if (!finalEmail) {
      finalEmail = makeFallbackAppleEmail(appleId);
    }

    const suppliedName =
      cleanName(firstName, lastName) ||
      cleanName(fullName?.givenName, fullName?.familyName);

    let user = await User.findOne({ appleId });

    if (!user) {
      user = await User.findOne({ email: finalEmail });

      if (user) {
        user.appleId = appleId;
        if (suppliedName && !user.name) user.name = suppliedName;
        user.lastLoginAt = new Date();
        await user.save();
      } else {
        user = await User.create({
          appleId,
          email: finalEmail,
          name: suppliedName || "Apple User",
          lastLoginAt: new Date(),
        });
      }
    } else {
      if (!user.email) user.email = finalEmail;
      if (suppliedName && !user.name) user.name = suppliedName;
      user.lastLoginAt = new Date();
      await user.save();
    }

    console.log("✅ Apple auth success", {
      userId: String(user._id),
      hasRealEmail: Boolean(claims.email || email),
      audience: claims.aud,
    });

    return res.json({
      success: true,
      token: createAppToken(user),
      user,
    });
  } catch (error) {
    console.error("❌ Apple auth error:", {
      message: error.message,
      name: error.name,
      expectedAudience: env.appleClientId || null,
      bodyKeys: Object.keys(req.body || {}),
      hasIdentityToken: Boolean(req.body?.identityToken),
    });

    return res.status(401).json({
      success: false,
      error: "Apple authentication failed.",
    });
  }
}

export async function checkEmail(req, res) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required.",
      });
    }

    const exists = Boolean(await User.exists({ email }));

    return res.json({
      success: true,
      exists,
    });
  } catch (error) {
    console.error("❌ Check email error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error.",
    });
  }
}

export async function getMe(req, res) {
  try {
    if (req.authType === "staff") {
      const member = await BusinessMember.findById(req.memberId).select("-passwordHash");
      const business = await Business.findById(req.businessId);
      if (!member) return res.status(404).json({ success: false, error: "Member not found." });

      const refreshedExpiresAt = new Date();
      refreshedExpiresAt.setDate(refreshedExpiresAt.getDate() + STAFF_SESSION_DAYS);
      await StaffSession.updateOne(
        { sessionId: req.sessionId, status: "active" },
        { $set: { lastSeenAt: new Date(), expiresAt: refreshedExpiresAt } }
      );
      
      return res.json({
        success: true,
        authType: "staff",
        token: createStaffToken(member, req.sessionId),
        member,
        business,
        permissions: member.permissions
      });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    return res.json({
      success: true,
      authType: "owner",
      user,
    });
  } catch (error) {
    console.error("❌ Get me error:", error);

    return res.status(500).json({
      success: false,
      error: "Server error.",
    });
  }
}

export async function updateMe(req, res) {
  try {
    if (req.authType === "staff") {
      // For now, staff cannot update language or it's not supported
      return res.status(403).json({ success: false, error: "Staff cannot update preferences yet." });
    }

    const { language, languageSet } = req.body;
    
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    if (language !== undefined) user.language = language;
    if (languageSet !== undefined) user.languageSet = languageSet;

    await user.save();

    return res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("❌ Update me error:", error);
    return res.status(500).json({ success: false, error: "Server error." });
  }
}

export async function staffLogin(req, res) {
  try {
    const { businessCode, staffCode, password, device = {} } = req.body;

    if (!businessCode || !staffCode || !password) {
      return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    const member = await BusinessMember.findOne({ businessCode, staffCode, status: "active" });
    if (!member || !member.passwordHash) {
      return res.status(401).json({ success: false, error: "Invalid credentials." });
    }

    const match = await bcrypt.compare(password, member.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, error: "Invalid credentials." });
    }

    const business = await Business.findById(member.businessId);
    if (!business || !business.active || !business.teamAccess?.staffLoginEnabled) {
      return res.status(403).json({ success: false, error: "Business login disabled." });
    }

    const sessionId = `sess_${crypto.randomBytes(16).toString("hex")}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + STAFF_SESSION_DAYS);

    await StaffSession.create({
      businessId: member.businessId,
      memberId: member._id,
      sessionId,
      tokenVersion: member.passwordVersion,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: device.platform,
      appVersion: device.appVersion,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      expiresAt,
    });

    const token = createStaffToken(member, sessionId);

    member.lastLoginAt = new Date();
    member.lastSeenAt = new Date();
    await member.save();

    await AuditLog.create({
      businessId: member.businessId,
      actorType: "staff",
      actorMemberId: member._id,
      actorName: member.name,
      action: "auth.staff_login",
      entityType: "BusinessMember",
      entityId: member._id,
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });

    return res.json({
      success: true,
      token,
      member: { ...member.toObject(), passwordHash: undefined },
      business,
      permissions: member.permissions
    });
  } catch (error) {
    console.error("❌ Staff login error:", error);
    return res.status(500).json({ success: false, error: "Server error." });
  }
}

export async function staffLogout(req, res) {
  try {
    if (req.authType !== "staff" || !req.sessionId) {
      return res.json({ success: true });
    }

    await StaffSession.findOneAndUpdate(
      { sessionId: req.sessionId },
      { status: "revoked", revokedAt: new Date(), revokedBy: req.memberId }
    );

    await AuditLog.create({
      businessId: req.businessId,
      actorType: "staff",
      actorMemberId: req.memberId,
      action: "auth.staff_logout",
      entityType: "StaffSession",
      entityId: null,
      ip: req.ip,
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("❌ Staff logout error:", error);
    return res.status(500).json({ success: false, error: "Server error." });
  }
}
