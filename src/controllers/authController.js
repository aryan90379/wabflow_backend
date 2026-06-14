import { OAuth2Client } from "google-auth-library";
import appleSignin from "apple-signin-auth";
import jwt from "jsonwebtoken";
import crypto from "crypto";

import { User } from "../models/User.js";
import { env } from "../config/env.js";

const googleClient = new OAuth2Client();

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
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    return res.json({
      success: true,
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