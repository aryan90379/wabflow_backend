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

function publicUser(user) {
  return user?.toObject ? user.toObject() : user;
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

function isFallbackAppleEmail(email = "") {
  return /^apple_[a-f0-9]{24}@apple-user\.wabflow\.local$/i.test(String(email || ""));
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
        googleEmail: email,
        name: payload.name || "",
        profilepic: payload.picture || "",
        lastLoginAt: new Date(),
      });
    } else {
      user.googleId = googleId;
      user.googleEmail = email;
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

// ─── Demo Login (Apple Reviewer Backdoor) ───────────────────────────────────
const DEMO_EMAIL    = "songrimleader@gmail.com";
const DEMO_PASSWORD = "AppleReview2026";

export async function demoLogin(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: "Email and password are required." });
  }

  if (
    String(email).toLowerCase().trim() !== DEMO_EMAIL ||
    password !== DEMO_PASSWORD
  ) {
    return res.status(401).json({ success: false, error: "Invalid demo credentials." });
  }

  const user = await User.findOne({
    $or: [
      { email: DEMO_EMAIL },
      { googleEmail: DEMO_EMAIL },
    ],
  });
  if (!user) {
    return res.status(404).json({ success: false, error: "Demo account not found. Please contact support." });
  }

  return res.json({
    success: true,
    token: createAppToken(user),
    user,
  });
}

export async function linkGoogleAuth(req, res) {
  try {
    if (req.authType === "staff") {
      return res.status(403).json({ success: false, error: "Staff accounts cannot link owner login providers." });
    }

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

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    const linkedUser = await User.findOne({ googleId });
    if (linkedUser && String(linkedUser._id) !== String(user._id)) {
      return res.status(409).json({
        success: false,
        error: "This Google account is already linked to another WabFlow user.",
      });
    }

    const emailUser = await User.findOne({ email });
    if (emailUser && String(emailUser._id) !== String(user._id)) {
      return res.status(409).json({
        success: false,
        error: "This Google email is already used by another WabFlow user.",
      });
    }

    user.googleId = googleId;
    user.googleEmail = email;
    if (!user.email || isFallbackAppleEmail(user.email)) user.email = email;
    user.name = user.name || payload.name || "";
    user.profilepic = user.profilepic || payload.picture || "";
    await user.save();

    return res.json({
      success: true,
      token: createAppToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("❌ Link Google auth error:", {
      message: error.message,
      name: error.name,
    });

    return res.status(500).json({
      success: false,
      error: "Google account linking failed.",
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

    const realAppleEmail = String(claims.email || email || "").trim().toLowerCase();
    let finalEmail = realAppleEmail;

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
        user.appleEmail = realAppleEmail || user.appleEmail || "";
        if (suppliedName && !user.name) user.name = suppliedName;
        user.lastLoginAt = new Date();
        await user.save();
      } else {
        user = await User.create({
          appleId,
          email: finalEmail,
          appleEmail: realAppleEmail,
          name: suppliedName || "Apple User",
          lastLoginAt: new Date(),
        });
      }
    } else {
      if (!user.email) user.email = finalEmail;
      user.appleEmail = realAppleEmail || user.appleEmail || "";
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

export async function linkAppleAuth(req, res) {
  try {
    if (req.authType === "staff") {
      return res.status(403).json({ success: false, error: "Staff accounts cannot link owner login providers." });
    }

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

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    const linkedUser = await User.findOne({ appleId });
    if (linkedUser && String(linkedUser._id) !== String(user._id)) {
      return res.status(409).json({
        success: false,
        error: "This Apple ID is already linked to another WabFlow user.",
      });
    }

    const finalEmail = String(claims.email || email || "").trim().toLowerCase();
    const suppliedName =
      cleanName(firstName, lastName) ||
      cleanName(fullName?.givenName, fullName?.familyName);

    user.appleId = appleId;
    user.appleEmail = finalEmail || user.appleEmail || "";
    user.email = user.email || finalEmail || makeFallbackAppleEmail(appleId);
    if (suppliedName && !user.name) user.name = suppliedName;
    await user.save();

    return res.json({
      success: true,
      token: createAppToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    console.error("❌ Link Apple auth error:", {
      message: error.message,
      name: error.name,
    });

    return res.status(401).json({
      success: false,
      error: "Apple account linking failed.",
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

export async function deleteAccount(req, res) {
  try {
    if (req.authType !== "owner") {
      return res.status(403).json({ success: false, error: "Only account owners can delete their account." });
    }

    const userId = req.userId;

    const { Contact } = await import("../models/Contact.js");
    const { Conversation } = await import("../models/Conversation.js");
    const { Message } = await import("../models/Message.js");
    const { Booking } = await import("../models/Booking.js");
    const { Lead } = await import("../models/Lead.js");
    const { FollowUpTask } = await import("../models/FollowUpTask.js");
    const { WhatsappAccount } = await import("../models/WhatsappAccount.js");
    const { WhatsappMessageTemplate } = await import("../models/WhatsappMessageTemplate.js");
    const { AutomationFlow } = await import("../models/AutomationFlow.js");
    const { AutomationRule } = await import("../models/AutomationRule.js");
    const { ServiceItem } = await import("../models/ServiceItem.js");
    const { BotKnowledge } = await import("../models/BotKnowledge.js");
    const { BotDecisionLog } = await import("../models/BotDecisionLog.js");
    const { HandoffRequest } = await import("../models/HandoffRequest.js");

    const businesses = await Business.find({ ownerId: userId }).lean();
    const businessIds = businesses.map(b => b._id);

    if (businessIds.length > 0) {
      await Contact.deleteMany({ businessId: { $in: businessIds } });
      await Conversation.deleteMany({ businessId: { $in: businessIds } });
      await Message.deleteMany({ businessId: { $in: businessIds } });
      await Booking.deleteMany({ businessId: { $in: businessIds } });
      await Lead.deleteMany({ businessId: { $in: businessIds } });
      await FollowUpTask.deleteMany({ businessId: { $in: businessIds } });
      await WhatsappAccount.deleteMany({ businessId: { $in: businessIds } });
      await WhatsappMessageTemplate.deleteMany({ businessId: { $in: businessIds } });
      await AutomationFlow.deleteMany({ businessId: { $in: businessIds } });
      await AutomationRule.deleteMany({ businessId: { $in: businessIds } });
      await ServiceItem.deleteMany({ businessId: { $in: businessIds } });
      await BotKnowledge.deleteMany({ businessId: { $in: businessIds } });
      await BotDecisionLog.deleteMany({ businessId: { $in: businessIds } });
      await HandoffRequest.deleteMany({ businessId: { $in: businessIds } });
      await BusinessMember.deleteMany({ businessId: { $in: businessIds } });
      await AuditLog.deleteMany({ businessId: { $in: businessIds } });
      await Business.deleteMany({ _id: { $in: businessIds } });
    }

    await User.deleteOne({ _id: userId });

    return res.json({ success: true, message: "Account completely deleted." });
  } catch (error) {
    console.error("❌ Delete account error:", error);
    return res.status(500).json({ success: false, error: "Server error during account deletion." });
  }
}
