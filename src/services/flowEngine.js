import mongoose from "mongoose";
import {
  AutomationFlow,
  Lead,
  Booking,
  Contact,
  Conversation,
} from "../models/index.js";
import { interpolate, normalizeText } from "../utils/text.js";
import { createHandoff, sendAndSaveMessage } from "./conversationService.js";

const MAX_NODE_STEPS = 25;

function mapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (typeof value.toObject === "function") return value.toObject();
  return { ...value };
}

function getByPath(object, path = "") {
  return path.split(".").filter(Boolean).reduce((current, key) => current?.[key], object);
}

function compareValue(actual, operator, expected) {
  if (operator === "exists") return actual !== undefined && actual !== null && actual !== "";
  if (operator === "equals") return String(actual ?? "") === String(expected ?? "");
  if (operator === "not_equals") return String(actual ?? "") !== String(expected ?? "");
  if (operator === "contains") return normalizeText(actual).includes(normalizeText(expected));
  if (operator === "gt") return Number(actual) > Number(expected);
  if (operator === "gte") return Number(actual) >= Number(expected);
  if (operator === "lt") return Number(actual) < Number(expected);
  if (operator === "lte") return Number(actual) <= Number(expected);
  return false;
}

function buildVariables({ business, contact, conversation, event }) {
  const session = mapToObject(conversation.botState?.variables);
  return {
    ...session,
    session,
    business: business.toObject ? business.toObject() : business,
    contact: contact.toObject ? contact.toObject() : contact,
    message: {
      text: event?.text || "",
      selectionId: event?.selectionId || "",
      selectionTitle: event?.selectionTitle || "",
    },
  };
}

function renderResponse(response, variables) {
  const source = response?.toObject ? response.toObject() : response || {};
  return {
    ...source,
    text: interpolate(source.text || "", variables),
    header: interpolate(source.header || "", variables),
    footer: interpolate(source.footer || "", variables),
    mediaUrl: interpolate(source.mediaUrl || "", variables),
    filename: interpolate(source.filename || "", variables),
    options: (source.options || []).map((option) => ({
      ...option,
      title: interpolate(option.title || "", variables),
      description: interpolate(option.description || "", variables),
    })),
  };
}

function validateAnswer(rawValue, validation = {}) {
  const value = String(rawValue ?? "").trim();

  if (validation.required !== false && !value) {
    return { valid: false, value, error: "required" };
  }

  if (validation.type === "number") {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return { valid: false, value, error: "number" };
    if (validation.min !== undefined && numberValue < Number(validation.min)) return { valid: false, value, error: "min" };
    if (validation.max !== undefined && numberValue > Number(validation.max)) return { valid: false, value, error: "max" };
    return { valid: true, value: numberValue };
  }

  if (validation.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { valid: false, value, error: "email" };
  }

  if (validation.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { valid: false, value, error: "date" };
  }

  if (validation.regex) {
    try {
      if (!new RegExp(validation.regex, validation.flags || "i").test(value)) {
        return { valid: false, value, error: "regex" };
      }
    } catch {
      return { valid: false, value, error: "invalid_regex" };
    }
  }

  if (validation.allowedValues?.length) {
    const allowed = validation.allowedValues.map((item) => String(item));
    if (!allowed.includes(value)) return { valid: false, value, error: "allowed_values" };
  }

  return { valid: true, value };
}

async function getOrCreateLead(context, defaults = {}) {
  const variables = mapToObject(context.conversation.botState.variables);
  let lead = variables._leadId && mongoose.isValidObjectId(variables._leadId)
    ? await Lead.findById(variables._leadId)
    : null;

  if (!lead) {
    lead = await Lead.create({
      businessId: context.business._id,
      contactId: context.contact._id,
      conversationId: context.conversation._id,
      source: "whatsapp",
      ...defaults,
    });
    context.conversation.botState.variables.set("_leadId", String(lead._id));
  }

  return lead;
}

async function getOrCreateBooking(context, defaults = {}) {
  const variables = mapToObject(context.conversation.botState.variables);
  let booking = variables._bookingId && mongoose.isValidObjectId(variables._bookingId)
    ? await Booking.findById(variables._bookingId)
    : null;

  if (!booking) {
    booking = await Booking.create({
      businessId: context.business._id,
      contactId: context.contact._id,
      conversationId: context.conversation._id,
      customerName: context.contact.name || "",
      customerPhone: context.contact.phone || context.contact.waId,
      ...defaults,
    });
    context.conversation.botState.variables.set("_bookingId", String(booking._id));
  }

  return booking;
}

