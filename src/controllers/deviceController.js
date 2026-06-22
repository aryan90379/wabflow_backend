import { StaffSession } from "../models/StaffSession.js";
import { Business } from "../models/Business.js";
import { BusinessMember } from "../models/BusinessMember.js";
import crypto from "crypto";

const PUSH_SESSION_DAYS = 365;

function fullPermissions() {
  return {
    inbox: { view: true, reply: true, manage: true },
    team: { view: true, create: true, edit: true, revoke: true, resetPassword: true },
    settings: { view: true, edit: true },
  };
}

function pushSessionExpiry() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + PUSH_SESSION_DAYS);
  return expiresAt;
}

async function registerOwnerPushToken(req, pushToken, platform) {
  const businesses = await Business.find({ ownerId: req.userId, active: true }).select("_id name");

  if (businesses.length === 0) {
    return 0;
  }

  const tokenHash = crypto.createHash("sha256").update(pushToken).digest("hex").slice(0, 24);
  const ownerName = req.user?.name || req.user?.email || "Owner";

  for (const business of businesses) {
    const member = await BusinessMember.findOneAndUpdate(
      { businessId: business._id, userId: req.userId, memberType: "owner" },
      {
        $setOnInsert: {
          businessId: business._id,
          userId: req.userId,
          memberType: "owner",
          role: "owner",
          name: ownerName,
          displayName: ownerName,
          permissions: fullPermissions(),
        },
      },
      { upsert: true, new: true }
    );

    await StaffSession.findOneAndUpdate(
      {
        sessionId: `owner_push_${business._id}_${req.userId}_${platform}_${tokenHash}`,
      },
      {
        $set: {
          businessId: business._id,
          memberId: member._id,
          tokenVersion: member.passwordVersion || 1,
          platform,
          pushToken,
          status: "active",
          lastSeenAt: new Date(),
          expiresAt: pushSessionExpiry(),
          ip: req.ip,
          userAgent: req.headers["user-agent"] || "",
        },
      },
      { upsert: true }
    );
  }

  return businesses.length;
}

/**
 * Register or update the push notification token for the current staff session.
 */
export const registerPushToken = async (req, res) => {
  try {
    const { pushToken, platform = "unknown" } = req.body;
    
    if (!pushToken) {
      return res.status(400).json({ success: false, message: "pushToken is required" });
    }

    if (req.authType === "staff" && req.sessionId) {
      const session = await StaffSession.findOne({ sessionId: req.sessionId, status: "active" });
      
      if (!session) {
        return res.status(404).json({ success: false, message: "Active session not found" });
      }

      session.pushToken = pushToken;
      session.platform = platform;
      session.lastSeenAt = new Date();
      session.expiresAt = pushSessionExpiry();
      await session.save();

      return res.status(200).json({ success: true, message: "Push token registered successfully." });
    } else if (req.authType === "owner" && req.userId) {
      const registeredBusinesses = await registerOwnerPushToken(req, pushToken, platform);

      if (registeredBusinesses === 0) {
        return res.status(404).json({ success: false, message: "No active businesses found for owner." });
      }

      return res.status(200).json({
        success: true,
        message: "Owner push token registered successfully.",
        registeredBusinesses,
      });
    } else {
      return res.status(400).json({ success: false, message: "Unsupported auth type for push notifications." });
    }
  } catch (error) {
    console.error("[DeviceController] Error registering push token:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
