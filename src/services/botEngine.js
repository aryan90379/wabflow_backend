import {
  getWhatsappAccountWithToken,
} from "./whatsappClient.js";
import crypto from "crypto";
import {
  WhatsappAccount,
  Business,
  Message,
  BotDecisionLog,
  AutomationFlow,
  ServiceItem,
  HandoffRequest,
  Booking,
} from "../models/index.js";
import { detectIntent } from "./intentDetector.js";
import {
  findMatchingKnowledge,
  findMatchingRule,
  findTriggeredFlow,
} from "./automationMatcher.js";
import {
  createHandoff,
  findOrCreateContactAndConversation,
  saveInboundMessage,
  sendAndSaveMessage,
} from "./conversationService.js";
import { continueActiveFlow, startFlow } from "./flowEngine.js";
import {
  createFlow,
  ensurePhoneNumberFlowPublicKey,
  updateFlowAssets,
  publishFlow,
  generateBookingFlowJson,
} from "./metaFlowService.js";

function hashFlowDefinition(flowJson) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(flowJson))
    .digest("hex");
}

export async function handleSendBookingMetaFlow({ business, account, contact, conversation, serviceItemId, bookingConfig = {}, event }) {
  let flowId = account.bookingFlowId;
  let flowConfigId = account.bookingFlowConfigId;
  const resolvedBookingConfig = { ...bookingConfig };

  if (serviceItemId && !(resolvedBookingConfig.rooms || []).length) {
    const room = await ServiceItem.findOne({
      _id: serviceItemId,
      businessId: business._id,
      type: "room",
      active: { $ne: false },
    }).lean();

    if (room) {
      resolvedBookingConfig.rooms = [{
        id: String(room._id),
        name: room.name,
        description: room.description || "",
        imageUrl: room.images?.[0] || "",
        price: room.price,
        currency: room.currency || "INR",
      }];
    }
  }

  const flowJson = generateBookingFlowJson({ ...resolvedBookingConfig, flowConfigId: "booking" });
  const flowDefinitionHash = hashFlowDefinition(flowJson);
  const shouldCreateFlow =
    !flowId ||
    !flowConfigId ||
    account.bookingFlowDefinitionHash !== flowDefinitionHash;

  if (shouldCreateFlow) {
    try {
      const { account: tokenAccount, accessToken } = await getWhatsappAccountWithToken(account._id);
      await ensurePhoneNumberFlowPublicKey(tokenAccount, accessToken);
      const flowName = `Booking Flow ${Date.now()}`;
      const flowCreated = await createFlow(account.wabaId, accessToken, flowName);
      
      const assetResult = await updateFlowAssets(flowCreated.id, accessToken, flowJson);
      if (assetResult?.validation_errors?.length) {
        console.error("Meta Flow JSON validation errors:", assetResult.validation_errors);
      }
      await publishFlow(flowCreated.id, accessToken);

      flowId = flowCreated.id;
      flowConfigId = "booking";
      
      await WhatsappAccount.updateOne(
        { _id: account._id },
        {
          bookingFlowId: flowId,
          bookingFlowConfigId: flowConfigId,
          bookingFlowDefinitionHash: flowDefinitionHash,
        }
      );
      account.bookingFlowId = flowId;
      account.bookingFlowConfigId = flowConfigId;
      account.bookingFlowDefinitionHash = flowDefinitionHash;
    } catch (e) {
      console.error("Meta Flow Auto Gen Error:", e.response?.data || e.message);
      // Fallback message if flow creation fails
      await sendAndSaveMessage({
        account,
        contact,
        conversation,
        response: { type: "text", text: "Please tell us what you need, and we will get back to you shortly." },
        senderType: "bot",
      });
      return { handled: true, action: "sent_fallback" };
    }
  }

  const response = {
    type: "flow",
    flowId,
    flowConfigId,
    buttonText: "Book Appointment",
    text: "Please tap the button below to complete your booking.",
    flowData: { serviceItemId: serviceItemId ? String(serviceItemId) : "" },
  };

  await sendAndSaveMessage({ account, contact, conversation, response, senderType: "bot" });
  return { handled: true, action: "sent_booking_flow" };
}