async function saveAnswer(context, awaiting, value) {
  const fieldKey = awaiting.fieldKey;
  context.conversation.botState.variables.set(fieldKey, value);

  if (awaiting.saveTo === "contact") {
    const directFields = ["name", "phone", "notes", "leadStage"];
    if (directFields.includes(fieldKey)) {
      context.contact.set(fieldKey, value);
    } else {
      context.contact.customFields.set(fieldKey, value);
    }
    await context.contact.save();
  }

  if (awaiting.saveTo === "lead") {
    const lead = await getOrCreateLead(context);
    const allowed = ["intent", "score", "status", "requirement", "budget", "preferredDate", "preferredTime", "city"];
    if (allowed.includes(fieldKey)) lead.set(fieldKey, value);
    else lead.metadata.set(fieldKey, value);
    await lead.save();
  }

  if (awaiting.saveTo === "booking") {
    const booking = await getOrCreateBooking(context);
    const allowed = ["type", "status", "startDate", "endDate", "startTime", "guests", "customerName", "customerPhone", "notes"];
    if (allowed.includes(fieldKey)) booking.set(fieldKey, value);
    else booking.metadata.set(fieldKey, value);
    await booking.save();
  }
}

function resolveConfigValue(value, variables) {
  if (typeof value === "string") {
    if (value.startsWith("$")) return getByPath(variables, value.slice(1));
    return interpolate(value, variables);
  }
  if (Array.isArray(value)) return value.map((item) => resolveConfigValue(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveConfigValue(item, variables)]));
  }
  return value;
}

async function executeAction(node, context) {
  const actionAliases = {
    add_tag: "add_contact_tag",
    close_chat: "close_conversation",
  };
  const actionType = actionAliases[node.action?.actionType] || node.action?.actionType;
  const variables = buildVariables(context);
  const config = resolveConfigValue(node.action?.config || {}, variables);

  if (actionType === "set_variable") {
    context.conversation.botState.variables.set(config.key, config.value);
  }

  if (actionType === "add_contact_tag" && config.tag) {
    await Contact.updateOne({ _id: context.contact._id }, { $addToSet: { tags: String(config.tag).toLowerCase() } });
    context.contact.tags = [...new Set([...(context.contact.tags || []), String(config.tag).toLowerCase()])];
  }

  if (actionType === "remove_contact_tag" && config.tag) {
    await Contact.updateOne({ _id: context.contact._id }, { $pull: { tags: String(config.tag).toLowerCase() } });
    context.contact.tags = (context.contact.tags || []).filter((tag) => tag !== String(config.tag).toLowerCase());
  }

  if (actionType === "create_lead") {
    const lead = await getOrCreateLead(context, config);
    Object.assign(lead, config);
    await lead.save();
  }

  if (actionType === "update_lead") {
    const lead = await getOrCreateLead(context);
    Object.assign(lead, config);
    await lead.save();
  }

  if (actionType === "create_booking") {
    const booking = await getOrCreateBooking(context, config);
    Object.assign(booking, config);
    await booking.save();
  }

  if (actionType === "update_booking") {
    const booking = await getOrCreateBooking(context);
    Object.assign(booking, config);
    await booking.save();
  }

  if (actionType === "close_conversation") {
    context.conversation.status = "closed";
    context.conversation.botState.active = false;
  }
}

async function processWaitingInput(flow, context) {
  const awaiting = context.conversation.botState.awaitingInput;
  if (!awaiting) return false;

  const node = flow.nodes.find((item) => item.nodeId === awaiting.nodeId);
  if (!node) throw new Error(`Waiting node ${awaiting.nodeId} no longer exists in flow.`);

  let rawValue = context.event?.selectionTitle || context.event?.text || "";
  let optionNextNodeId = "";
  if (context.event?.selectionId && node.response?.options?.length) {
    const option = node.response.options.find((item) => item.id === context.event.selectionId);
    if (option) {
      rawValue = option.value ?? option.title;
      optionNextNodeId = option.nextNodeId || "";
    }
  }

  const result = validateAnswer(rawValue, awaiting.validation || {});
  if (!result.valid) {
    await sendAndSaveMessage({
      account: context.account,
      contact: context.contact,
      conversation: context.conversation,
      response: { type: "text", text: node.question?.retryText || "Please enter a valid value." },
      senderType: "bot",
    });
    return true;
  }

  await saveAnswer(context, awaiting, result.value);
  context.conversation.botState.awaitingInput = null;
  context.conversation.botState.currentNodeId = optionNextNodeId || awaiting.nextNodeId || node.nextNodeId || null;
  return false;
}

async function processOptionSelection(flow, context) {
  const selectionId = context.event?.selectionId;
  if (!selectionId || !context.conversation.botState.currentNodeId) return false;

  const node = flow.nodes.find((item) => item.nodeId === context.conversation.botState.currentNodeId);
  const option = node?.response?.options?.find((item) => item.id === selectionId);
  if (!option) return false;

  context.conversation.botState.variables.set(`${node.nodeId}_selectionId`, option.id);
  context.conversation.botState.variables.set(`${node.nodeId}_selectionTitle`, option.title);
  context.conversation.botState.variables.set(`${node.nodeId}_value`, option.value ?? option.title);
  context.conversation.botState.currentNodeId = option.nextNodeId || node.nextNodeId || null;
  return true;
}

