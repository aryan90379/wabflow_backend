import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import mongoose from "mongoose";
import { BroadcastJob, BroadcastRecipient } from "../models/index.js";
import { sendApprovedTemplateMessage } from "../services/templateMessageService.js";
import { broadcastToBusiness } from "../services/socketService.js";
import { broadcastRawToBusiness } from "../services/rawChatSocketService.js";

const redisOptions = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

const connection = new Redis(redisOptions);

export const broadcastQueue = new Queue("whatsapp-broadcasts", { connection });

function serializeJob(job) {
  if (!job) return null;
  const raw = typeof job.toObject === "function" ? job.toObject() : job;
  return {
    ...raw,
    id: String(raw._id || raw.id),
  };
}

function emitBroadcastProgress(job, recipient = null) {
  const payload = {
    job: serializeJob(job),
    recipient: recipient ? {
      ...recipient.toObject?.() || recipient,
      id: String(recipient._id || recipient.id),
    } : null,
  };
  broadcastToBusiness(String(job.businessId), "broadcast_progress", payload);
  broadcastRawToBusiness(String(job.businessId), "broadcast_progress", payload);
}

async function refreshJobCounts(jobId) {
  const broadcastObjectId = new mongoose.Types.ObjectId(jobId);
  const [job, counts] = await Promise.all([
    BroadcastJob.findById(jobId),
    BroadcastRecipient.aggregate([
      { $match: { broadcastJobId: broadcastObjectId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  if (!job) return null;

  const byStatus = Object.fromEntries(counts.map(item => [item._id, item.count]));
  job.queuedCount = byStatus.queued || 0;
  job.sentCount = byStatus.sent || 0;
  job.failedCount = byStatus.failed || 0;
  job.skippedCount = byStatus.skipped || 0;

  if (job.status !== "cancelled" && job.queuedCount === 0) {
    job.status = "completed";
    job.currentPhone = "";
    job.completedAt = new Date();
  }

  await job.save();
  return job;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const broadcastWorker = new Worker(
  "whatsapp-broadcasts",
  async (queueJob) => {
    const { broadcastJobId } = queueJob.data;
    let job = await BroadcastJob.findById(broadcastJobId);
    if (!job || job.status === "cancelled") return;

    job.status = "processing";
    job.startedAt = job.startedAt || new Date();
    await job.save();
    emitBroadcastProgress(job);

    while (true) {
      job = await BroadcastJob.findById(broadcastJobId);
      if (!job || job.status === "cancelled") return;

      const recipient = await BroadcastRecipient.findOneAndUpdate(
        { broadcastJobId, status: "queued" },
        { $set: { status: "sending", error: "" } },
        { sort: { index: 1 }, new: true }
      );

      if (!recipient) break;

      job.currentPhone = recipient.phone;
      await job.save();
      emitBroadcastProgress(job, recipient);

      try {
        const result = await sendApprovedTemplateMessage({
          businessId: job.businessId,
          templateId: job.templateId,
          phone: recipient.phone,
          customerName: recipient.customerName,
        });

        recipient.status = "sent";
        recipient.sentAt = new Date();
        recipient.conversationId = result.conversation?._id || result.conversation?.id;
        recipient.messageId = result.message?._id || result.message?.id;
        await recipient.save();
      } catch (error) {
        recipient.status = "failed";
        recipient.error = error?.meta?.message || error.message || "Could not send template.";
        await recipient.save();
      }

      const updatedJob = await refreshJobCounts(broadcastJobId);
      if (updatedJob) emitBroadcastProgress(updatedJob, recipient);

      await sleep(Number(process.env.BROADCAST_SEND_DELAY_MS || 900));
    }

    const completedJob = await refreshJobCounts(broadcastJobId);
    if (completedJob) emitBroadcastProgress(completedJob);
  },
  { connection, concurrency: Number(process.env.BROADCAST_WORKER_CONCURRENCY || 1) }
);

broadcastWorker.on("failed", async (queueJob, error) => {
  const broadcastJobId = queueJob?.data?.broadcastJobId;
  if (!broadcastJobId) return;
  const job = await BroadcastJob.findByIdAndUpdate(
    broadcastJobId,
    { $set: { status: "failed", error: error.message, completedAt: new Date() } },
    { new: true }
  );
  if (job) emitBroadcastProgress(job);
});
