import { StaffSession } from "../models/StaffSession.js";
import { Business } from "../models/Business.js";
import { BusinessMember } from "../models/BusinessMember.js";
import { fullPermissions } from "../utils/rolePermissions.js";
import crypto from "crypto";

const PUSH_SESSION_DAYS = 365;

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
import { WhatsappMessageTemplate, Message, Contact } from "../models/index.js";
import { missedCallQueue } from "../workers/missedCallWorker.js";

const MISSED_CALL_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const SENT_OR_ACTIVE_STATUSES = ["queued", "sent", "delivered", "read"];

function normalizePhone(phoneNumber = "") {
  return String(phoneNumber).replace(/[^\d]/g, "");
}

function serializeMissedCallMessage(message) {
  if (!message) return null;

  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    whatsappMessageId: message.whatsappMessageId || "",
    status: message.status,
    text: message.text || "",
    error: message.error || null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function extractMessageErrorText(errorValue) {
  if (!errorValue) return "";

  try {
    let errorObject = errorValue;
    if (typeof errorObject === "string") {
      try {
        errorObject = JSON.parse(errorObject);
      } catch {
        return errorObject;
      }
    }

    if (typeof errorObject === "string") return errorObject;

    if (Array.isArray(errorObject)) {
      const firstError = errorObject[0];
      if (!firstError) return "";
      return (
        firstError?.error_data?.details ||
        firstError?.message ||
        firstError?.title ||
        JSON.stringify(errorObject)
      );
    }

    return (
      errorObject?.error_data?.details ||
      errorObject?.message ||
      errorObject?.error?.message ||
      (typeof errorObject?.error === "string" ? errorObject.error : "") ||
      (Object.keys(errorObject || {}).length > 0 ? JSON.stringify(errorObject) : "")
    );
  } catch {
    return "";
  }
}

function normalizeTemplateFailureReason(reason = "") {
  const lower = String(reason).toLowerCase();
  if (
    lower.includes("healthy ecosystem") ||
    lower.includes("ecosystem engagement") ||
    lower.includes("failed to be delivered")
  ) {
    return "Template was sent through WhatsApp, but Meta rejected delivery for this recipient. The same template can still deliver to other numbers.";
  }
  return reason;
}

async function findRecentMissedCallMessage({ businessId, phone, since = null, preferSent = false }) {
  const contact = await Contact.findOne({
    businessId,
    $or: [{ phone }, { waId: phone }],
  }).select("_id phone waId");

  if (!contact) {
    return { contact: null, message: null };
  }

  const filter = {
    businessId,
    contactId: contact._id,
    direction: "outbound",
    senderType: "bot",
  };

  if (since) {
    filter.createdAt = { $gte: since };
  }

  const preferredFilter = preferSent
    ? { ...filter, status: { $in: SENT_OR_ACTIVE_STATUSES } }
    : filter;

  const message = await Message.findOne(preferredFilter).sort({ createdAt: -1 });
  return { contact, message };
}

export const handleMissedCall = async (req, res) => {
  try {
    const { phoneNumber, businessId } = req.body;
    if (!phoneNumber || !businessId) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ success: false, message: "Business not found" });
    }

    if (!business.missedCallConfig || !business.missedCallConfig.enabled || !business.missedCallConfig.templateId) {
      return res.status(200).json({ success: true, message: "Missed call tracking disabled or no template configured." });
    }

    const template = await WhatsappMessageTemplate.findOne({
      _id: business.missedCallConfig.templateId,
      businessId: business._id,
      status: "approved"
    });

    if (!template) {
      return res.status(400).json({ success: false, message: "Configured template is not approved or not found." });
    }

    const phone = normalizePhone(phoneNumber);
    
    // Simple rate limiting: don't send if we sent a template to this number in the last 12 hours.
    const { message: recentMessage } = await findRecentMissedCallMessage({
      businessId: business._id,
      phone,
      since: new Date(Date.now() - MISSED_CALL_COOLDOWN_MS),
      preferSent: true,
    });

    if (recentMessage) {
      return res.status(200).json({
        success: true,
        action: "skipped",
        status: recentMessage.status,
        reason: "A bot/template message was already sent to this caller in the last 12 hours.",
        message: "Skipped to avoid spamming the caller.",
        data: {
          message: serializeMissedCallMessage(recentMessage),
          conversationId: String(recentMessage.conversationId),
        },
      });
    }

    const job = await missedCallQueue.add(
      "send-missed-call-template",
      {
        businessId: String(business._id),
        phoneNumber: phone,
      },
      {
        attempts: Number(process.env.MISSED_CALL_SEND_ATTEMPTS || 3),
        backoff: {
          type: "exponential",
          delay: Number(process.env.MISSED_CALL_RETRY_DELAY_MS || 30000),
        },
        removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
      }
    );

    return res.status(200).json({
      success: true,
      action: "queued",
      status: "queued",
      reason: "Missed-call message queued for sending.",
      message: "Missed-call message queued.",
      data: {
        jobId: String(job.id),
      },
    });
  } catch (error) {
    console.error("[DeviceController] Error handling missed call:", error);
    res.status(error.status || 500).json({
      success: false,
      action: "failed",
      status: "failed",
      reason: error.message || "Internal server error",
      message: error.message || "Internal server error",
      error: error.meta || null,
    });
  }
};