function ruleResponseToConfigured(response) {
  const raw = response?.toObject ? response.toObject() : response || {};

  if (raw.type === "buttons") {
    return {
      type: "buttons",
      text: raw.text,
      header: raw.header,
      footer: raw.footer,
      options: raw.buttons || [],
    };
  }

  if (raw.type === "list") {
    const options = (raw.list?.sections || []).flatMap((section) =>
      (section.rows || []).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description || "",
      }))
    );

    return {
      type: "list",
      text: raw.text,
      header: raw.header,
      footer: raw.footer,
      buttonText: raw.list?.buttonText || "View options",
      options,
    };
  }

  if (raw.type === "image") {
    return { type: "image", text: raw.text, mediaUrl: raw.mediaUrl };
  }

  return { type: "text", text: raw.text || "" };
}

function textLooksLikeRoomListRequest(text = "") {
  const normalized = String(text || "").toLowerCase();
  return /\b(view|show|list|available|see)\b/.test(normalized) && /\b(room|rooms|suite|suites)\b/.test(normalized);
}

async function sendRoomList({ business, account, contact, conversation, message = "Here are our available rooms. Tap Book to reserve." }) {
  const rooms = await ServiceItem.find({
    businessId: business._id,
    type: "room",
    active: true,
  })
    .sort({ createdAt: -1 })
    .limit(10);

  if (!rooms.length) {
    const response = { type: "text", text: "No rooms are available right now. Please check again soon." };
    await sendAndSaveMessage({ account, contact, conversation, response, senderType: "bot" });
    return { response, rooms };
  }

  // Send intro message
  await sendAndSaveMessage({
    account, contact, conversation,
    response: { type: "text", text: message },
    senderType: "bot"
  });

  // Send each room as a separate button message with an image and details
  for (const room of rooms) {
    const priceStr = room.price !== null && room.price !== undefined ? `\nPrice: ${room.currency || "INR"} ${room.price}` : "";
    const bodyText = `*${room.name}*${priceStr}\n\n${room.description || ""}`.trim().slice(0, 1024);
    
    const response = {
      type: "buttons",
      text: bodyText,
      mediaUrl: room.images && room.images.length > 0 ? room.images[0] : undefined,
      options: [
        { id: `book_room_${room._id}`, title: "Book" }
      ]
    };
    await sendAndSaveMessage({ account, contact, conversation, response, senderType: "bot" });
  }

  conversation.botState.active = false;
  conversation.botState.flowId = null;
  conversation.botState.flowVersion = null;
  conversation.botState.currentNodeId = null;
  conversation.botState.awaitingInput = null;
  conversation.botState.updatedAt = new Date();
  await conversation.save();
  return { response: { type: "text", text: "Sent room list" }, rooms };
}

async function sendRoomDetail({ room, account, contact, conversation }) {
  const price = room.price !== null && room.price !== undefined ? `\nPrice: ${room.currency || "INR"} ${room.price}` : "";
  const details = `${room.name}\n${room.description || ""}${price}`.trim();

  await sendAndSaveMessage({
    account,
    contact,
    conversation,
    response: room.images?.[0]
      ? { type: "image", text: details, mediaUrl: room.images[0] }
      : { type: "text", text: details },
    senderType: "bot",
  });

  await sendAndSaveMessage({
    account,
    contact,
    conversation,
    response: {
      type: "buttons",
      text: `Would you like to book ${room.name}?`,
      options: [
        { id: `book_room_${room._id}`, title: "Book now" },
        { id: "room_list", title: "View rooms" },
      ],
    },
    senderType: "bot",
  });

  conversation.botState.active = false;
  conversation.botState.flowId = null;
  conversation.botState.flowVersion = null;
  conversation.botState.currentNodeId = null;
  conversation.botState.awaitingInput = null;
  conversation.botState.variables = new Map([["serviceItemId", String(room._id)], ["roomType", room.name]]);
  conversation.botState.updatedAt = new Date();
  await conversation.save();
}

