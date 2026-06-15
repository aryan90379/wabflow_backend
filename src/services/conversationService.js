import {
  Contact,
  Conversation,
  Message,
  HandoffRequest,
} from "../models/index.js";
import { sendConfiguredWhatsappResponse } from "./whatsappClient.js";

export async function findOrCreateContactAndConversation({
  businessId,
  whatsappAccountId,
  waId,
  phone,
  profileName,
}) {
  const now = new Date();

  const contact = await Contact.findOneAndUpdate(
    { businessId, waId },
    {
      $set: {
        phone: phone || waId,
        lastMessageAt: now,
        ...(profileName ? { name: profileName } : {}),
      },
      $setOnInsert: { businessId, waId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const conversation = await Conversation.findOneAndUpdate(
    { whatsappAccountId, contactId: contact._id },
    {
      $setOnInsert: {
        businessId,
        contactId: contact._id,
        whatsappAccountId,
        status: "open",
      },
      $set: { lastMessageAt: now },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (conversation.status === "closed") {
    conversation.status = "open";
    await conversation.save();
  }

  return { contact, conversation };
}

export async function saveInboundMessage({ account, contact, conversation, event }) {
  let message;

  try {
    message = await Message.create({
      businessId: account.businessId,
      conversationId: conversation._id,
      contactId: contact._id,
      whatsappAccountId: account._id,
      direction: "inbound",
      senderType: "customer",
      type: event.type,
      text: event.text || event.selectionTitle || "",
      interactive: {
        id: event.selectionId || "",
        title: event.selectionTitle || "",
      },
      media: event.media || {},
      mediaUrl: event.mediaUrl || "",
      whatsappMessageId: event.messageId,
      status: "received",
      rawWebhookEventId: event.webhookEventId || "",
      rawPayload: event.raw,
      createdAt: event.timestamp || new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }

  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: {
        lastMessageAt: message.createdAt,
        lastMessage: {
          text: message.text,
          type: message.type,
          direction: "inbound",
          at: message.createdAt,
        },
      },
      $inc: { unreadCount: 1 },
    }
  );

  return message;
}

export async function sendAndSaveMessage({
  account,
  contact,
  conversation,
  response,
  senderType = "bot",
}) {
  const temporaryMessage = await Message.create({
    businessId: account.businessId,
    conversationId: conversation._id,
    contactId: contact._id,
    whatsappAccountId: account._id,
    direction: "outbound",
    senderType,
    type: response.type === "buttons" ? "button" : response.type === "list" ? "list" : response.type || "text",
    text: response.text || "",
    mediaUrl: response.mediaUrl || "",
    status: "queued",
  });

  try {
    const result = await sendConfiguredWhatsappResponse(account._id, contact.waId, response);
    const whatsappMessageId = result?.messages?.[0]?.id || null;

    temporaryMessage.whatsappMessageId = whatsappMessageId;
    temporaryMessage.status = "sent";
    await temporaryMessage.save();

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessageAt: temporaryMessage.createdAt,
          lastMessage: {
            text: temporaryMessage.text || (temporaryMessage.mediaUrl ? "Image" : ""),
            type: temporaryMessage.type,
            direction: "outbound",
            at: temporaryMessage.createdAt,
          },
        },
      }
    );

    return temporaryMessage;
  } catch (error) {
    temporaryMessage.status = "failed";
    temporaryMessage.error = error.meta || { message: error.message };
    await temporaryMessage.save();
    throw error;
  }
}

export async function createHandoff({ business, contact, conversation, reason, message, account }) {
  const handoff = await HandoffRequest.findOneAndUpdate(
    { conversationId: conversation._id, status: { $in: ["open", "assigned"] } },
    {
      $setOnInsert: {
        businessId: business._id,
        contactId: contact._id,
        conversationId: conversation._id,
        reason,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  conversation.status = "human_needed";
  conversation.botState.active = false;
  conversation.botState.awaitingInput = null;
  conversation.botState.updatedAt = new Date();
  await conversation.save();

  if (message && account) {
    await sendAndSaveMessage({
      account,
      contact,
      conversation,
      response: { type: "text", text: message },
      senderType: "bot",
    });
  }

  return handoff;
}
