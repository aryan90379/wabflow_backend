import {
  Lead,
  Booking,
  Message,
  ServiceItem,
  FollowUpTask,
  HandoffRequest,
  BotDecisionLog,
} from "../models/index.js";
import { broadcastToBusiness } from "../services/socketService.js";

function pagination(req) {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  return { page, limit, skip: (page - 1) * limit };
}

async function listModel(Model, req, defaultSort = { createdAt: -1 }, populate = []) {
  const { page, limit, skip } = pagination(req);
  const filter = { businessId: req.business._id };
  if (req.query.status) filter.status = req.query.status;

  const query = Model.find(filter).sort(defaultSort).skip(skip).limit(limit);
  for (const item of populate) query.populate(item);

  const [items, total] = await Promise.all([
    query.lean(),
    Model.countDocuments(filter),
  ]);

  return { items, pagination: { page, limit, total } };
}

async function attachRecentMessages(items = []) {
  return Promise.all(items.map(async (item) => {
    const messages = item.conversationId?._id || item.conversationId
      ? await Message.find({ conversationId: item.conversationId?._id || item.conversationId })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("direction senderType type text interactive createdAt")
        .lean()
      : [];

    const contact = item.contactId && typeof item.contactId === "object" ? item.contactId : null;
    const conversation = item.conversationId && typeof item.conversationId === "object" ? item.conversationId : null;

    return {
      ...item,
      contact,
      conversation,
      recentMessages: messages.reverse(),
    };
  }));
}

function parseFlowReplyResponse(message = {}) {
  if (message.media?.responseJson) return message.media.responseJson;

  const rawResponse = message.rawPayload?.interactive?.nfm_reply?.response_json;
  if (!rawResponse) return null;

  try {
    return JSON.parse(rawResponse);
  } catch {
    return null;
  }
}

async function backfillBookingsFromFlowReplies(businessId) {
  const flowReplies = await Message.find({
    businessId,
    type: "flow_reply",
    direction: "inbound",
  })
    .select("+rawPayload")
    .sort({ createdAt: -1 })
    .limit(50);

  for (const message of flowReplies) {
    const responseJson = parseFlowReplyResponse(message);
    if (responseJson?.flowConfigId !== "booking") continue;

    const existing = await Booking.findOne({
      businessId,
      conversationId: message.conversationId,
      contactId: message.contactId,
      startDate: responseJson.startDate || "",
      startTime: responseJson.startTime || "",
    });
    if (existing) continue;

    const rawServiceItemId = responseJson.serviceItemId;
    const serviceItemId = /^[a-f\d]{24}$/i.test(String(rawServiceItemId || "")) ? rawServiceItemId : null;
    let selectedItemName = "";
    let selectedItemType = "";

    if (serviceItemId) {
      const item = await ServiceItem.findOne({ _id: serviceItemId, businessId });
      if (item) {
        selectedItemName = item.name;
        selectedItemType = item.type;
      }
    }

    await Booking.create({
      businessId,
      contactId: message.contactId,
      conversationId: message.conversationId,
      serviceItemId: serviceItemId || null,
      type: selectedItemType === "room" ? "room_booking" : "appointment",
      status: "requested",
      customerName: responseJson.customerName || "",
      customerPhone: responseJson.customerPhone || "",
      startDate: responseJson.startDate || "",
      startTime: responseJson.startTime || "",
      notes: responseJson.notes || "",
      metadata: new Map([
        ...(selectedItemName ? [[selectedItemType === "room" ? "roomType" : "appointmentReason", selectedItemName]] : []),
        ...(!serviceItemId && rawServiceItemId ? [["appointmentReason", String(responseJson.appointmentReason || rawServiceItemId)]] : []),
      ]),
    });
  }
}

export async function listLeads(req, res) {
  const result = await listModel(Lead, req, { createdAt: -1 }, [
    { path: "contactId", select: "name phone waId tags leadStage notes customFields" },
    { path: "conversationId", select: "status lastMessage lastMessageAt unreadCount botState" },
  ]);
  const items = await attachRecentMessages(result.items);
  return res.json({
    success: true,
    leads: items,
    data: items,
    pagination: result.pagination,
    ...result.pagination,
  });
}

export async function getLead(req, res) {
  const lead = await Lead.findOne({ _id: req.params.leadId, businessId: req.business._id })
    .populate("contactId", "name phone waId tags leadStage notes customFields")
    .populate("conversationId", "status lastMessage lastMessageAt unreadCount botState")
    .lean();
  if (!lead) return res.status(404).json({ success: false, error: "Lead not found." });
  const [item] = await attachRecentMessages([lead]);
  return res.json({ success: true, lead: item, data: item });
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
  return res.json({ success: true, lead, data: lead });
}

export async function listBookings(req, res) {
  await backfillBookingsFromFlowReplies(req.business._id);
  const result = await listModel(Booking, req, { createdAt: -1 }, [
    { path: "contactId", select: "name phone waId tags leadStage notes customFields" },
    { path: "conversationId", select: "status lastMessage lastMessageAt unreadCount botState" },
    { path: "serviceItemId", select: "name description price durationMinutes" },
  ]);
  const items = await attachRecentMessages(result.items);
  return res.json({
    success: true,
    bookings: items,
    data: items,
    pagination: result.pagination,
    ...result.pagination,
  });
}

export async function getBooking(req, res) {
  const booking = await Booking.findOne({ _id: req.params.bookingId, businessId: req.business._id })
    .populate("contactId", "name phone waId tags leadStage notes customFields")
    .populate("conversationId", "status lastMessage lastMessageAt unreadCount botState")
    .populate("serviceItemId", "name description price durationMinutes")
    .lean();
  if (!booking) return res.status(404).json({ success: false, error: "Booking not found." });
  const [item] = await attachRecentMessages([booking]);
  return res.json({ success: true, booking: item, data: item });
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
  broadcastToBusiness(req.business._id.toString(), "booking_updated", booking);
  return res.json({ success: true, booking, data: booking });
}

export async function createBooking(req, res) {
  const allowed = ["serviceItemId", "contactId", "conversationId", "type", "status", "startDate", "endDate", "startTime", "guests", "customerName", "customerPhone", "notes", "metadata"];
  const data = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
  
  const booking = await Booking.create({
    ...data,
    businessId: req.business._id,
  });
  
  broadcastToBusiness(req.business._id.toString(), "booking_created", booking);
  return res.status(201).json({ success: true, booking, data: booking });
}


export async function listFollowUps(req, res) {
  const result = await listModel(FollowUpTask, req, { scheduledAt: 1 });
  return res.json({ success: true, followUps: result.items, data: result.items, pagination: result.pagination, ...result.pagination });
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
  return res.status(201).json({ success: true, followUp, data: followUp });
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
  return res.json({ success: true, followUp, data: followUp });
}

export async function listHandoffs(req, res) {
  const result = await listModel(HandoffRequest, req);
  return res.json({ success: true, handoffs: result.items, data: result.items, pagination: result.pagination, ...result.pagination });
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
  return res.json({ success: true, handoff, data: handoff });
}

export async function listDecisionLogs(req, res) {
  const result = await listModel(BotDecisionLog, req);
  return res.json({ success: true, logs: result.items, data: result.items, pagination: result.pagination, ...result.pagination });
}
