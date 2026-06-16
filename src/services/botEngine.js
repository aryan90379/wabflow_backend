import {
  WhatsappAccount,
  Business,
  Message,
  BotDecisionLog,
  AutomationFlow,
  ServiceItem,
  HandoffRequest,
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

    if (event.selectionId?.startsWith("service_")) {
      const serviceId = event.selectionId.slice("service_".length);
      const service = await ServiceItem.findOne({
        _id: serviceId,
        businessId: business._id,
        active: true,
      });

      if (service) {
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

    const activeFlowResult = await continueActiveFlow({
      business,
      account,
      contact,
      conversation,
      event,
    });

    if (activeFlowResult.handled) {
      await writeDecision({
        businessId: business._id,
        conversationId: conversation._id,
        messageId: inboundMessage._id,
        intent,
        confidence,
        actionTaken: activeFlowResult.action,
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
