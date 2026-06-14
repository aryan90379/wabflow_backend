import mongoose from "mongoose";

const responseSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["text", "buttons", "list", "image", "catalog", "start_flow", "handoff"],
      default: "text",
    },
    text: { type: String, default: "" },
    header: { type: String, default: "" },
    footer: { type: String, default: "" },
    mediaUrl: { type: String, default: "" },
    flowId: { type: mongoose.Schema.Types.ObjectId, ref: "AutomationFlow", default: null },
    buttons: [
      {
        id: String,
        title: String,
        _id: false,
      },
    ],
    list: {
      buttonText: { type: String, default: "View options" },
      sections: { type: mongoose.Schema.Types.Mixed, default: [] },
    },
  },
  { _id: false }
);

const automationRuleSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    name: { type: String, required: true, trim: true },
    triggerType: {
      type: String,
      enum: ["keyword", "intent", "first_message", "away_hours", "any_message"],
      default: "keyword",
      index: true,
    },
    matchMode: { type: String, enum: ["any", "all", "exact", "contains"], default: "any" },
    keywords: [{ type: String, lowercase: true, trim: true }],
    intent: { type: String, default: "" },
    response: { type: responseSchema, default: () => ({}) },
    priority: { type: Number, default: 0, index: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

automationRuleSchema.index({ businessId: 1, active: 1, priority: -1 });

export const AutomationRule =
  mongoose.models.AutomationRule || mongoose.model("AutomationRule", automationRuleSchema);
