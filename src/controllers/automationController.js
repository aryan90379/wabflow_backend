import {
  AutomationFlow,
  AutomationRule,
  BotKnowledge,
  ServiceItem,
} from "../models/index.js";
import { validateFlowDefinition } from "../utils/flowValidation.js";

function cleanUpdate(body, blocked = []) {
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !["_id", "businessId", "createdAt", "updatedAt", ...blocked].includes(key))
  );
}

function normalizeFlowPayload(body = {}) {
  const actionAliases = {
    add_tag: "add_contact_tag",
    close_chat: "close_conversation",
  };

  return {
    ...body,
    nodes: Array.isArray(body.nodes)
      ? body.nodes.map((node) => ({
          ...node,
          question: node.question
            ? {
                ...node.question,
                saveTo: node.question.saveTo === "variables" ? "session" : node.question.saveTo,
              }
            : node.question,
          action: node.action
            ? {
                ...node.action,
                actionType: actionAliases[node.action.actionType] || node.action.actionType,
              }
            : node.action,
        }))
      : body.nodes,
  };
}

async function findOwned(Model, req, idParam) {
  return Model.findOne({ _id: req.params[idParam], businessId: req.business._id });
}

export async function listKnowledge(req, res) {
  const items = await BotKnowledge.find({ businessId: req.business._id }).sort({ priority: -1, createdAt: -1 });
  return res.json({ success: true, items, data: items, total: items.length, page: 1, limit: items.length });
}

export async function createKnowledge(req, res) {
  const item = await BotKnowledge.create({ businessId: req.business._id, ...cleanUpdate(req.body) });
  return res.status(201).json({ success: true, item, data: item });
}

export async function updateKnowledge(req, res) {
  const item = await findOwned(BotKnowledge, req, "knowledgeId");
  if (!item) return res.status(404).json({ success: false, error: "Knowledge item not found." });
  item.set(cleanUpdate(req.body));
  await item.save();
  return res.json({ success: true, item, data: item });
}

export async function deleteKnowledge(req, res) {
  const item = await BotKnowledge.findOneAndDelete({ _id: req.params.knowledgeId, businessId: req.business._id });
  if (!item) return res.status(404).json({ success: false, error: "Knowledge item not found." });
  return res.json({ success: true });
}

export async function listServices(req, res) {
  const items = await ServiceItem.find({ businessId: req.business._id }).sort({ active: -1, createdAt: -1 });
  return res.json({ success: true, items, data: items, total: items.length, page: 1, limit: items.length });
}

export async function createService(req, res) {
  const item = await ServiceItem.create({ businessId: req.business._id, ...cleanUpdate(req.body) });
  return res.status(201).json({ success: true, item, data: item });
}

export async function updateService(req, res) {
  const item = await findOwned(ServiceItem, req, "serviceId");
  if (!item) return res.status(404).json({ success: false, error: "Service item not found." });
  item.set(cleanUpdate(req.body));
  await item.save();
  return res.json({ success: true, item, data: item });
}

export async function deleteService(req, res) {
  const item = await ServiceItem.findOneAndDelete({ _id: req.params.serviceId, businessId: req.business._id });
  if (!item) return res.status(404).json({ success: false, error: "Service item not found." });
  return res.json({ success: true });
}

export async function listRules(req, res) {
  const rules = await AutomationRule.find({ businessId: req.business._id }).sort({ priority: -1, createdAt: -1 });
  return res.json({ success: true, rules, data: rules, total: rules.length, page: 1, limit: rules.length });
}

export async function createRule(req, res) {
  const rule = await AutomationRule.create({ businessId: req.business._id, ...cleanUpdate(req.body) });
  return res.status(201).json({ success: true, rule, data: rule });
}

export async function updateRule(req, res) {
  const rule = await findOwned(AutomationRule, req, "ruleId");
  if (!rule) return res.status(404).json({ success: false, error: "Automation rule not found." });
  rule.set(cleanUpdate(req.body));
  await rule.save();
  return res.json({ success: true, rule, data: rule });
}

export async function deleteRule(req, res) {
  const rule = await AutomationRule.findOneAndDelete({ _id: req.params.ruleId, businessId: req.business._id });
  if (!rule) return res.status(404).json({ success: false, error: "Automation rule not found." });
  return res.json({ success: true });
}

export async function listFlows(req, res) {
  const flows = await AutomationFlow.find({ businessId: req.business._id }).sort({ updatedAt: -1 });
  return res.json({ success: true, flows, data: flows, total: flows.length, page: 1, limit: flows.length });
}

export async function getFlow(req, res) {
  const flow = await findOwned(AutomationFlow, req, "flowId");
  if (!flow) return res.status(404).json({ success: false, error: "Flow not found." });
  return res.json({ success: true, flow, data: flow });
}

export async function createFlow(req, res) {
  const body = normalizeFlowPayload(req.body);
  const errors = validateFlowDefinition(body);
  if (errors.length) return res.status(400).json({ success: false, error: "Invalid flow.", details: errors });

  const flow = await AutomationFlow.create({
    businessId: req.business._id,
    name: body.name,
    description: body.description || "",
    whatsappAccountId: body.whatsappAccountId || null,
    isDefault: Boolean(body.isDefault),
    trigger: body.trigger || { type: "manual" },
    startNodeId: body.startNodeId,
    nodes: body.nodes,
    status: "draft",
  });

  return res.status(201).json({ success: true, flow, data: flow });
}

export async function updateFlow(req, res) {
  const flow = await findOwned(AutomationFlow, req, "flowId");
  if (!flow) return res.status(404).json({ success: false, error: "Flow not found." });

  if (flow.status === "published") {
    return res.status(409).json({
      success: false,
      error: "Published flows are immutable. Create a new draft version before editing.",
    });
  }

  const body = normalizeFlowPayload(req.body);
  const next = {
    startNodeId: body.startNodeId ?? flow.startNodeId,
    nodes: body.nodes ?? flow.nodes.map((node) => node.toObject()),
  };
  const errors = validateFlowDefinition(next);
  if (errors.length) return res.status(400).json({ success: false, error: "Invalid flow.", details: errors });

  flow.set(cleanUpdate(body, ["status", "version", "publishedAt", "publishedBy"]));
  flow.status = "draft";
  flow.version += 1;
  await flow.save();

  return res.json({ success: true, flow, data: flow });
}

export async function publishFlow(req, res) {
  const flow = await findOwned(AutomationFlow, req, "flowId");
  if (!flow) return res.status(404).json({ success: false, error: "Flow not found." });

  const errors = validateFlowDefinition(flow.toObject());
  if (errors.length) return res.status(400).json({ success: false, error: "Invalid flow.", details: errors });

  const shouldBeDefault = req.body.isDefault ?? flow.isDefault;
  if (shouldBeDefault) {
    await AutomationFlow.updateMany(
      { businessId: req.business._id, _id: { $ne: flow._id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }

  flow.status = "published";
  flow.isDefault = Boolean(shouldBeDefault);
  flow.publishedAt = new Date();
  flow.publishedBy = req.userId;
  await flow.save();

  return res.json({ success: true, flow, data: flow });
}

export async function archiveFlow(req, res) {
  const flow = await findOwned(AutomationFlow, req, "flowId");
  if (!flow) return res.status(404).json({ success: false, error: "Flow not found." });
  flow.status = "archived";
  flow.isDefault = false;
  await flow.save();
  return res.json({ success: true, flow, data: flow });
}
