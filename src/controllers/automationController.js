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

async function findOwned(Model, req, idParam) {
  return Model.findOne({ _id: req.params[idParam], businessId: req.business._id });
}

export async function listKnowledge(req, res) {
  const items = await BotKnowledge.find({ businessId: req.business._id }).sort({ priority: -1, createdAt: -1 });
  return res.json({ success: true, items });
}

export async function createKnowledge(req, res) {
  const item = await BotKnowledge.create({ businessId: req.business._id, ...cleanUpdate(req.body) });
  return res.status(201).json({ success: true, item });
}

export async function updateKnowledge(req, res) {
  const item = await findOwned(BotKnowledge, req, "knowledgeId");
  if (!item) return res.status(404).json({ success: false, error: "Knowledge item not found." });
  item.set(cleanUpdate(req.body));
  await item.save();
  return res.json({ success: true, item });
}

export async function deleteKnowledge(req, res) {
  const item = await BotKnowledge.findOneAndDelete({ _id: req.params.knowledgeId, businessId: req.business._id });
  if (!item) return res.status(404).json({ success: false, error: "Knowledge item not found." });
  return res.json({ success: true });
}

export async function listServices(req, res) {
  const items = await ServiceItem.find({ businessId: req.business._id }).sort({ active: -1, createdAt: -1 });
  return res.json({ success: true, items });
}

export async function createService(req, res) {
  const item = await ServiceItem.create({ businessId: req.business._id, ...cleanUpdate(req.body) });
  return res.status(201).json({ success: true, item });
}

export async function updateService(req, res) {
  const item = await findOwned(ServiceItem, req, "serviceId");
  if (!item) return res.status(404).json({ success: false, error: "Service item not found." });
  item.set(cleanUpdate(req.body));
  await item.save();
  return res.json({ success: true, item });
}

export async function deleteService(req, res) {
  const item = await ServiceItem.findOneAndDelete({ _id: req.params.serviceId, businessId: req.business._id });
  if (!item) return res.status(404).json({ success: false, error: "Service item not found." });
  return res.json({ success: true });
}

export async function listRules(req, res) {
  const rules = await AutomationRule.find({ businessId: req.business._id }).sort({ priority: -1, createdAt: -1 });
  return res.json({ success: true, rules });
}

export async function createRule(req, res) {
  const rule = await AutomationRule.create({ businessId: req.business._id, ...cleanUpdate(req.body) });
  return res.status(201).json({ success: true, rule });
}

export async function updateRule(req, res) {
  const rule = await findOwned(AutomationRule, req, "ruleId");
  if (!rule) return res.status(404).json({ success: false, error: "Automation rule not found." });
  rule.set(cleanUpdate(req.body));
  await rule.save();
  return res.json({ success: true, rule });
}

export async function deleteRule(req, res) {
  const rule = await AutomationRule.findOneAndDelete({ _id: req.params.ruleId, businessId: req.business._id });
  if (!rule) return res.status(404).json({ success: false, error: "Automation rule not found." });
  return res.json({ success: true });
}

export async function listFlows(req, res) {
  const flows = await AutomationFlow.find({ businessId: req.business._id }).sort({ updatedAt: -1 });
  return res.json({ success: true, flows });
}

export async function getFlow(req, res) {
  const flow = await findOwned(AutomationFlow, req, "flowId");
  if (!flow) return res.status(404).json({ success: false, error: "Flow not found." });
  return res.json({ success: true, flow });
}

export async function createFlow(req, res) {
  const errors = validateFlowDefinition(req.body);
  if (errors.length) return res.status(400).json({ success: false, error: "Invalid flow.", details: errors });

  const flow = await AutomationFlow.create({
    businessId: req.business._id,
    name: req.body.name,
    description: req.body.description || "",
    whatsappAccountId: req.body.whatsappAccountId || null,
    isDefault: Boolean(req.body.isDefault),
    trigger: req.body.trigger || { type: "manual" },
    startNodeId: req.body.startNodeId,
    nodes: req.body.nodes,
    status: "draft",
  });

  return res.status(201).json({ success: true, flow });
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

  const next = {
    startNodeId: req.body.startNodeId ?? flow.startNodeId,
    nodes: req.body.nodes ?? flow.nodes.map((node) => node.toObject()),
  };
  const errors = validateFlowDefinition(next);
  if (errors.length) return res.status(400).json({ success: false, error: "Invalid flow.", details: errors });

  flow.set(cleanUpdate(req.body, ["status", "version", "publishedAt", "publishedBy"]));
  flow.status = "draft";
  flow.version += 1;
  await flow.save();

  return res.json({ success: true, flow });
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

  return res.json({ success: true, flow });
}

export async function archiveFlow(req, res) {
  const flow = await findOwned(AutomationFlow, req, "flowId");
  if (!flow) return res.status(404).json({ success: false, error: "Flow not found." });
  flow.status = "archived";
  flow.isDefault = false;
  await flow.save();
  return res.json({ success: true, flow });
}
