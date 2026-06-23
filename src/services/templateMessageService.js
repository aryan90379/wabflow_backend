import {
  Conversation,
  Message,
  WhatsappAccount,
  WhatsappMessageTemplate,
} from "../models/index.js";
import { findOrCreateContactAndConversation } from "./conversationService.js";
import { sendWhatsappTemplatePayload } from "./whatsappClient.js";
import { broadcastToBusiness } from "./socketService.js";
import { broadcastRawToBusiness } from "./rawChatSocketService.js";

function getTemplateParameterCount(body = "") {
  const variables = [...String(body).matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);

  return variables.length ? Math.max(...variables) : 0;
}

function normalizeTemplateVariables(template, templateVariables, customerName) {
  const parameterCount = getTemplateParameterCount(template.body);
  if (!parameterCount) return [];

  if (Array.isArray(templateVariables)) {
    return Array.from({ length: parameterCount }, (_, index) => (
      templateVariables[index] ?? (index === 0 ? customerName : "")
    ));
  }

  if (templateVariables && typeof templateVariables === "object") {
    if (templateVariables.kind === "booking_reminder") {
      const compact = [
        templateVariables.customerName,
        templateVariables.reason,
        templateVariables.date,
        templateVariables.time,
      ];
      const withBusiness = [
        templateVariables.customerName,
        templateVariables.reason,
        templateVariables.businessName,
        templateVariables.date,
        templateVariables.time,
      ];
      const values = parameterCount <= 4 ? compact : withBusiness;

      return Array.from({ length: parameterCount }, (_, index) => values[index] ?? "");
    }

    if (Array.isArray(templateVariables.values)) {
      return Array.from({ length: parameterCount }, (_, index) => templateVariables.values[index] ?? "");
    }
  }

  return Array.from({ length: parameterCount }, (_, index) => (index === 0 ? customerName : ""));
}

function renderTemplateBody(body, variables) {
  return variables.reduce((text, value, index) => (
    text.replace(new RegExp(`\\{\\{\\s*${index + 1}\\s*\\}\\}`, "g"), String(value ?? ""))
  ), body);
}

export async function sendApprovedTemplateMessage({
  businessId,
  templateId,
  phone,
  customerName = "",
  templateVariables = [],
}) {
  const template = await WhatsappMessageTemplate.findOne({
    _id: templateId,
    businessId,
  });

  if (!template) {
    const error = new Error("Template not found.");
    error.status = 404;
    throw error;
  }

  if (template.status !== "approved") {
    const error = new Error("This template must be approved by WhatsApp before it can be sent.");
    error.status = 400;
    error.templateStatus = template.status;
    throw error;
  }

  const account = await WhatsappAccount.findOne({
    _id: template.whatsappAccountId,
    businessId,
    status: "active",
  });

  if (!account) {
    const error = new Error("Active WhatsApp account for this template is unavailable.");
    error.status = 400;
    throw error;
  }

  const normalizedVariables = normalizeTemplateVariables(template, templateVariables, customerName);

  const { contact, conversation } = await findOrCreateContactAndConversation({
    businessId,
    whatsappAccountId: account._id,
    waId: phone,
    phone,
    profileName: customerName,
  });

  const renderedText = normalizedVariables.length
    ? renderTemplateBody(template.body, normalizedVariables)
    : template.body;

  const temporaryMessage = await Message.create({
    businessId,
    conversationId: conversation._id,
    contactId: contact._id,
    whatsappAccountId: account._id,
    direction: "outbound",
    senderType: "bot",
    type: template.buttons?.length ? "button" : "text",
    text: renderedText,
    status: "queued",
  });

  const updatedConversation = await Conversation.findOneAndUpdate(
    { _id: conversation._id },
    { $inc: { lastServerSequence: 1 } },
    { new: true }
  );
  temporaryMessage.serverSequence = updatedConversation.lastServerSequence;
  await temporaryMessage.save();

  try {
    const result = await sendWhatsappTemplatePayload(account._id, phone, template, normalizedVariables);
    temporaryMessage.whatsappMessageId = result?.messages?.[0]?.id || null;
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
    broadcastToBusiness(String(businessId), "new_message", messagePayload);
    broadcastRawToBusiness(String(businessId), "new_message", messagePayload);
    broadcastToBusiness(String(businessId), "conversation_updated", conversationPayload);
    broadcastRawToBusiness(String(businessId), "conversation_updated", conversationPayload);

    return {
      message: temporaryMessage,
      conversation: conversationPayload,
    };
  } catch (error) {
    temporaryMessage.status = "failed";
    temporaryMessage.error = error.meta || { message: error.message };
    await temporaryMessage.save();
    throw error;
  }
}