async function continueRoomBookingShortcut({ conversation, account, contact, event }) {
  const awaiting = conversation.botState?.awaitingInput;
  const variables = conversation.botState?.variables instanceof Map
    ? conversation.botState.variables
    : new Map(Object.entries(conversation.botState?.variables || {}));
  const bookingId = variables.get("_bookingId");

  if (!bookingId || !["room_booking_name", "room_booking_phone", "room_booking_date", "room_booking_time"].includes(awaiting?.nodeId)) {
    return { handled: false };
  }

  const answer = String(event.text || event.selectionTitle || "").trim();
  if (!answer) {
    await sendAndSaveMessage({
      account,
      contact,
      conversation,
      response: { type: "text", text: "Please provide a valid input." },
      senderType: "bot",
    });
    return { handled: true, action: "asked_question" };
  }

  const booking = await Booking.findOne({ _id: bookingId, conversationId: conversation._id });
  if (!booking) {
    conversation.botState.active = false;
    conversation.botState.awaitingInput = null;
    await conversation.save();
    return { handled: false };
  }

  if (awaiting.nodeId === "room_booking_name") {
    booking.customerName = answer;
    await booking.save();
    conversation.botState.awaitingInput = {
      nodeId: "room_booking_phone",
      fieldKey: "customerPhone",
      saveTo: "booking",
      validation: { required: true },
      nextNodeId: "",
    };
    conversation.botState.updatedAt = new Date();
    await conversation.save();
    await sendAndSaveMessage({
      account,
      contact,
      conversation,
      response: { type: "text", text: "What is your phone number?" },
      senderType: "bot",
    });
    return { handled: true, action: "asked_question" };
  }

  if (awaiting.nodeId === "room_booking_phone") {
    booking.customerPhone = answer;
    await booking.save();
    conversation.botState.awaitingInput = {
      nodeId: "room_booking_date",
      fieldKey: "startDate",
      saveTo: "booking",
      validation: { required: true },
      nextNodeId: "",
    };
    conversation.botState.updatedAt = new Date();
    await conversation.save();
    await sendAndSaveMessage({
      account,
      contact,
      conversation,
      response: { type: "text", text: "Which date would you like to book?" },
      senderType: "bot",
    });
    return { handled: true, action: "asked_question" };
  }

  if (awaiting.nodeId === "room_booking_date") {
    booking.startDate = answer;
    await booking.save();
    conversation.botState.awaitingInput = {
      nodeId: "room_booking_time",
      fieldKey: "startTime",
      saveTo: "booking",
      validation: { required: true },
      nextNodeId: "",
    };
    conversation.botState.updatedAt = new Date();
    await conversation.save();
    await sendAndSaveMessage({
      account,
      contact,
      conversation,
      response: { type: "text", text: "What time do you prefer?" },
      senderType: "bot",
    });
    return { handled: true, action: "asked_question" };
  }

  booking.startTime = answer;
  await booking.save();
  conversation.botState.active = false;
  conversation.botState.awaitingInput = null;
  conversation.botState.currentNodeId = null;
  conversation.botState.updatedAt = new Date();
  await conversation.save();
  await sendAndSaveMessage({
    account,
    contact,
    conversation,
    response: { type: "text", text: "Thanks! We have received your room booking request. Our team will check availability and confirm here shortly." },
    senderType: "bot",
  });
  return { handled: true, action: "created_booking" };
}

async function writeDecision({
  businessId,
  conversationId,
  messageId,
  intent,
  confidence,
  actionTaken,
  ruleId = null,
  flowId = null,
  knowledgeId = null,
  reply = "",
  error = "",
  metadata = {},
}) {
  await BotDecisionLog.create({
    businessId,
    conversationId,
    messageId,
    detectedIntent: intent,
    confidence,
    matchedRuleId: ruleId,
    matchedFlowId: flowId,
    matchedKnowledgeId: knowledgeId,
    actionTaken,
    aiReply: reply,
    error,
    metadata,
  });
}

