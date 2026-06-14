import mongoose from "mongoose";

const optionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    nextNodeId: { type: String, default: "" },
  },
  { _id: false }
);

const responseSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["text", "buttons", "list", "image", "video", "document"],
      default: "text",
    },
    text: { type: String, default: "" },
    header: { type: String, default: "" },
    footer: { type: String, default: "" },
    mediaUrl: { type: String, default: "" },
    filename: { type: String, default: "" },
    buttonText: { type: String, default: "View options" },
    options: { type: [optionSchema], default: [] },
  },
  { _id: false }
);

const nodeSchema = new mongoose.Schema(
  {
    nodeId: { type: String, required: true },
    name: { type: String, default: "" },
    type: {
      type: String,
      enum: ["message", "question", "condition", "action", "handoff", "end"],
      required: true,
    },
    response: { type: responseSchema, default: null },
    nextNodeId: { type: String, default: "" },
    question: {
      fieldKey: { type: String, default: "" },
      saveTo: {
        type: String,
        enum: ["session", "variables", "contact", "lead", "booking"],
        default: "session",
      },
      validation: { type: mongoose.Schema.Types.Mixed, default: {} },
      retryText: { type: String, default: "Please enter a valid value." },
    },
    condition: {
      source: { type: String, enum: ["session", "contact", "message", "lead", "booking"], default: "session" },
      fieldKey: { type: String, default: "" },
      operator: {
        type: String,
        enum: ["equals", "not_equals", "contains", "exists", "gt", "gte", "lt", "lte"],
        default: "equals",
      },
      value: { type: mongoose.Schema.Types.Mixed, default: null },
      trueNodeId: { type: String, default: "" },
      falseNodeId: { type: String, default: "" },
    },
    action: {
      actionType: {
        type: String,
        enum: [
          "set_variable",
          "add_contact_tag",
          "add_tag",
          "remove_contact_tag",
          "create_lead",
          "update_lead",
          "create_booking",
          "update_booking",
          "close_conversation",
          "close_chat",
        ],
        default: "set_variable",
      },
      config: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    handoff: {
      reason: { type: String, default: "flow_requested_handoff" },
      message: { type: String, default: "A team member will reply here shortly." },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const automationFlowSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    whatsappAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappAccount",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },
    isDefault: { type: Boolean, default: false, index: true },
    version: { type: Number, default: 1 },
    trigger: {
      type: {
        type: String,
        enum: ["first_message", "keyword", "intent", "manual", "any_message"],
        default: "manual",
      },
      keywords: [{ type: String, lowercase: true, trim: true }],
      intent: { type: String, default: "" },
      matchMode: { type: String, enum: ["any", "all", "exact", "contains"], default: "any" },
    },
    startNodeId: { type: String, required: true },
    nodes: { type: [nodeSchema], default: [] },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

automationFlowSchema.index({ businessId: 1, status: 1, isDefault: 1 });

export const AutomationFlow =
  mongoose.models.AutomationFlow || mongoose.model("AutomationFlow", automationFlowSchema);