export async function startFlow({ flow, business, account, contact, conversation, event }) {
  conversation.status = "bot_handling";
  conversation.botState.active = true;
  conversation.botState.flowId = flow._id;
  conversation.botState.flowVersion = flow.version;
  conversation.botState.currentNodeId = flow.startNodeId;
  conversation.botState.awaitingInput = null;
  conversation.botState.variables = new Map();
  conversation.botState.startedAt = new Date();
  conversation.botState.updatedAt = new Date();
  await conversation.save();

  return continueFlow({ flow, business, account, contact, conversation, event });
}

export async function continueActiveFlow({ business, account, contact, conversation, event }) {
  if (!conversation.botState?.active || !conversation.botState?.flowId) return { handled: false };

  const flow = await AutomationFlow.findOne({
    _id: conversation.botState.flowId,
    businessId: business._id,
    status: "published",
  });

  if (!flow) {
    conversation.botState.active = false;
    conversation.botState.awaitingInput = null;
    await conversation.save();
    return { handled: false };
  }

  return continueFlow({ flow, business, account, contact, conversation, event });
}

export async function continueFlow({ flow, business, account, contact, conversation, event }) {
  const context = { flow, business, account, contact, conversation, event };

  const waitingHandled = await processWaitingInput(flow, context);
  if (waitingHandled) {
    conversation.botState.updatedAt = new Date();
    await conversation.save();
    return { handled: true, action: "asked_question", flow };
  }

  await processOptionSelection(flow, context);

  for (let step = 0; step < MAX_NODE_STEPS; step += 1) {
    const currentNodeId = conversation.botState.currentNodeId;

    if (!currentNodeId) {
      conversation.botState.active = false;
      conversation.status = conversation.status === "human_needed" ? "human_needed" : "open";
      break;
    }

    const node = flow.nodes.find((item) => item.nodeId === currentNodeId);
    if (!node) throw new Error(`Flow node ${currentNodeId} was not found.`);

    const variables = buildVariables(context);

    if (node.type === "message") {
      const response = renderResponse(node.response, variables);
      await sendAndSaveMessage({ account, contact, conversation, response, senderType: "bot" });

      if (["buttons", "list"].includes(response.type) && response.options?.length) {
        conversation.botState.currentNodeId = node.nodeId;
        conversation.botState.updatedAt = new Date();
        await conversation.save();
        return { handled: true, action: "sent_reply", flow };
      }

      conversation.botState.currentNodeId = node.nextNodeId || null;
      continue;
    }

    if (node.type === "question") {
      const response = renderResponse(node.response, variables);
      await sendAndSaveMessage({ account, contact, conversation, response, senderType: "bot" });

      conversation.botState.currentNodeId = node.nodeId;
      conversation.botState.awaitingInput = {
        nodeId: node.nodeId,
        fieldKey: node.question?.fieldKey,
        saveTo: node.question?.saveTo || "session",
        validation: node.question?.validation || {},
        nextNodeId: node.nextNodeId || "",
      };
      conversation.botState.updatedAt = new Date();
      await conversation.save();
      return { handled: true, action: "asked_question", flow };
    }

    if (node.type === "condition") {
      const session = mapToObject(conversation.botState.variables);
      let lead = {};
      let booking = {};

      if (node.condition?.source === "lead" && session._leadId) {
        lead = (await Lead.findOne({ _id: session._leadId, businessId: business._id }))?.toObject() || {};
      }
      if (node.condition?.source === "booking" && session._bookingId) {
        booking = (await Booking.findOne({ _id: session._bookingId, businessId: business._id }))?.toObject() || {};
      }

      const sources = {
        session,
        contact: contact.toObject(),
        message: variables.message,
        lead,
        booking,
      };
      const actual = getByPath(sources[node.condition?.source] || {}, node.condition?.fieldKey);
      const passed = compareValue(actual, node.condition?.operator, node.condition?.value);
      conversation.botState.currentNodeId = passed
        ? node.condition?.trueNodeId
        : node.condition?.falseNodeId;
      continue;
    }

    if (node.type === "action") {
      await executeAction(node, context);
      conversation.botState.currentNodeId = node.nextNodeId || null;
      continue;
    }

    if (node.type === "handoff") {
      await createHandoff({
        business,
        contact,
        conversation,
        account,
        reason: node.handoff?.reason || "flow_requested_handoff",
        message: interpolate(node.handoff?.message || business.settings.handoffMessage, variables),
      });
      return { handled: true, action: "handoff", flow };
    }

    if (node.type === "end") {
      if (node.response?.text || node.response?.mediaUrl) {
        await sendAndSaveMessage({
          account,
          contact,
          conversation,
          response: renderResponse(node.response, variables),
          senderType: "bot",
        });
      }
      conversation.botState.active = false;
      conversation.botState.currentNodeId = null;
      conversation.botState.awaitingInput = null;
      conversation.status = "open";
      break;
    }
  }

  conversation.botState.updatedAt = new Date();
  await conversation.save();
  return { handled: true, action: "continued_flow", flow };
}
