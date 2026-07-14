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
import { sendApprovedTemplateMessage } from "../services/templateMessageService.js";

const GRAPH_BASE = `https://graph.facebook.com/${env.metaGraphVersion || "v21.0"}`;

const buildMetaUrl = (path, params = {}) => {
  const url = new URL(`${GRAPH_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

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
    const detail = metaError.error_data?.details || metaError.error_user_msg || metaError.message || "";
    const error = new Error(detail || metaError.message || `${label} failed with status ${response.status}`);
    error.status = response.status;
    error.meta = {
      message: metaError.message,
      details: metaError.error_data?.details,
      errorUserTitle: metaError.error_user_title,
      errorUserMsg: metaError.error_user_msg,
      code: metaError.code,
      subcode: metaError.error_subcode,
      type: metaError.type,
      fbtraceId: metaError.fbtrace_id,
      raw: data,
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
  const validButtons = buttons
    .map((button, index) => {
      const type = ["URL", "PHONE_NUMBER"].includes(String(button.type || "").toUpperCase())
        ? String(button.type).toUpperCase()
        : "QUICK_REPLY";
      return {
        id: String(button.id || `button_${index + 1}`).trim() || `button_${index + 1}`,
        title: String(button.title || button.label || "").trim().slice(0, 25),
        type,
        url: type === "URL" ? String(button.url || "").trim() : "",
        phoneNumber: type === "PHONE_NUMBER" ? String(button.phoneNumber || "").trim() : "",
      };
    })
    .filter((button) => {
      if (!button.title) return false;
      if (button.type === "URL") return /^https:\/\/\S+/i.test(button.url);
      if (button.type === "PHONE_NUMBER") return /^\+?[\d\s()-]{8,20}$/.test(button.phoneNumber);
      return true;
    });

  if (!validButtons.length) return [];

  const quickReplyGroup = validButtons[0].type === "QUICK_REPLY";
  if (quickReplyGroup) {
    return validButtons
      .filter((button) => button.type === "QUICK_REPLY")
      .slice(0, 10);
  }

  let urlCount = 0;
  let phoneCount = 0;
  return validButtons
    .filter((button) => {
      if (button.type === "QUICK_REPLY") return false;
      if (button.type === "URL") {
        if (urlCount >= 2) return false;
        urlCount += 1;
        return true;
      }
      if (phoneCount >= 1) return false;
      phoneCount += 1;
      return true;
    })
    .slice(0, 2);
}

function sanitizeCarouselCards(cards = []) {
  return cards
    .map((card) => ({
      mediaType: String(card.mediaType || "IMAGE").toUpperCase() === "VIDEO" ? "VIDEO" : "IMAGE",
      mediaUrl: String(card.mediaUrl || "").trim(),
      body: String(card.body || "").trim().slice(0, 160),
      buttons: sanitizeButtons(card.buttons).slice(0, 2),
    }))
    .filter((card) => /^https:\/\/\S+/i.test(card.mediaUrl) && card.body && card.buttons.length)
    .slice(0, 10);
}

function mediaContentTypeFromUrl(url = "") {
  const lower = String(url || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

async function createMetaUploadSession({ accessToken, fileLength, fileType }) {
  if (!env.metaAppId) {
    throw new Error("META_APP_ID is required to upload WhatsApp template images.");
  }

  return readMetaJson(
    await fetch(
      buildMetaUrl(`/${env.metaAppId}/uploads`, {
        file_length: fileLength,
        file_type: fileType,
        access_token: accessToken,
      }),
      { method: "POST" }
    ),
    "Create Meta upload session"
  );
}

async function uploadMetaFileBytes({ accessToken, uploadSessionId, buffer }) {
  const result = await readMetaJson(
    await fetch(buildMetaUrl(`/${uploadSessionId}`), {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    }),
    "Upload Meta template image"
  );

  if (!result.h) {
    throw new Error("Meta upload did not return an image handle.");
  }

  return result.h;
}

async function uploadTemplateHeaderMediaHandle(mediaUrl, accessToken, expectedType = "IMAGE") {
  const mediaResponse = await fetch(mediaUrl);
  if (!mediaResponse.ok) {
    throw new Error(`Could not fetch template media URL. Status ${mediaResponse.status}`);
  }

  const contentType =
    mediaResponse.headers.get("content-type")?.split(";")[0]?.trim() ||
    mediaContentTypeFromUrl(mediaUrl);

  const allowed =
    expectedType === "VIDEO"
      ? /^video\/mp4$/i.test(contentType)
      : expectedType === "DOCUMENT"
        ? /^application\/pdf$/i.test(contentType)
        : /^image\/(jpeg|jpg|png|webp)$/i.test(contentType);
  if (!allowed) {
    throw new Error(`Template ${expectedType.toLowerCase()} has an unsupported content type: ${contentType}.`);
  }

  const buffer = Buffer.from(await mediaResponse.arrayBuffer());
  const uploadSession = await createMetaUploadSession({
    accessToken,
    fileLength: buffer.length,
    fileType: contentType.replace("image/jpg", "image/jpeg"),
  });

  return uploadMetaFileBytes({
    accessToken,
    uploadSessionId: uploadSession.id,
    buffer,
  });
}

function getBodyVariableExamples(body = "") {
  const variables = [...String(body).matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (variables.length === 0) return null;

  const maxVariable = Math.max(...variables);
  const defaults = [
    "Jane Doe",
    "follow-up visit",
    "Care Clinic",
    "24 June 2026",
    "10:30 AM",
  ];

  return Array.from({ length: maxVariable }, (_, index) => defaults[index] || `Sample ${index + 1}`);
}

function validateTemplateBody(body = "") {
  const text = String(body || "").trim();
  const variables = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!variables.length) return [];

  const errors = [];
  const maxVariable = Math.max(...variables);
  const uniqueVariables = new Set(variables);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  for (let index = 1; index <= maxVariable; index += 1) {
    if (!uniqueVariables.has(index)) {
      errors.push(`Template variables must be sequential. Missing {{${index}}}.`);
      break;
    }
  }

  if (variables.length !== uniqueVariables.size) {
    errors.push("Each template variable should appear only once.");
  }

  if (maxVariable >= 5 && wordCount < 25) {
    errors.push("This message has too many variables for a short WhatsApp utility template. Use fewer variables or add more fixed text.");
  }

  if (/^\s*\{\{\s*\d+\s*\}\}/.test(text) || /\{\{\s*\d+\s*\}\}\s*$/.test(text)) {
    errors.push("WhatsApp templates should not start or end with a variable.");
  }

  return errors;
}

function toMetaButton(button) {
  if (button.type === "URL") {
    return { type: "URL", text: button.title, url: button.url };
  }
  if (button.type === "PHONE_NUMBER") {
    return { type: "PHONE_NUMBER", text: button.title, phone_number: button.phoneNumber };
  }
  return { type: "QUICK_REPLY", text: button.title };
}

function buildMetaTemplateComponents({
  body,
  footer,
  buttons,
  headerType,
  headerImageHandle,
  format = "STANDARD",
  carouselCards = [],
  carouselHandles = [],
}) {
  const components = [];

  if (format === "STANDARD" && headerType !== "NONE" && headerImageHandle) {
    components.push({
      type: "HEADER",
      format: headerType,
      example: {
        header_handle: [headerImageHandle],
      },
    });
  }

  const bodyComponent = {
    type: "BODY",
    text: body,
  };
  const bodyExamples = getBodyVariableExamples(body);
  if (bodyExamples) {
    bodyComponent.example = {
      body_text: [bodyExamples],
    };
  }
  components.push(bodyComponent);

  if (format === "STANDARD" && footer) {
    components.push({
      type: "FOOTER",
      text: footer,
    });
  }

  if (format === "STANDARD" && buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map(toMetaButton),
    });
  }

  if (format === "CAROUSEL") {
    components.push({
      type: "CAROUSEL",
      cards: carouselCards.map((card, index) => ({
        components: [
          {
            type: "HEADER",
            format: card.mediaType,
            example: { header_handle: [carouselHandles[index]] },
          },
          { type: "BODY", text: card.body },
          { type: "BUTTONS", buttons: card.buttons.map(toMetaButton) },
        ],
      })),
    });
  }

  return components;
}

function parseMetaTemplateComponents(components = []) {
  const headerComponent = components.find((component) => component.type === "HEADER");
  const bodyComponent = components.find((component) => component.type === "BODY");
  const footerComponent = components.find((component) => component.type === "FOOTER");
  const buttonComponent = components.find((component) => component.type === "BUTTONS");
  const carouselComponent = components.find((component) => component.type === "CAROUSEL");
  const headerType = ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerComponent?.format)
    ? headerComponent.format
    : "NONE";

  const carouselCards = (carouselComponent?.cards || []).map((card) => {
    const cardHeader = card.components?.find((component) => component.type === "HEADER");
    const cardBody = card.components?.find((component) => component.type === "BODY");
    const cardButtons = card.components?.find((component) => component.type === "BUTTONS");
    return {
      mediaType: cardHeader?.format === "VIDEO" ? "VIDEO" : "IMAGE",
      mediaUrl: String(
        cardHeader?.example?.header_url?.[0] ||
          cardHeader?.example?.header_handle?.[0] ||
          ""
      ),
      body: String(cardBody?.text || "").slice(0, 160),
      buttons: (cardButtons?.buttons || []).map((button, index) => ({
        id: `card_button_${index + 1}`,
        title: String(button.text || "Action").slice(0, 25),
        type: ["URL", "PHONE_NUMBER"].includes(button.type) ? button.type : "QUICK_REPLY",
        url: button.url || "",
        phoneNumber: button.phone_number || "",
      })),
    };
  });

  return {
    format: carouselCards.length ? "CAROUSEL" : "STANDARD",
    headerType,
    headerImageUrl: String(
      headerComponent?.example?.header_handle?.[0] ||
        headerComponent?.example?.header_url?.[0] ||
        ""
    ).trim(),
    body: String(bodyComponent?.text || "").trim(),
    footer: String(footerComponent?.text || "").trim(),
    buttons: (buttonComponent?.buttons || [])
      .filter((button) => button.text)
      .map((button, index) => ({
        id: `button_${index + 1}`,
        title: String(button.text).slice(0, 25),
        type: ["URL", "PHONE_NUMBER"].includes(button.type) ? button.type : "QUICK_REPLY",
        url: button.url || "",
        phoneNumber: button.phone_number || "",
      })),
    carouselCards,
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
              format: parsed.format,
              headerType: parsed.headerType,
              headerImageUrl: parsed.headerImageUrl,
              body: parsed.body || "Synced from Meta.",
              ...(parsed.footer ? { footer: parsed.footer } : {}),
              ...(parsed.buttons.length ? { buttons: parsed.buttons } : {}),
              ...(parsed.carouselCards.length ? { carouselCards: parsed.carouselCards } : {}),
              lastSyncedAt: new Date(),
            },
            $setOnInsert: {
              wabaId: account.wabaId,
              displayName: item.name || "WhatsApp template",
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
  const format = req.body.format === "CAROUSEL" ? "CAROUSEL" : "STANDARD";
  const carouselCards = format === "CAROUSEL"
    ? sanitizeCarouselCards(req.body.carouselCards)
    : [];
  const requestedHeaderType = String(req.body.headerType || "NONE").toUpperCase();
  const headerType =
    format === "STANDARD" && ["IMAGE", "VIDEO", "DOCUMENT"].includes(requestedHeaderType)
      ? requestedHeaderType
      : "NONE";
  const headerImageUrl = String(req.body.headerImageUrl || "").trim();
  const category = String(req.body.category || "MARKETING").toUpperCase() === "UTILITY"
    ? "UTILITY"
    : "MARKETING";

  if (!body) {
    return res.status(400).json({ success: false, error: "Template message body is required." });
  }

  const bodyValidationErrors = validateTemplateBody(body);
  if (bodyValidationErrors.length) {
    return res.status(400).json({
      success: false,
      error: "Template content needs adjustment.",
      details: bodyValidationErrors,
    });
  }

  if (headerType !== "NONE" && !/^https:\/\/\S+/i.test(headerImageUrl)) {
    return res.status(400).json({
      success: false,
      error: "Media templates need a public HTTPS media URL.",
    });
  }

  if (format === "CAROUSEL" && category !== "MARKETING") {
    return res.status(400).json({
      success: false,
      error: "Carousel campaigns must use the Marketing category.",
    });
  }

  if (format === "CAROUSEL" && carouselCards.length < 2) {
    return res.status(400).json({
      success: false,
      error: "A carousel needs at least 2 complete cards with an image, text, and action.",
    });
  }

  const { accessToken } = await getWhatsappAccountWithToken(account._id);
  const headerImageHandle = headerType !== "NONE"
    ? await uploadTemplateHeaderMediaHandle(headerImageUrl, accessToken, headerType)
    : "";
  const carouselHandles = format === "CAROUSEL"
    ? await Promise.all(
        carouselCards.map((card) => uploadTemplateHeaderMediaHandle(card.mediaUrl, accessToken, card.mediaType))
      )
    : [];
  const components = buildMetaTemplateComponents({
    body,
    footer,
    buttons,
    headerType,
    headerImageHandle,
    format,
    carouselCards,
    carouselHandles,
  });

  const result = await readMetaJson(
    await fetch(`${GRAPH_BASE}/${account.wabaId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        category,
        language: req.body.language || "en_US",
        allow_category_change: true,
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
        format,
        category: ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(String(result.category || "").toUpperCase())
          ? String(result.category).toUpperCase()
          : category,
        language: req.body.language || "en_US",
        body,
        footer,
        headerType,
        headerImageUrl,
        buttons,
        carouselCards,
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

  try {
    const { message, conversation } = await sendApprovedTemplateMessage({
      businessId: req.business._id,
      templateId: freshTemplate._id,
      phone,
      customerName: req.body.customerName || "",
    });

    return res.status(201).json({
      success: true,
      message,
      conversation,
      data: { message, conversation },
    });
  } catch (error) {
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
    .limit(limit)
    .lean();

  const data = messages.reverse();
  return res.json({
    success: true,
    messages: data,
    data,
    total: data.length,
    page: 1,
    limit,
    hasMore: messages.length === limit,
  });
}

export async function sendHumanMessage(req, res) {
  const conversation = await loadConversation(req);
  if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });

  const clientMessageId = req.headers["idempotency-key"] || req.body.clientMessageId;

  if (clientMessageId) {
    const existingMessage = await Message.findOne({
      businessId: req.business._id,
      conversationId: conversation._id,
      clientMessageId: clientMessageId,
    });
    if (existingMessage) {
      return res.status(200).json({ success: true, message: existingMessage, data: existingMessage });
    }
  }

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
    clientMessageId,
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
    conversation.botState.active = true;
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

export async function syncConversations(req, res) {
  const businessId = req.business._id;
  const whatsappAccountId = req.query.whatsappAccountId;
  const afterCursor = req.query.afterCursor; // Expect an ISO date string
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));

  const filter = { businessId };
  if (whatsappAccountId) {
    filter.whatsappAccountId = whatsappAccountId;
  }
  if (afterCursor) {
    const afterDate = new Date(afterCursor);
    if (!isNaN(afterDate.getTime())) {
      filter.updatedAt = { $gt: afterDate };
    }
  }

  const items = await Conversation.find(filter)
    .populate("contactId", "name phone waId tags leadStage lastMessageAt")
    .populate("whatsappAccountId", "displayPhoneNumber verifiedName phoneNumberId")
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  const conversations = items.map((conversation) => ({
    ...conversation,
    contact: conversation.contactId && typeof conversation.contactId === "object"
      ? conversation.contactId
      : null,
    whatsappAccount: conversation.whatsappAccountId && typeof conversation.whatsappAccountId === "object"
      ? conversation.whatsappAccountId
      : null,
  }));

  const hasMore = items.length === limit;
  const nextCursor = items.length > 0 ? items[items.length - 1].updatedAt.toISOString() : afterCursor || null;

  return res.json({
    success: true,
    conversations,
    deletedConversationIds: [], // We'd need a tombstone table to track hard deletes if any.
    nextCursor,
    hasMore,
    serverTime: new Date().toISOString(),
  });
}

export async function syncMessages(req, res) {
  const conversation = await loadConversation(req);
  if (!conversation) return res.status(404).json({ success: false, error: "Conversation not found." });

  const afterSequence = Number(req.query.afterSequence) || 0;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const filter = { conversationId: conversation._id };

  if (afterSequence > 0) {
    filter.serverSequence = { $gt: afterSequence };
  }

  const messages = await Message.find(filter)
    .sort(afterSequence > 0 ? { serverSequence: 1, createdAt: 1 } : { createdAt: 1 })
    .limit(limit)
    .lean();

  const hasMore = messages.length === limit;
  const nextSequence = messages.reduce((max, message) => {
    const sequence = Number(message.serverSequence || 0);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, afterSequence);

  return res.json({
    success: true,
    messages,
    nextSequence,
    hasMore,
    serverTime: new Date().toISOString(),
  });
}
