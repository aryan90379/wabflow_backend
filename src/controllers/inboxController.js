import {
  Contact,
  Conversation,
  Message,
  WhatsappAccount,
  WhatsappMessageTemplate,
  HandoffRequest,
} from "../models/index.js";
import { BusinessMember } from "../models/BusinessMember.js";
import { env } from "../config/env.js";
import { findOrCreateContactAndConversation } from "../services/conversationService.js";
import { sendAndSaveMessage } from "../services/conversationService.js";
import { getWhatsappAccountWithToken, sendWhatsappTemplatePayload } from "../services/whatsappClient.js";
import { broadcastToBusiness } from "../services/socketService.js";
import { broadcastRawToBusiness } from "../services/rawChatSocketService.js";

const GRAPH_BASE = `https://graph.facebook.com/${env.metaGraphVersion || "v21.0"}`;

async function readMetaJson(response, label) {
  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok || data?.error) {
    const metaError = data?.error || {};
    const error = new Error(metaError.message || `${label} failed with status ${response.status}`);
    error.status = response.status;
    error.meta = {
      code: metaError.code,
      subcode: metaError.error_subcode,
      type: metaError.type,
      fbtraceId: metaError.fbtrace_id,
    };
    throw error;
  }

  return data;
}

function normalizeTemplateStatus(value) {
  const status = String(value || "").toLowerCase();
  if (["approved", "pending", "rejected", "paused", "disabled"].includes(status)) return status;
  return "unknown";
}

function normalizePhone(value = "") {
  const digits = String(value).replace(/[^\d]/g, "");
  return digits.length >= 10 ? digits : "";
}

function slugifyTemplateName(value = "") {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return slug || `inquiry_template_${Date.now()}`;
}

function sanitizeButtons(buttons = []) {
  return buttons
    .map((button, index) => ({
      id: String(button.id || `button_${index + 1}`).trim() || `button_${index + 1}`,
      title: String(button.title || button.label || "").trim().slice(0, 25),
    }))
    .filter((button) => button.title)
    .slice(0, 10);
}

function buildMetaTemplateComponents({ body, footer, buttons }) {
  const components = [
    {
      type: "BODY",
      text: body,
    },
  ];

  if (footer) {
    components.push({
      type: "FOOTER",
      text: footer,
    });
  }

  if (buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map((button) => ({
        type: "QUICK_REPLY",
        text: button.title,
      })),
    });
  }

  return components;
}

function parseMetaTemplateComponents(components = []) {
  const bodyComponent = components.find((component) => component.type === "BODY");
  const footerComponent = components.find((component) => component.type === "FOOTER");
  const buttonComponent = components.find((component) => component.type === "BUTTONS");

  return {
    body: String(bodyComponent?.text || "").trim(),
    footer: String(footerComponent?.text || "").trim(),
    buttons: (buttonComponent?.buttons || [])
      .filter((button) => button.type === "QUICK_REPLY" && button.text)
      .map((button, index) => ({
        id: `button_${index + 1}`,
        title: String(button.text).slice(0, 25),
      })),
  };
}

async function syncBusinessTemplates(businessId) {
  const accounts = await WhatsappAccount.find({
    businessId,
    status: "active",
  }).select("_id wabaId status");

  await Promise.all(accounts.map(async (account) => {
    try {
      const { accessToken } = await getWhatsappAccountWithToken(account._id);
      const url = new URL(`${GRAPH_BASE}/${account.wabaId}/message_templates`);
      url.searchParams.set("fields", "id,name,status,category,language,rejected_reason,components");
      url.searchParams.set("limit", "100");

      const data = await readMetaJson(
        await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } }),
        "List WhatsApp message templates"
      );

      const templates = Array.isArray(data?.data) ? data.data : [];
      await Promise.all(templates.map((item) => {
        const parsed = parseMetaTemplateComponents(item.components);

        return WhatsappMessageTemplate.findOneAndUpdate(
          { businessId, whatsappAccountId: account._id, name: String(item.name || "").toLowerCase() },
          {
            $set: {
              metaTemplateId: item.id || "",
              category: item.category || "MARKETING",
              language: item.language || "en_US",
              status: normalizeTemplateStatus(item.status),
              rejectionReason: item.rejected_reason || "",
              ...(parsed.body ? { body: parsed.body } : {}),
              ...(parsed.footer ? { footer: parsed.footer } : {}),
              ...(parsed.buttons.length ? { buttons: parsed.buttons } : {}),
              lastSyncedAt: new Date(),
            },
            $setOnInsert: {
              wabaId: account.wabaId,
              displayName: item.name || "WhatsApp template",
              body: parsed.body || "Synced from Meta.",
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }));
    } catch (error) {
      console.warn("[templates] Could not sync Meta templates", {
        businessId: String(businessId),
        accountId: String(account._id),
        error: error.message,
      });
    }
  }));
}

async function getPrimaryWhatsappAccount(businessId, requestedAccountId = "") {
  const filter = {
    businessId,
    status: "active",
    ...(requestedAccountId ? { _id: requestedAccountId } : {}),
  };
  return WhatsappAccount.findOne(filter).sort({ connectedAt: -1 });
}

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

export async function listWhatsappMessageTemplates(req, res) {
  await syncBusinessTemplates(req.business._id);

  const templates = await WhatsappMessageTemplate.find({
    businessId: req.business._id,
  }).sort({ updatedAt: -1 });

  return res.json({ success: true, templates, data: templates });
}

