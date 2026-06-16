import {
  Contact,
  Conversation,
  Message,
  WhatsappAccount,
  HandoffRequest,
} from "../models/index.js";
import { sendAndSaveMessage } from "../services/conversationService.js";
import { broadcastToBusiness } from "../services/socketService.js";
import { broadcastRawToBusiness } from "../services/rawChatSocketService.js";

async function loadConversation(req) {
  return Conversation.findOne({
    _id: req.params.conversationId,
    businessId: req.business._id,
  });
}

export async function listConversations(req, res) {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
  const filter = { businessId: req.business._id };

  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    Conversation.find(filter)
      .populate("contactId", "name phone waId tags leadStage lastMessageAt")
      .populate("whatsappAccountId", "displayPhoneNumber verifiedName phoneNumberId")
      .sort({ lastMessageAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Conversation.countDocuments(filter),
  ]);
  const conversations = items.map((conversation) => ({
    ...conversation,
    contact: conversation.contactId && typeof conversation.contactId === "object"
      ? conversation.contactId
      : null,
    whatsappAccount: conversation.whatsappAccountId && typeof conversation.whatsappAccountId === "object"
      ? conversation.whatsappAccountId
      : null,
  }));

  return res.json({ success: true, conversations, data: conversations, pagination: { page, limit, total }, page, limit, total });
}

export async function getConversation(req, res) {
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    businessId: req.business._id,
  })
    .populate("contactId", "name phone waId tags leadStage lastMessageAt")
    .populate("whatsappAccountId", "displayPhoneNumber verifiedName phoneNumberId")
    .lean();
  if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });

  const item = {
    ...conversation,
    contact: conversation.contactId && typeof conversation.contactId === "object"
      ? conversation.contactId
      : null,
    whatsappAccount: conversation.whatsappAccountId && typeof conversation.whatsappAccountId === "object"
      ? conversation.whatsappAccountId
      : null,
  };

  return res.json({ success: true, conversation: item, data: item });
}

export async function listMessages(req, res) {
  const conversation = await loadConversation(req);
  if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });

  const before = req.query.before ? new Date(req.query.before) : new Date();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));

  const messages = await Message.find({
    conversationId: conversation._id,
    createdAt: { $lt: before },
  })
    .sort({ createdAt: -1 })
    .limit(limit);

  const data = messages.reverse();
  return res.json({ success: true, messages: data, data, total: data.length, page: 1, limit });
}

export async function sendHumanMessage(req, res) {
  const conversation = await loadConversation(req);
  if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });

  const type = ["text", "image"].includes(req.body.type) ? req.body.type : "text";
  const text = String(req.body.text || "").trim();
  const mediaUrl = String(req.body.mediaUrl || "").trim();

  if (type === "text" && !text) {
    return res.status(400).json({ success: false, error: "Message text is required." });
  }
  if (type === "image" && !mediaUrl) {
    return res.status(400).json({ success: false, error: "Image URL is required." });
  }

  const [contact, account] = await Promise.all([
    Contact.findById(conversation.contactId),
    WhatsappAccount.findById(conversation.whatsappAccountId),
  ]);

  if (!contact || !account || account.status !== "active") {
    return res.status(400).json({ success: false, error: "Active contact/account connection is unavailable." });
  }

  let senderType = "human";
  let sentByUserId = null;
  let sentByMemberId = null;
  let sentByName = "";
  let sentByAvatarUrl = "";

  if (req.authType === "owner") {
    senderType = "owner";
    sentByUserId = req.userId;
    sentByName = "Admin";
  } else if (req.authType === "staff") {
    senderType = "staff";
    sentByMemberId = req.memberId;
    sentByName = req.actor?.name || "Staff";
    sentByAvatarUrl = req.actor?.avatarUrl || "";
  }

  const message = await sendAndSaveMessage({
    account,
    contact,
    conversation,
    response: type === "image" ? { type: "image", text, mediaUrl } : { type: "text", text },
    senderType,
    sentByUserId,
    sentByMemberId,
    sentByName,
    sentByAvatarUrl,
  });

  conversation.status = "human_needed";
  conversation.assignedTo = req.userId;
  if (req.authType === "staff") {
    conversation.lastHandledByMemberId = req.memberId;
    conversation.lastHandledByName = req.actor?.name || "Staff";
  } else {
    conversation.lastHandledByName = "Admin";
  }
  conversation.botState.active = false;
  conversation.botState.awaitingInput = null;
  await conversation.save();

  await HandoffRequest.findOneAndUpdate(
    { conversationId: conversation._id, status: "open" },
    { $set: { status: "assigned", assignedTo: req.userId } }
  );

  return res.status(201).json({ success: true, message, data: message });
}

export async function markConversationRead(req, res) {
  const conversation = await loadConversation(req);
  if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });
  conversation.unreadCount = 0;
  await conversation.save();

  broadcastToBusiness(req.business._id.toString(), "conversation_updated", {
    _id: conversation._id,
    unreadCount: 0,
    lastMessageAt: conversation.lastMessageAt,
  });
  broadcastRawToBusiness(req.business._id.toString(), "conversation_updated", {
    _id: conversation._id,
    unreadCount: 0,
    lastMessageAt: conversation.lastMessageAt,
  });

  return res.json({ success: true, conversation, data: conversation });
}

export async function updateConversationStatus(req, res) {
  const conversation = await loadConversation(req);
  if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });

  const status = req.body.status;
  if (!["open", "bot_handling", "human_needed", "closed"].includes(status)) {
    return res.status(400).json({ success: false, error: "Invalid conversation status." });
  }

  conversation.status = status;

  if (req.body.resumeBot === true) {
    conversation.status = "open";
    conversation.assignedToMemberId = null;
    conversation.assignedToName = "";
    conversation.botState.active = true;
    conversation.automationResumeByMemberId = req.memberId || null;
    conversation.botState.awaitingInput = null;
    await HandoffRequest.updateMany(
      { conversationId: conversation._id, status: { $in: ["open", "assigned"] } },
      { $set: { status: "resolved", resolvedAt: new Date() } }
    );
  }

  if (status === "closed") {
    conversation.closedAt = new Date();
    conversation.closedByMemberId = req.memberId || null;
  }

  await conversation.save();

  broadcastToBusiness(req.business._id.toString(), "conversation_updated", {
    _id: conversation._id,
    status: conversation.status,
    botState: conversation.botState,
    lastMessageAt: conversation.lastMessageAt,
  });
  broadcastRawToBusiness(req.business._id.toString(), "conversation_updated", {
    _id: conversation._id,
    status: conversation.status,
    botState: conversation.botState,
    lastMessageAt: conversation.lastMessageAt,
  });

  return res.json({ success: true, conversation, data: conversation });
}

export async function assignConversation(req, res) {
  const conversation = await loadConversation(req);
  if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });

  const { memberId, name } = req.body; // if null, unassigns

  if (memberId) {
    conversation.assignedToMemberId = memberId;
    conversation.assignedToName = name || "Staff";
  } else {
    conversation.assignedToMemberId = null;
    conversation.assignedToName = "";
  }

  await conversation.save();

  broadcastRawToBusiness(req.business._id.toString(), "conversation_updated", {
    _id: conversation._id,
    assignedToMemberId: conversation.assignedToMemberId,
    assignedToName: conversation.assignedToName,
    lastMessageAt: conversation.lastMessageAt,
  });

  return res.json({ success: true, conversation, data: conversation });
}
