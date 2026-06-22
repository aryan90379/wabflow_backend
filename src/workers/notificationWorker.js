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
  SYSTEM: { title: "WabFlow update", channelId: "wabflow_updates" },
};

function buildPushMessage(notification, tokens) {
  const copy = notificationCopy[notification.type] || notificationCopy.SYSTEM;
  const title = notification.title || copy.title;
  const body = notification.body || "Open WabFlow for details.";
  const payload = notification.payload || {};

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
      notification: {
        title,
        body,
        channelId: copy.channelId,
        icon: "ic_stat_wabflow_nodes",
        color: "#22C55E",
        sound: "default",
        defaultSound: true,
        priority: "high",
        visibility: "public",
        tag: `${notification.type}-${payload.conversationId || payload.bookingId || notification._id}`,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          "thread-id": String(payload.conversationId || payload.bookingId || notification.businessId || "wabflow"),
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

      // 3. Extract unique push tokens
      const tokens = [...new Set(sessions.map((s) => s.pushToken))];

      // 4. Construct Firebase Payload
      const message = buildPushMessage(notification, tokens);

      // 5. Send via Firebase Admin
      console.log(`[Worker] Dispatching FCM message to ${tokens.length} unique tokens...`);
      const response = await messaging.sendEachForMulticast(message);
      
      console.log(`[Worker] ✅ Sent push notification! Success: ${response.successCount}, Failed: ${response.failureCount}`);
      console.log(`========================================\n`);

      // Optional: Cleanup invalid tokens based on responses
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
          console.error(`[Worker] Error sending to token ${tokens[idx]}: ${resp.error}`);
        }
      });

      if (failedTokens.length > 0) {
        // Remove invalid tokens from StaffSession
        await StaffSession.updateMany(
          { pushToken: { $in: failedTokens } },
          { $set: { pushToken: "" } }
        );
      }

      if (response.successCount > 0) {
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
