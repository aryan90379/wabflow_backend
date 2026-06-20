import mongoose from "mongoose";
import { BroadcastJob, BroadcastRecipient } from "../models/index.js";
import { broadcastToBusiness } from "./socketService.js";
import { broadcastRawToBusiness } from "./rawChatSocketService.js";

function serializeJob(job) {
  if (!job) return null;
  const raw = typeof job.toObject === "function" ? job.toObject() : job;
  return {
    ...raw,
    id: String(raw._id || raw.id),
  };
}

function serializeRecipient(recipient) {
  if (!recipient) return null;
  const raw = typeof recipient.toObject === "function" ? recipient.toObject() : recipient;
  return {
    ...raw,
    id: String(raw._id || raw.id),
  };
}

export function emitBroadcastProgress(job, recipient = null) {
  if (!job?.businessId) return;

  const payload = {
    job: serializeJob(job),
    recipient: serializeRecipient(recipient),
  };

  broadcastToBusiness(String(job.businessId), "broadcast_progress", payload);
  broadcastRawToBusiness(String(job.businessId), "broadcast_progress", payload);
}

export async function refreshBroadcastJobCounts(jobId) {
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
  const pendingCount = (byStatus.queued || 0) + (byStatus.sending || 0) + (byStatus.accepted || 0);
  const sentCount = (byStatus.sent || 0) + (byStatus.delivered || 0) + (byStatus.read || 0);

  job.queuedCount = pendingCount;
  job.sentCount = sentCount;
  job.failedCount = byStatus.failed || 0;
  job.skippedCount = byStatus.skipped || 0;

  if (job.status !== "cancelled" && pendingCount === 0) {
    job.status = "completed";
    job.currentPhone = "";
    job.completedAt = job.completedAt || new Date();
  }

  await job.save();
  return job;
}
