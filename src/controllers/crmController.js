import {
  Lead,
  Booking,
  FollowUpTask,
  HandoffRequest,
  BotDecisionLog,
} from "../models/index.js";

function pagination(req) {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  return { page, limit, skip: (page - 1) * limit };
}

async function listModel(Model, req, defaultSort = { createdAt: -1 }) {
  const { page, limit, skip } = pagination(req);
  const filter = { businessId: req.business._id };
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    Model.find(filter).sort(defaultSort).skip(skip).limit(limit),
    Model.countDocuments(filter),
  ]);

  return { items, pagination: { page, limit, total } };
}

export async function listLeads(req, res) {
  const result = await listModel(Lead, req);
  return res.json({ success: true, leads: result.items, pagination: result.pagination });
}

export async function updateLead(req, res) {
  const allowed = ["intent", "score", "status", "requirement", "budget", "preferredDate", "preferredTime", "city", "metadata"];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.leadId, businessId: req.business._id },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!lead) return res.status(404).json({ success: false, error: "Lead not found." });
  return res.json({ success: true, lead });
}

export async function listBookings(req, res) {
  const result = await listModel(Booking, req);
  return res.json({ success: true, bookings: result.items, pagination: result.pagination });
}

export async function updateBooking(req, res) {
  const allowed = ["serviceItemId", "type", "status", "startDate", "endDate", "startTime", "guests", "customerName", "customerPhone", "notes", "metadata"];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.bookingId, businessId: req.business._id },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!booking) return res.status(404).json({ success: false, error: "Booking not found." });
  return res.json({ success: true, booking });
}

export async function listFollowUps(req, res) {
  const result = await listModel(FollowUpTask, req, { scheduledAt: 1 });
  return res.json({ success: true, followUps: result.items, pagination: result.pagination });
}

export async function createFollowUp(req, res) {
  const followUp = await FollowUpTask.create({
    contactId: req.body.contactId,
    conversationId: req.body.conversationId,
    leadId: req.body.leadId || null,
    type: req.body.type || "lead_followup",
    message: req.body.message,
    scheduledAt: req.body.scheduledAt,
    businessId: req.business._id,
  });
  return res.status(201).json({ success: true, followUp });
}

export async function updateFollowUp(req, res) {
  const allowed = ["message", "scheduledAt", "status"];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  const followUp = await FollowUpTask.findOneAndUpdate(
    { _id: req.params.followUpId, businessId: req.business._id },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!followUp) return res.status(404).json({ success: false, error: "Follow-up not found." });
  return res.json({ success: true, followUp });
}

export async function listHandoffs(req, res) {
  const result = await listModel(HandoffRequest, req);
  return res.json({ success: true, handoffs: result.items, pagination: result.pagination });
}

export async function updateHandoff(req, res) {
  const allowed = ["status", "assignedTo", "reason"];
  const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  if (update.status === "resolved") update.resolvedAt = new Date();

  const handoff = await HandoffRequest.findOneAndUpdate(
    { _id: req.params.handoffId, businessId: req.business._id },
    { $set: update },
    { new: true, runValidators: true }
  );
  if (!handoff) return res.status(404).json({ success: false, error: "Handoff not found." });
  return res.json({ success: true, handoff });
}

export async function listDecisionLogs(req, res) {
  const result = await listModel(BotDecisionLog, req);
  return res.json({ success: true, logs: result.items, pagination: result.pagination });
}