export async function createWhatsappMessageTemplate(req, res) {
  const account = await getPrimaryWhatsappAccount(req.business._id, req.body.whatsappAccountId);
  if (!account) {
    return res.status(400).json({ success: false, error: "Connect an active WhatsApp account first." });
  }

  const displayName = String(req.body.displayName || req.body.name || "Inquiry follow up").trim();
  const name = slugifyTemplateName(req.body.name || displayName);
  const body = String(req.body.body || "").trim();
  const footer = String(req.body.footer || "").trim().slice(0, 60);
  const buttons = sanitizeButtons(req.body.buttons);

  if (!body) {
    return res.status(400).json({ success: false, error: "Template message body is required." });
  }

  const { accessToken } = await getWhatsappAccountWithToken(account._id);
  const components = buildMetaTemplateComponents({ body, footer, buttons });

  const result = await readMetaJson(
    await fetch(`${GRAPH_BASE}/${account.wabaId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        category: "MARKETING",
        language: req.body.language || "en_US",
        components,
      }),
    }),
    "Create WhatsApp message template"
  );

  const template = await WhatsappMessageTemplate.findOneAndUpdate(
    { businessId: req.business._id, name },
    {
      $set: {
        whatsappAccountId: account._id,
        wabaId: account.wabaId,
        metaTemplateId: result.id || result.template_id || "",
        displayName,
        category: "MARKETING",
        language: req.body.language || "en_US",
        body,
        footer,
        buttons,
        status: normalizeTemplateStatus(result.status || "pending"),
        rejectionReason: "",
        lastSubmittedAt: new Date(),
        lastSyncedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return res.status(201).json({ success: true, template, data: template });
}

export async function sendWhatsappMessageTemplate(req, res) {
  const template = await WhatsappMessageTemplate.findOne({
    _id: req.params.templateId,
    businessId: req.business._id,
  });

  if (!template) {
    return res.status(404).json({ success: false, error: "Template not found." });
  }

  await syncBusinessTemplates(req.business._id);
  const freshTemplate = await WhatsappMessageTemplate.findById(template._id);

  if (freshTemplate.status !== "approved") {
    return res.status(400).json({
      success: false,
      error: "This template must be approved by WhatsApp before it can be sent.",
      status: freshTemplate.status,
    });
  }

  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Enter a valid WhatsApp phone number with country code." });
  }

  const account = await WhatsappAccount.findOne({
    _id: freshTemplate.whatsappAccountId,
    businessId: req.business._id,
    status: "active",
  });

  if (!account) {
    return res.status(400).json({ success: false, error: "Active WhatsApp account for this template is unavailable." });
  }

  const { contact, conversation } = await findOrCreateContactAndConversation({
    businessId: req.business._id,
    whatsappAccountId: account._id,
    waId: phone,
    phone,
    profileName: req.body.customerName || "",
  });

  const temporaryMessage = await Message.create({
    businessId: req.business._id,
    conversationId: conversation._id,
    contactId: contact._id,
    whatsappAccountId: account._id,
    direction: "outbound",
    senderType: "bot",
    type: freshTemplate.buttons?.length ? "button" : "text",
    text: freshTemplate.body,
    status: "queued",
  });

  try {
    const result = await sendWhatsappTemplatePayload(account._id, phone, freshTemplate);
    temporaryMessage.whatsappMessageId = result?.messages?.[0]?.id || null;
    temporaryMessage.status = "sent";
    await temporaryMessage.save();

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          status: "open",
          lastMessageAt: temporaryMessage.createdAt,
          lastMessage: {
            text: temporaryMessage.text,
            type: temporaryMessage.type,
            direction: "outbound",
            at: temporaryMessage.createdAt,
          },
        },
      }
    );

    const savedConversation = await Conversation.findById(conversation._id)
      .populate("contactId", "name phone waId tags leadStage lastMessageAt")
      .populate("whatsappAccountId", "displayPhoneNumber verifiedName phoneNumberId")
      .lean();
    const conversationPayload = {
      ...savedConversation,
      contact: savedConversation?.contactId && typeof savedConversation.contactId === "object"
        ? savedConversation.contactId
        : null,
      whatsappAccount: savedConversation?.whatsappAccountId && typeof savedConversation.whatsappAccountId === "object"
        ? savedConversation.whatsappAccountId
        : null,
    };

    const messagePayload = temporaryMessage.toObject();
    broadcastToBusiness(req.business._id.toString(), "new_message", messagePayload);
    broadcastRawToBusiness(req.business._id.toString(), "new_message", messagePayload);
    broadcastToBusiness(req.business._id.toString(), "conversation_updated", conversationPayload);
    broadcastRawToBusiness(req.business._id.toString(), "conversation_updated", conversationPayload);

    return res.status(201).json({
      success: true,
      message: temporaryMessage,
      conversation: conversationPayload,
      data: { message: temporaryMessage, conversation: conversationPayload },
    });
  } catch (error) {
    temporaryMessage.status = "failed";
    temporaryMessage.error = error.meta || { message: error.message };
    await temporaryMessage.save();
    throw error;
  }
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
    const ownerMember = await BusinessMember.findOne({
      businessId: conversation.businessId,
      $or: [{ userId: req.userId }, { memberType: "owner" }],
    }).select("name displayName avatarUrl").lean();
    sentByName = ownerMember?.displayName || ownerMember?.name || req.actor?.name || "Admin";
    sentByAvatarUrl = ownerMember?.avatarUrl || req.actor?.avatarUrl || "";
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
    conversation.lastHandledByName = sentByName || "Admin";
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
    conversation.assignedTo = null;
    conversation.assignedToMemberId = null;
    conversation.assignedToName = "";
    conversation.botState.active = false;
    conversation.botState.flowId = null;
    conversation.botState.flowVersion = null;
    conversation.botState.currentNodeId = null;
    conversation.automationResumeByMemberId = req.memberId || null;
    conversation.botState.awaitingInput = null;
    conversation.botState.variables = new Map();
    conversation.botState.updatedAt = new Date();
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