export async function processIncomingMessage(event) {
  const account = await WhatsappAccount.findOne({
    phoneNumberId: event.phoneNumberId,
    status: "active",
  });

  if (!account) {
    console.warn("[webhook] No active account for phoneNumberId", event.phoneNumberId);
    return;
  }

  const business = await Business.findById(account.businessId);
  if (!business || !business.active) return;

  const { contact, conversation } = await findOrCreateContactAndConversation({
    businessId: business._id,
    whatsappAccountId: account._id,
    waId: event.from,
    phone: event.from,
    profileName: event.profileName,
  });

  const inboundMessage = await saveInboundMessage({ account, contact, conversation, event });
  if (!inboundMessage) return;

  const messageCount = await Message.countDocuments({ conversationId: conversation._id, direction: "inbound" });
  const isFirstMessage = messageCount === 1;
  const { intent, confidence } = detectIntent(event.text || event.selectionTitle || "");

  try {
    if (!business.settings.botEnabled) {
      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent,
        confidence,
        actionTaken: "ignored",
        metadata: { reason: "bot_disabled" },
      });
      return;
    }

    if (conversation.status === "human_needed") {
      if (event.selectionId === "talk_to_bot") {
        conversation.status = "open";
        conversation.assignedTo = null;
        conversation.assignedToMemberId = null;
        conversation.assignedToName = "";
        conversation.botState.active = false;
        conversation.botState.flowId = null;
        conversation.botState.flowVersion = null;
        conversation.botState.currentNodeId = null;
        conversation.botState.awaitingInput = null;
        conversation.botState.variables = new Map();
        conversation.botState.updatedAt = new Date();
        await conversation.save();
        await HandoffRequest.updateMany(
          { conversationId: conversation._id, status: { $in: ["open", "assigned"] } },
          { $set: { status: "resolved", resolvedAt: new Date() } }
        );

        const triggeredFlow = await findTriggeredFlow({
          businessId: business._id,
          accountId: account._id,
          text: "",
          intent,
          isFirstMessage: false,
        });

        if (triggeredFlow) {
          const result = await startFlow({
            flow: triggeredFlow,
            business,
            account,
            contact,
            conversation,
            event: { ...event, text: "" },
          });

          await writeDecision({
            businessId: business._id,
            conversationId: conversation._id,
            messageId: inboundMessage._id,
            intent,
            confidence,
            actionTaken: result.action || "bot_resumed_started_flow",
            flowId: triggeredFlow._id,
            metadata: { reason: "customer_tapped_talk_to_bot" },
          });
          return;
        }
        
        await writeDecision({
          businessId: business._id,
          conversationId: conversation._id,
          messageId: inboundMessage._id,
          intent,
          confidence,
          actionTaken: "bot_resumed",
          metadata: { reason: "no_resume_flow_found" },
        });
        return;
      }

      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent,
        confidence,
        actionTaken: "ignored",
        metadata: { reason: "human_handoff_active" },
      });
      return;
    }

    if (event.type === "flow_reply") {
      const responseJson = event.media?.responseJson || {};
      const { flowConfigId } = responseJson;

      if (flowConfigId === "booking") {
        const serviceItemId = responseJson.serviceItemId;
        let roomName = "";
        
        if (serviceItemId) {
          const room = await ServiceItem.findById(serviceItemId);
          if (room) roomName = room.name;
        }

        const booking = await Booking.create({
          businessId: business._id,
          contactId: contact._id,
          conversationId: conversation._id,
          serviceItemId: serviceItemId || null,
          type: serviceItemId ? "room_booking" : "appointment",
          status: "requested",
          customerName: responseJson.customerName || contact.name || "",
          customerPhone: responseJson.customerPhone || contact.phone || contact.waId,
          startDate: responseJson.startDate,
          startTime: responseJson.startTime,
          notes: responseJson.notes || "",
          metadata: new Map(roomName ? [["roomType", roomName]] : []),
        });

        await sendAndSaveMessage({
          account,
          contact,
          conversation,
          response: { type: "text", text: "Thank you! Your booking request has been successfully submitted." },
          senderType: "bot",
        });

        await writeDecision({
          businessId: business._id,
          conversationId: conversation._id,
          messageId: inboundMessage._id,
          intent: "booking_request",
          confidence: 1,
          actionTaken: "created_booking",
          metadata: { bookingId: booking._id, fromMetaFlow: true },
        });

        conversation.botState.active = false;
        conversation.botState.flowId = null;
        conversation.botState.flowVersion = null;
        conversation.botState.currentNodeId = null;
        conversation.botState.awaitingInput = null;
        conversation.botState.updatedAt = new Date();
        await conversation.save();
        return;
      }
    }

    if (event.selectionId === "room_list" || textLooksLikeRoomListRequest(event.text || event.selectionTitle || "")) {
      const { response } = await sendRoomList({
        business,
        account,
        contact,
        conversation,
        message: "Here are the available room options. Tap a room to see details and book.",
      });

      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent: "service_query",
        confidence: 1,
        actionTaken: "sent_reply",
        reply: response.text,
        metadata: { roomList: true },
      });
      return;
    }

    if (event.selectionId?.startsWith("book_room_")) {
      const roomId = event.selectionId.slice("book_room_".length);
      const room = await ServiceItem.findOne({
        _id: roomId,
        businessId: business._id,
        type: "room",
        active: true,
      });

      if (room) {
        const result = await handleSendBookingMetaFlow({ business, account, contact, conversation, serviceItemId: room._id, event });

        await writeDecision({
          businessId: business._id,
          conversationId: conversation._id,
          messageId: inboundMessage._id,
          intent: "booking_request",
          confidence: 1,
          actionTaken: result.action || "sent_booking_flow",
          metadata: { serviceItemId: room._id, roomType: room.name },
        });
        return;
      }
    }

    if (event.selectionId?.startsWith("room_detail_") || event.selectionId?.startsWith("service_")) {
      const isRoomDetail = event.selectionId?.startsWith("room_detail_");
      const serviceId = event.selectionId.slice(isRoomDetail ? "room_detail_".length : "service_".length);
      const service = await ServiceItem.findOne({
        _id: serviceId,
        businessId: business._id,
        active: true,
      });

      if (service) {
        if (service.type === "room") {
          await sendRoomDetail({ room: service, account, contact, conversation });
          await writeDecision({
            businessId: business._id,
            conversationId: conversation._id,
            messageId: inboundMessage._id,
            intent: "service_query",
            confidence: 1,
            actionTaken: "sent_reply",
            metadata: { serviceItemId: service._id, roomDetail: true },
          });
          return;
        }

        const price = service.price !== null && service.price !== undefined ? `\nPrice: ${service.currency || "INR"} ${service.price}` : "";
        const duration = service.durationMinutes ? `\nDuration: ${service.durationMinutes} minutes` : "";
        const reply = `${service.name}\n${service.description || ""}${price}${duration}`.trim();
        await sendAndSaveMessage({
          account,
          contact,
          conversation,
          response: service.images?.[0]
            ? { type: "image", text: reply, mediaUrl: service.images[0] }
            : { type: "text", text: reply },
          senderType: "bot",
        });
        conversation.botState.active = false;
        conversation.botState.flowId = null;
        conversation.botState.flowVersion = null;
        conversation.botState.currentNodeId = null;
        conversation.botState.awaitingInput = null;
        conversation.botState.updatedAt = new Date();
        await conversation.save();
        await writeDecision({
          businessId: business._id,
          conversationId: conversation._id,
          messageId: inboundMessage._id,
          intent: "service_query",
          confidence: 1,
          actionTaken: "sent_reply",
          reply,
          metadata: { serviceItemId: service._id },
        });
        return;
      }
    }

    const roomBookingResult = await continueRoomBookingShortcut({
      conversation,
      account,
      contact,
      event,
    });

    if (roomBookingResult.handled) {
      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent: "booking_request",
        confidence: 1,
        actionTaken: roomBookingResult.action,
        metadata: { roomBookingShortcut: true },
      });
      return;
    }

    const activeFlowResult = await continueActiveFlow({
      business,
      account,
      contact,
      conversation,
      event,
    });

    if (activeFlowResult.handled) {
      let actionTaken = activeFlowResult.action;
      if (activeFlowResult.action === "send_booking_meta_flow") {
        const bookingMetaFlowResult = await handleSendBookingMetaFlow({
          business,
          account,
          contact,
          conversation,
          serviceItemId: activeFlowResult.serviceItemId || activeFlowResult.step?.config?.payload?.serviceItemId,
          bookingConfig: activeFlowResult.bookingConfig || activeFlowResult.step?.config?.payload?.bookingConfig || {},
          event
        });
        actionTaken = bookingMetaFlowResult.action || actionTaken;
      }

      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent,
        confidence,
        actionTaken,
        flowId: activeFlowResult.flow?._id,
      });
      return;
    }

    if (intent === "human_request" && business.settings.handoffEnabled) {
      await createHandoff({
        business,
        contact,
        conversation,
        account,
        reason: "customer_requested_human",
        message: business.settings.handoffMessage,
      });

      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent,
        confidence,
        actionTaken: "handoff",
      });
      return;
    }

    const rule = await findMatchingRule({
      business,
      businessId: business._id,
      text: event.text,
      intent,
      isFirstMessage,
    });

    if (rule) {
      if (rule.response.type === "start_flow" && rule.response.flowId) {
        const flow = await AutomationFlow.findOne({
          _id: rule.response.flowId,
          businessId: business._id,
          status: "published",
        });

        if (flow) {
          const result = await startFlow({ flow, business, account, contact, conversation, event });
          await writeDecision({
            businessId: business._id,
            conversationId: conversation._id,
            messageId: inboundMessage._id,
            intent,
            confidence,
            actionTaken: result.action || "started_flow",
            ruleId: rule._id,
            flowId: flow._id,
          });
          return;
        }
      }

      if (rule.response.type === "catalog") {
        const services = await ServiceItem.find({ businessId: business._id, active: true })
          .sort({ createdAt: -1 })
          .limit(10);

        const response = services.length
          ? {
              type: "list",
              text: rule.response.text || "Choose a service to learn more.",
              buttonText: "View services",
              options: services.map((service) => ({
                id: `service_${service._id}`,
                title: service.name.slice(0, 20),
                description: [
                  service.price !== null ? `${service.currency} ${service.price}` : "",
                  service.description,
                ].filter(Boolean).join(" · ").slice(0, 72),
              })),
            }
          : { type: "text", text: "No services are available right now." };

        await sendAndSaveMessage({ account, contact, conversation, response, senderType: "bot" });
        await writeDecision({
          businessId: business._id,
          conversationId: conversation._id,
          messageId: inboundMessage._id,
          intent,
          confidence,
          actionTaken: "sent_reply",
          ruleId: rule._id,
          reply: response.text,
        });
        return;
      }

      if (rule.response.type === "handoff") {
        await createHandoff({
          business,
          contact,
          conversation,
          account,
          reason: `automation_rule:${rule.name}`,
          message: rule.response.text || business.settings.handoffMessage,
        });

        await writeDecision({
          businessId: business._id,
          conversationId: conversation._id,
          messageId: inboundMessage._id,
          intent,
          confidence,
          actionTaken: "handoff",
          ruleId: rule._id,
        });
        return;
      }

      const response = ruleResponseToConfigured(rule.response);
      await sendAndSaveMessage({ account, contact, conversation, response, senderType: "bot" });
      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent,
        confidence,
        actionTaken: "sent_reply",
        ruleId: rule._id,
        reply: response.text,
      });
      return;
    }

    const triggeredFlow = await findTriggeredFlow({
      businessId: business._id,
      accountId: account._id,
      text: event.text,
      intent,
      isFirstMessage,
    });

    if (triggeredFlow) {
      const result = await startFlow({
        flow: triggeredFlow,
        business,
        account,
        contact,
        conversation,
        event,
      });

      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent,
        confidence,
        actionTaken: result.action || "started_flow",
        flowId: triggeredFlow._id,
      });
      return;
    }

    const knowledge = await findMatchingKnowledge({ businessId: business._id, text: event.text });
    if (knowledge) {
      await sendAndSaveMessage({
        account,
        contact,
        conversation,
        response: { type: "text", text: knowledge.answer },
        senderType: "bot",
      });

      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent,
        confidence,
        actionTaken: "sent_reply",
        knowledgeId: knowledge._id,
        reply: knowledge.answer,
      });
      return;
    }

    const fallback = business.settings.fallbackMessage;
    await sendAndSaveMessage({
      account,
      contact,
      conversation,
      response: { type: "text", text: fallback },
      senderType: "bot",
    });

    await writeDecision({
      businessId: business._id,
      conversationId: conversation._id,
      messageId: inboundMessage._id,
      intent,
      confidence,
      actionTaken: "sent_reply",
      reply: fallback,
      metadata: { fallback: true },
    });
  } catch (error) {
    await writeDecision({
      businessId: business._id,
      conversationId: conversation._id,
      messageId: inboundMessage._id,
      intent,
      confidence,
      actionTaken: "error",
      error: error.message,
      metadata: { meta: error.meta || null },
    }).catch(() => {});
    throw error;
  }
}
