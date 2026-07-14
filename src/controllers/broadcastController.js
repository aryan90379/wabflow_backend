import { BroadcastJob, BroadcastRecipient, WhatsappMessageTemplate } from "../models/index.js";
import { broadcastQueue } from "../workers/broadcastWorker.js";
import { normalizeBroadcastPhone } from "../utils/phone.js";
import { broadcastToBusiness } from "../services/socketService.js";
import { broadcastRawToBusiness } from "../services/rawChatSocketService.js";
import { estimateWhatsAppPricing } from "../utils/whatsappPricing.js";

const MAX_BROADCAST_RECIPIENTS = Number(process.env.MAX_BROADCAST_RECIPIENTS || 5000);

function serializeJob(job) {
  if (!job) return null;
  const raw = typeof job.toObject === "function" ? job.toObject() : job;
  return { ...raw, id: String(raw._id || raw.id) };
}

function serializeRecipient(recipient) {
  if (!recipient) return null;
  const raw = typeof recipient.toObject === "function" ? recipient.toObject() : recipient;
  return { ...raw, id: String(raw._id || raw.id) };
}

function emitBroadcastProgress(job) {
  const payload = { job: serializeJob(job), recipient: null };
  broadcastToBusiness(String(job.businessId), "broadcast_progress", payload);
  broadcastRawToBusiness(String(job.businessId), "broadcast_progress", payload);
}

function normalizeCountryCode(value) {
  if (value === null || value === "none") return "";
  return String(value || "91").replace(/[^\d]/g, "");
}

function normalizeRecipientInput(recipients = [], defaultCountryCode = "91") {
  const seen = new Set();
  const valid = [];
  const invalid = [];

  recipients.forEach((entry, index) => {
    const raw = typeof entry === "string" ? entry : entry?.phone;
    const customerName = typeof entry === "string" ? "" : String(entry?.customerName || entry?.name || "").trim();
    const phone = normalizeBroadcastPhone(raw, defaultCountryCode);

    if (!phone) {
      invalid.push({ index, phoneRaw: String(raw || ""), reason: "Invalid phone number" });
      return;
    }

    if (seen.has(phone)) return;
    seen.add(phone);
    valid.push({
      index: valid.length,
      phoneRaw: String(raw || ""),
      phone,
      customerName,
    });
  });

  return { valid, invalid };
}

export async function listBroadcasts(req, res) {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const jobs = await BroadcastJob.find({ businessId: req.business._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return res.json({ success: true, broadcasts: jobs.map(serializeJob), data: jobs.map(serializeJob) });
}

export async function getBroadcast(req, res) {
  const job = await BroadcastJob.findOne({
    _id: req.params.broadcastId,
    businessId: req.business._id,
  }).lean();

  if (!job) return res.status(404).json({ success: false, error: "Broadcast not found." });
  return res.json({ success: true, broadcast: serializeJob(job), data: serializeJob(job) });
}

export async function listBroadcastRecipients(req, res) {
  const job = await BroadcastJob.findOne({
    _id: req.params.broadcastId,
    businessId: req.business._id,
  }).select("_id");

  if (!job) return res.status(404).json({ success: false, error: "Broadcast not found." });

  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 80)));
  const page = Math.max(1, Number(req.query.page || 1));
  const filter = { broadcastJobId: job._id };
  if (req.query.status && req.query.status !== "all") {
    if (req.query.status === "pending") {
      filter.status = { $in: ["queued", "sending", "accepted"] };
    } else if (req.query.status === "sent") {
      filter.status = { $in: ["sent", "delivered", "read"] };
    } else {
      filter.status = req.query.status;
    }
  }

  const [items, total] = await Promise.all([
    BroadcastRecipient.find(filter)
      .sort({ index: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    BroadcastRecipient.countDocuments(filter),
  ]);

  return res.json({
    success: true,
    recipients: items.map(serializeRecipient),
    data: items.map(serializeRecipient),
    pagination: { page, limit, total },
  });
}

export async function createBroadcast(req, res) {
  const template = await WhatsappMessageTemplate.findOne({
    _id: req.body.templateId,
    businessId: req.business._id,
  });

  if (!template) return res.status(404).json({ success: false, error: "Template not found." });
  if (template.status !== "approved") {
    return res.status(400).json({
      success: false,
      error: "Only approved WhatsApp templates can be broadcast.",
      status: template.status,
    });
  }
  if (template.category === "AUTHENTICATION") {
    return res.status(400).json({
      success: false,
      error: "Authentication templates are reserved for OTP flows and cannot be used as campaigns.",
    });
  }

  const defaultCountryCode = normalizeCountryCode(req.body.defaultCountryCode);
  const inputRecipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
  const { valid, invalid } = normalizeRecipientInput(inputRecipients, defaultCountryCode);

  if (valid.length === 0) {
    return res.status(400).json({ success: false, error: "Add at least one valid recipient.", invalid });
  }

  if (valid.length > MAX_BROADCAST_RECIPIENTS) {
    return res.status(400).json({
      success: false,
      error: `Broadcast limit is ${MAX_BROADCAST_RECIPIENTS} recipients.`,
    });
  }

  const pricingSnapshot = estimateWhatsAppPricing(valid, template.category);

  const job = await BroadcastJob.create({
    businessId: req.business._id,
    templateId: template._id,
    whatsappAccountId: template.whatsappAccountId,
    createdByUserId: req.userId || undefined,
    createdByMemberId: req.memberId || undefined,
    name: String(req.body.name || template.displayName || "Broadcast").trim(),
    defaultCountryCode,
    totalCount: valid.length,
    queuedCount: valid.length,
    ...pricingSnapshot,
  });

  await BroadcastRecipient.insertMany(valid.map((recipient) => ({
    businessId: req.business._id,
    broadcastJobId: job._id,
    ...recipient,
  })));

  await broadcastQueue.add("send-broadcast", { broadcastJobId: job._id.toString() }, {
    jobId: job._id.toString(),
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: false,
  });

  emitBroadcastProgress(job);

  return res.status(201).json({
    success: true,
    broadcast: serializeJob(job),
    data: serializeJob(job),
    invalid,
  });
}

export async function cancelBroadcast(req, res) {
  const job = await BroadcastJob.findOne({
    _id: req.params.broadcastId,
    businessId: req.business._id,
  });

  if (!job) return res.status(404).json({ success: false, error: "Broadcast not found." });
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return res.json({ success: true, broadcast: serializeJob(job), data: serializeJob(job) });
  }

  job.status = "cancelled";
  job.currentPhone = "";
  job.completedAt = new Date();
  await job.save();

  const skipped = await BroadcastRecipient.updateMany(
    { broadcastJobId: job._id, status: "queued" },
    { $set: { status: "skipped", error: "Broadcast cancelled." } }
  );

  job.skippedCount += skipped.modifiedCount || 0;
  job.queuedCount = Math.max(0, job.queuedCount - (skipped.modifiedCount || 0));
  await job.save();
  emitBroadcastProgress(job);

  return res.json({ success: true, broadcast: serializeJob(job), data: serializeJob(job) });
}
