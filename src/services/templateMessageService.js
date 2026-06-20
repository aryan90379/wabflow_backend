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

export async function sendApprovedTemplateMessage({
  businessId,
  templateId,
  phone,
  customerName = "",
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

  const { contact, conversation } = await findOrCreateContactAndConversation({
    businessId,
    whatsappAccountId: account._id,
    waId: phone,
    phone,
    profileName: customerName,
  });

  const temporaryMessage = await Message.create({
    businessId,
    conversationId: conversation._id,
    contactId: contact._id,
    whatsappAccountId: account._id,
    direction: "outbound",
    senderType: "bot",
    type: template.buttons?.length ? "button" : "text",
    text: template.body,
    status: "queued",
  });

  try {
    const result = await sendWhatsappTemplatePayload(account._id, phone, template);
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
