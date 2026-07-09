import { Queue, Worker } from "bullmq";
import { Business, Contact, Message, WhatsappMessageTemplate } from "../models/index.js";
import { sendApprovedTemplateMessage } from "../services/templateMessageService.js";
import { createRedisConnection } from "./redisConnection.js";

const MISSED_CALL_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const SENT_OR_ACTIVE_STATUSES = ["queued", "sent", "delivered", "read"];

export const missedCallQueue = new Queue("missed-calls", {
  connection: createRedisConnection(),
});

function normalizePhone(phoneNumber = "") {
  return String(phoneNumber).replace(/[^\d]/g, "");
}

async function findRecentMessage({ businessId, phone }) {
  const contact = await Contact.findOne({
    businessId,
    $or: [{ phone }, { waId: phone }],
  }).select("_id");

  if (!contact) return null;

  return Message.findOne({
    businessId,
    contactId: contact._id,
    direction: "outbound",
    senderType: "bot",
    status: { $in: SENT_OR_ACTIVE_STATUSES },
    createdAt: { $gte: new Date(Date.now() - MISSED_CALL_COOLDOWN_MS) },
  }).sort({ createdAt: -1 });
}

export const missedCallWorker = new Worker(
  "missed-calls",
  async (job) => {
    const { businessId, phoneNumber } = job.data;
    const phone = normalizePhone(phoneNumber);

    const business = await Business.findById(businessId);
    if (!business?.missedCallConfig?.enabled || !business.missedCallConfig.templateId) {
      return { status: "skipped", reason: "Missed call tracking is disabled or no template is selected." };
    }

    const template = await WhatsappMessageTemplate.findOne({
      _id: business.missedCallConfig.templateId,
      businessId: business._id,
      status: "approved",
    });

    if (!template) {
      throw new Error("Configured missed-call template is not approved or not found.");
    }

    const recentMessage = await findRecentMessage({ businessId: business._id, phone });
    if (recentMessage) {
      return {
        status: "skipped",
        reason: "A recent missed-call message already exists for this number.",
        conversationId: String(recentMessage.conversationId),
        messageId: String(recentMessage._id),
        whatsappMessageId: recentMessage.whatsappMessageId || "",
      };
    }

    const result = await sendApprovedTemplateMessage({
      businessId: business._id,
      templateId: template._id,
      phone,
      customerName: "Missed Caller",
    });

    return {
      status: result.message?.status || "queued",
      conversationId: String(result.conversation?._id || result.conversation?.id || result.message?.conversationId || ""),
      messageId: String(result.message?._id || result.message?.id || ""),
      whatsappMessageId: result.message?.whatsappMessageId || "",
    };
  },
  {
    connection: createRedisConnection(),
    concurrency: Number(process.env.MISSED_CALL_WORKER_CONCURRENCY || 2),
  }
);

missedCallWorker.on("completed", (job) => {
  console.log(`[missed-call] Job ${job.id} completed.`);
});

missedCallWorker.on("failed", (job, error) => {
  console.error(`[missed-call] Job ${job?.id} failed:`, error.message);
});
