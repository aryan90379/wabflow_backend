import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { Notification } from "../models/Notification.js";
import { StaffSession } from "../models/StaffSession.js";
import { messaging } from "../config/firebase.js";

// Ensure Redis connection details can be configured via environment variables
const redisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

const connection = new Redis(redisOptions);

export const notificationQueue = new Queue("push-notifications", { connection });

console.log("Notification Queue initialized.");

const notificationCopy = {
  NEW_CHAT: { title: "New chat needs attention", channelId: "wabflow_messages" },
  NEW_MESSAGE: { title: "New customer message", channelId: "wabflow_messages" },
  NEW_LEAD: { title: "New lead captured", channelId: "wabflow_updates" },
  NEW_BOOKING: { title: "New booking request", channelId: "wabflow_bookings" },
  HUMAN_HANDOFF: { title: "Human handoff requested", channelId: "wabflow_messages" },
  TASK_REMINDER: { title: "Task reminder", channelId: "wabflow_updates" },
  CAMPAIGN_UPDATE: { title: "Campaign update", channelId: "wabflow_updates" },
  SYSTEM: { title: "WabFlow update", channelId: "wabflow_updates" },
};

const notificationPreferenceByType = {
  NEW_CHAT: "messages",
  NEW_MESSAGE: "messages",
  NEW_LEAD: "leads",
  NEW_BOOKING: "bookings",
  HUMAN_HANDOFF: "handoffs",
  TASK_REMINDER: "tasks",
  CAMPAIGN_UPDATE: "campaigns",
  SYSTEM: "systemUpdates",
};

function preferencesForSession(session) {
  const stored = session.notificationPreferences || {};
  return {
    enabled: stored.enabled !== false,
    sound: stored.sound !== false,
    vibration: stored.vibration !== false,
    [notificationPreferenceByType.NEW_CHAT]: stored.messages !== false,
    leads: stored.leads !== false,
    bookings: stored.bookings !== false,
    handoffs: stored.handoffs !== false,
    tasks: stored.tasks !== false,
    campaigns: stored.campaigns !== false,
    systemUpdates: stored.systemUpdates !== false,
  };
}

function sessionAllowsNotification(session, type) {
  const preferences = preferencesForSession(session);
  const category = notificationPreferenceByType[type] || "systemUpdates";
  return preferences.enabled && preferences[category] !== false;
}

function getNotificationThread(notification, payload) {
  if (payload.conversationId) {
    const key = `chat-${payload.conversationId}`;
    return { tag: key, collapseKey: key, countQuery: { "payload.conversationId": payload.conversationId } };
  }

  if (payload.bookingId) {
    const key = `booking-${payload.bookingId}`;
    return { tag: key, collapseKey: key, countQuery: { "payload.bookingId": payload.bookingId } };
  }

  const key = `${notification.type || "SYSTEM"}-${notification.businessId || "wabflow"}`;
  return { tag: key, collapseKey: key, countQuery: { type: notification.type } };
}

async function getThreadNotificationCount(notification, thread) {
  return Notification.countDocuments({
    businessId: notification.businessId,
    recipientId: notification.recipientId,
    status: { $ne: "failed" },
    ...thread.countQuery,
  });
}

async function buildPushMessage(notification, tokens, deliveryPreferences = {}) {
  const copy = notificationCopy[notification.type] || notificationCopy.SYSTEM;
  const title = notification.title || copy.title;
  const body = notification.body || "Open WabFlow for details.";
  const payload = notification.payload || {};
  const thread = getNotificationThread(notification, payload);
  const notificationCount = await getThreadNotificationCount(notification, thread);

  return {
    notification: { title, body },
    data: {
      type: String(notification.type || "SYSTEM"),
      payload: JSON.stringify(payload),
      businessId: String(notification.businessId || ""),
      notificationId: String(notification._id || ""),
    },
    android: {
      priority: "high",
      collapseKey: thread.collapseKey,
      notification: {
        title,
        body,
        channelId: copy.channelId,
        icon: "ic_stat_wabflow_nodes",
        color: "#22C55E",
        ...(deliveryPreferences.sound === false ? {} : { sound: "default", defaultSound: true }),
        defaultVibrateTimings: deliveryPreferences.vibration !== false,
        priority: "high",
        visibility: "public",
        tag: thread.tag,
        notificationCount,
      },
    },
    apns: {
      payload: {
        aps: {
          ...(deliveryPreferences.sound === false ? {} : { sound: "default" }),
          "thread-id": thread.tag,
        },
      },
    },
    tokens,
  };
}

