import {
  AutomationFlow,
  AutomationRule,
  BotKnowledge,
  ServiceItem,
} from "../models/index.js";
import { deleteFromBunny, fileNameFromUrl, uploadToBunny } from "../services/bunnyStorage.js";
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
    steps: body.steps,
    entryStepId: body.entryStepId,
  };
}

function pruneFlowToReachableSteps(flowData = {}) {
  const steps = Array.isArray(flowData.steps) ? flowData.steps : [];
  const entryStepId = flowData.entryStepId || steps[0]?.id;
  if (flowData.version < 2 && !steps.length) return flowData;
  if (!entryStepId || !steps.length) return flowData;

  const stepById = new Map(steps.map((step) => [step.id, step]));
  const reachable = new Set();
  const pending = [entryStepId];

  while (pending.length) {
    const stepId = pending.pop();
    if (!stepId || reachable.has(stepId)) continue;

    const step = stepById.get(stepId);
    if (!step) continue;

    reachable.add(stepId);
    if (step.config?.nextStepId) pending.push(step.config.nextStepId);
    for (const button of step.config?.buttons || []) {
      if (button.action?.targetStepId) pending.push(button.action.targetStepId);
    }
  }

  return {
    ...flowData,
    entryStepId,
    steps: steps
      .filter((step) => reachable.has(step.id))
      .map((step) => ({
        ...step,
        config: {
          ...(step.config || {}),
          buttons: (step.config?.buttons || []).filter(
            (button) => !button.action?.targetStepId || reachable.has(button.action.targetStepId)
          ),
        },
      })),
  };
}

async function findOwned(Model, req, idParam) {
  return Model.findOne({ _id: req.params[idParam], businessId: req.business._id });
}

function decodeBase64File(fileBase64 = "") {
  const input = String(fileBase64 || "");
  const [, dataUrlPayload] = input.match(/^data:[^;]+;base64,(.+)$/) || [];
  const payload = dataUrlPayload || input;
  return Buffer.from(payload, "base64");
}

function safeUploadFileName(fileName = "upload.bin") {
  const baseName = String(fileName || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "-");
  return `${Date.now()}-${baseName}`;
}

async function uploadRequestFile(req, folder) {
  const buffer = req.body.fileBuffer
    ? Buffer.from(req.body.fileBuffer)
    : decodeBase64File(req.body.fileBase64);

  if (!buffer.length) {
    const error = new Error("fileBase64 is required.");
    error.status = 400;
    throw error;
  }

  if (buffer.length > 8 * 1024 * 1024) {
    const error = new Error("Image is too large. Please upload a file under 8 MB.");
    error.status = 413;
    throw error;
  }

  return uploadToBunny(
    buffer,
    safeUploadFileName(req.body.fileName),
    folder
  );
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

export async function uploadMedia(req, res) {
  const folder = req.body.folder || `businesses/${req.business._id}/uploads`;
  const url = await uploadRequestFile(req, folder);
  return res.status(201).json({ success: true, url, data: { url } });
}

export async function uploadServiceImage(req, res) {
  const item = await findOwned(ServiceItem, req, "serviceId");
  if (!item) return res.status(404).json({ success: false, error: "Service item not found." });

  const folder = `businesses/${req.business._id}/services/${item._id}`;
  const url = await uploadRequestFile(req, folder);
  item.images = [...(item.images || []), url];
  await item.save();

  return res.status(201).json({ success: true, url, item, data: item });
}

export async function removeServiceImage(req, res) {
  const item = await findOwned(ServiceItem, req, "serviceId");
  if (!item) return res.status(404).json({ success: false, error: "Service item not found." });

  const imageUrl = String(req.body.url || "");
  item.images = (item.images || []).filter((url) => url !== imageUrl);
  await item.save();

  if (imageUrl && process.env.BUNNY_STORAGE_ZONE && process.env.BUNNY_API_KEY) {
    await deleteFromBunny(fileNameFromUrl(imageUrl), `businesses/${req.business._id}/services/${item._id}`);
  }

  return res.json({ success: true, item, data: item });
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
    entryStepId: body.entryStepId,
    steps: body.steps,
    status: "draft",
    version: body.steps && body.steps.length > 0 ? 2 : 1,
  });

  return res.status(201).json({ success: true, flow, data: flow });
}

export async function updateFlow(req, res) {
  const flow = await findOwned(AutomationFlow, req, "flowId");
  if (!flow) return res.status(404).json({ success: false, error: "Flow not found." });

  const body = normalizeFlowPayload(req.body);
  
  const isV2 = body.steps && body.steps.length > 0;
  
  const next = isV2 ? pruneFlowToReachableSteps({
    entryStepId: body.entryStepId ?? flow.entryStepId,
    steps: body.steps ?? flow.steps,
    version: flow.version >= 2 ? flow.version : 2
  }) : {
    startNodeId: body.startNodeId ?? flow.startNodeId,
    nodes: body.nodes ?? flow.nodes.map((node) => node.toObject()),
    version: flow.version
  };

  const errors = validateFlowDefinition({ ...flow.toObject(), ...next });
  if (errors.length) return res.status(400).json({ success: false, error: "Invalid flow.", details: errors });

  flow.set(cleanUpdate({ ...body, ...next }, ["status", "version", "publishedAt", "publishedBy"]));
  flow.version = next.version > flow.version ? next.version : flow.version + 1;
  await flow.save();

  return res.json({ success: true, flow, data: flow });
}

export async function publishFlow(req, res) {
  const flow = await findOwned(AutomationFlow, req, "flowId");
  if (!flow) return res.status(404).json({ success: false, error: "Flow not found." });

  const publishableFlow = pruneFlowToReachableSteps(flow.toObject());
  const errors = validateFlowDefinition(publishableFlow, { mode: "publish" });
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
  if (publishableFlow.entryStepId) flow.entryStepId = publishableFlow.entryStepId;
  if (Array.isArray(publishableFlow.steps)) flow.steps = publishableFlow.steps;
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