export const getMissedCallStatus = async (req, res) => {
  try {
    const { phoneNumber, businessId, since, jobId } = req.query;
    if (!phoneNumber || !businessId) {
      return res.status(400).json({ success: false, message: "phoneNumber and businessId are required" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ success: false, message: "Business not found" });
    }

    const phone = normalizePhone(phoneNumber);
    const sinceDate = since ? new Date(Number(since)) : new Date(Date.now() - MISSED_CALL_COOLDOWN_MS);

    if (jobId) {
      const job = await missedCallQueue.getJob(String(jobId));
      if (job) {
        const state = await job.getState();
        const queuedStates = new Set(["waiting", "delayed", "prioritized", "active", "waiting-children"]);
        if (queuedStates.has(state)) {
          return res.status(200).json({
            success: true,
            action: "queued",
            status: "queued",
            reason: "Missed-call message is queued for sending.",
            data: { jobId: String(job.id) },
          });
        }

        if (state === "failed") {
          return res.status(200).json({
            success: true,
            action: "failed",
            status: "failed",
            reason: job.failedReason || "Missed-call message could not be sent.",
            data: { jobId: String(job.id) },
          });
        }

        if (state === "completed" && job.returnvalue?.status === "skipped") {
          return res.status(200).json({
            success: true,
            action: "skipped",
            status: "skipped",
            reason: job.returnvalue.reason || "Missed-call message was skipped.",
            data: {
              jobId: String(job.id),
              conversationId: job.returnvalue.conversationId,
              message: job.returnvalue.messageId ? {
                id: job.returnvalue.messageId,
                conversationId: job.returnvalue.conversationId,
                whatsappMessageId: job.returnvalue.whatsappMessageId || "",
                status: "sent",
              } : null,
            },
          });
        }
      }
    }

    const { contact, message: successfulMessage } = await findRecentMissedCallMessage({
      businessId: business._id,
      phone,
      since: Number.isNaN(sinceDate.getTime()) ? null : sinceDate,
      preferSent: true,
    });

    if (contact && successfulMessage) {
      return res.status(200).json({
        success: true,
        action: "skipped",
        status: successfulMessage.status,
        reason: "A bot/template message was already sent to this caller recently.",
        data: {
          contactFound: true,
          message: serializeMissedCallMessage(successfulMessage),
          conversationId: String(successfulMessage.conversationId),
          jobId: jobId ? String(jobId) : undefined,
        },
      });
    }

    const { contact: fallbackContact, message } = await findRecentMissedCallMessage({
      businessId: business._id,
      phone,
      since: Number.isNaN(sinceDate.getTime()) ? null : sinceDate,
    });

    if (!fallbackContact || !message) {
      return res.status(200).json({
        success: true,
        action: "not_found",
        status: "not_found",
        reason: jobId ? "No sent message was found after the queued job finished." : "No sent message was found for this missed call.",
        data: { contactFound: Boolean(fallbackContact), message: null, jobId: jobId ? String(jobId) : undefined },
      });
    }

    const failureReason = message.status === "failed"
      ? normalizeTemplateFailureReason(extractMessageErrorText(message.error) || "WhatsApp reported a send failure.")
      : "";

    return res.status(200).json({
      success: true,
      action: "found",
      status: message.status,
      reason: message.status === "failed"
        ? failureReason
        : "Found the latest outbound bot/template message for this caller.",
      data: {
        contactFound: true,
        message: serializeMissedCallMessage(message),
        conversationId: String(message.conversationId),
        jobId: jobId ? String(jobId) : undefined,
      },
    });
  } catch (error) {
    console.error("[DeviceController] Error checking missed call status:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
