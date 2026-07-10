import { Booking, Contact, Conversation, Lead, Message } from "../models/index.js";

function mapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (typeof value.toObject === "function") return value.toObject();
  return { ...value };
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "")
  );
}

function leadStatusFromBookingStatus(status = "") {
  if (status === "confirmed") return "booked";
  if (status === "completed") return "won";
  if (status === "cancelled") return "lost";
  return "interested";
}

function bookingRequirement(booking = {}) {
  const metadata = mapToObject(booking.metadata);
  return (
    metadata.appointmentReason ||
    metadata.roomType ||
    booking.notes ||
    (booking.type ? String(booking.type).replace(/_/g, " ") : "Appointment")
  );
}

export async function upsertLeadForConversation({
  businessId,
  contactId,
  conversationId,
  source = "whatsapp",
  intent = "enquiry",
  score,
  status,
  requirement,
  preferredDate,
  preferredTime,
  city,
  budget,
  metadata = {},
}) {
  if (!businessId || !contactId || !conversationId) return null;

  const set = compactObject({
    status,
    requirement,
    preferredDate,
    preferredTime,
    city,
    budget,
  });

  for (const [key, value] of Object.entries(compactObject(metadata))) {
    set[`metadata.${key}`] = value;
  }

  const setOnInsert = compactObject({
    businessId,
    contactId,
    conversationId,
    source,
    intent,
    score,
  });

  const lead = await Lead.findOneAndUpdate(
    { businessId, contactId, conversationId },
    {
      $setOnInsert: setOnInsert,
      ...(Object.keys(set).length ? { $set: set } : {}),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (status) {
    await Contact.updateOne({ _id: contactId, businessId }, { $set: { leadStage: status } });
  }

  return lead;
}

export async function ensureLeadForBooking(booking) {
  if (!booking?.businessId || !booking?.contactId || !booking?.conversationId) return null;

  const businessId = booking.businessId?._id || booking.businessId;
  const contactId = booking.contactId?._id || booking.contactId;
  const conversationId = booking.conversationId?._id || booking.conversationId;

  return upsertLeadForConversation({
    businessId,
    contactId,
    conversationId,
    source: "appointment",
    intent: "booking_request",
    score: 70,
    status: leadStatusFromBookingStatus(booking.status),
    requirement: bookingRequirement(booking),
    preferredDate: booking.startDate,
    preferredTime: booking.startTime,
    metadata: {
      bookingId: String(booking._id || booking.id || ""),
      bookingStatus: booking.status,
      bookingType: booking.type,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
    },
  });
}

export async function ensureLeadForInboundMessage({ account, contact, conversation, message }) {
  if (!account?.businessId || !contact?._id || !conversation?._id) return null;

  return upsertLeadForConversation({
    businessId: account.businessId,
    contactId: contact._id,
    conversationId: conversation._id,
    source: "whatsapp",
    intent: "enquiry",
    score: 20,
    status: contact.leadStage || "new",
    requirement: message?.text || "",
    metadata: {
      firstMessageId: message?._id ? String(message._id) : "",
    },
  });
}

export async function backfillLeadsFromBookings(businessId) {
  const bookings = await Booking.find({
    businessId,
    contactId: { $ne: null },
    conversationId: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .limit(500);

  await Promise.all(bookings.map((booking) => ensureLeadForBooking(booking)));
}

export async function backfillLeadsFromConversations(businessId) {
  const conversations = await Conversation.find({ businessId })
    .select("_id contactId businessId lastMessage lastMessageAt")
    .sort({ lastMessageAt: -1 })
    .limit(500)
    .lean();

  const existingLeadKeys = await Lead.find({
    businessId,
    conversationId: { $in: conversations.map((item) => item._id) },
  })
    .select("conversationId")
    .lean();
  const conversationsWithLeads = new Set(existingLeadKeys.map((item) => String(item.conversationId)));

  const missing = conversations.filter(
    (conversation) => conversation.contactId && !conversationsWithLeads.has(String(conversation._id))
  );
  if (!missing.length) return;

  const firstMessages = await Message.find({
    businessId,
    conversationId: { $in: missing.map((item) => item._id) },
    direction: "inbound",
  })
    .sort({ createdAt: 1 })
    .select("conversationId text")
    .lean();

  const firstByConversationId = new Map();
  for (const message of firstMessages) {
    const key = String(message.conversationId);
    if (!firstByConversationId.has(key)) firstByConversationId.set(key, message);
  }

  await Promise.all(
    missing.map((conversation) => {
      const firstMessage = firstByConversationId.get(String(conversation._id));
      return upsertLeadForConversation({
        businessId,
        contactId: conversation.contactId,
        conversationId: conversation._id,
        source: "whatsapp",
        intent: "enquiry",
        score: 20,
        status: "new",
        requirement: firstMessage?.text || conversation.lastMessage?.text || "",
        metadata: {
          sourceType: "conversation",
          firstMessageId: firstMessage?._id ? String(firstMessage._id) : "",
        },
      });
    })
  );
}