export const notificationWorker = new Worker(
  "push-notifications",
  async (job) => {
    const { notificationId } = job.data;
    console.log(`\n========================================`);
    console.log(`[Worker] Started processing Job ${job.id} (Type: ${job.name})`);

    try {
      // 1. Fetch Notification
      const notification = await Notification.findById(notificationId);
      if (!notification) {
        console.warn(`[Worker] Notification not found: ${notificationId}`);
        return;
      }

      // Mark as processing
      notification.status = "processing";
      await notification.save();

      // 2. Fetch User Sessions for push tokens
      const sessions = await StaffSession.find({
        memberId: notification.recipientId,
        pushToken: { $exists: true, $ne: "" },
        status: "active" // Assuming active sessions only
      });
      console.log(`[Worker] Found ${sessions.length} active sessions with push tokens for user ${notification.recipientId}`);

      if (sessions.length === 0) {
        console.warn(`[Worker] SKIP: No active push tokens for user ${notification.recipientId}`);
        notification.status = "failed";
        notification.error = "No active push tokens";
        await notification.save();
        return;
      }

      const eligibleSessions = sessions.filter(session => sessionAllowsNotification(session, notification.type));
      if (eligibleSessions.length === 0) {
        console.log(`[Worker] SUPPRESSED: '${notification.type}' is disabled on every registered device.`);
        notification.status = "sent";
        notification.error = "Suppressed by notification preferences";
        await notification.save();
        return;
      }

      // Group devices with matching delivery settings so sound/vibration remain device-specific.
      const groups = new Map();
      eligibleSessions.forEach(session => {
        const preferences = preferencesForSession(session);
        const key = `${preferences.sound}:${preferences.vibration}`;
        const current = groups.get(key) || { preferences, tokens: new Set() };
        current.tokens.add(session.pushToken);
        groups.set(key, current);
      });

      let successCount = 0;
      let failureCount = 0;
      const failedTokens = [];

      for (const { preferences, tokens: tokenSet } of groups.values()) {
        const tokens = [...tokenSet];
        const message = await buildPushMessage(notification, tokens, preferences);
        console.log(`[Worker] Dispatching FCM message to ${tokens.length} eligible device(s)...`);
        const response = await messaging.sendEachForMulticast(message);
        successCount += response.successCount;
        failureCount += response.failureCount;
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(tokens[idx]);
            console.error(`[Worker] Error sending to token ${tokens[idx]}: ${resp.error}`);
          }
        });
      }

      console.log(`[Worker] ✅ Push result! Success: ${successCount}, Failed: ${failureCount}`);
      console.log(`========================================\n`);

      // Optional: Cleanup invalid tokens based on responses
      if (failedTokens.length > 0) {
        // Remove invalid tokens from StaffSession
        await StaffSession.updateMany(
          { pushToken: { $in: failedTokens } },
          { $set: { pushToken: "" } }
        );
      }

      if (successCount > 0) {
        notification.status = "sent";
      } else {
        notification.status = "failed";
        notification.error = "All tokens failed";
      }
      
      await notification.save();
    } catch (error) {
      console.error(`[Worker] Error processing job ${job.id}:`, error);
      
      // Attempt to update notification status to failed
      await Notification.findByIdAndUpdate(notificationId, {
        status: "failed",
        error: error.message,
      });

      throw error; // Will trigger BullMQ retry mechanisms if configured
    }
  },
  { connection }
);

notificationWorker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully.`);
});

notificationWorker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job.id} failed:`, err);
});
