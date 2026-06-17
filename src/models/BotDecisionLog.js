import mongoose from "mongoose";

const botDecisionLogSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", required: true, index: true },
    detectedIntent: { type: String, default: "unknown" },
    confidence: { type: Number, default: 0 },
    matchedRuleId: { type: mongoose.Schema.Types.ObjectId, ref: "AutomationRule", default: null },
    matchedFlowId: { type: mongoose.Schema.Types.ObjectId, ref: "AutomationFlow", default: null },
    matchedKnowledgeId: { type: mongoose.Schema.Types.ObjectId, ref: "BotKnowledge", default: null },
    actionTaken: {
      type: String,
      enum: [
        "sent_reply",
        "asked_question",
        "started_flow",
        "continued_flow",
        "created_lead",
        "created_booking",
        "handoff",
        "ignored",
        "error",
        "bot_resumed",
        "bot_resumed_started_flow",
        "sent_meta_flow",
        "send_booking_meta_flow",
        "sent_booking_flow",
        "sent_fallback",
      ],
      default: "sent_reply",
    },
    aiReply: { type: String, default: "" },
    error: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

botDecisionLogSchema.index({ businessId: 1, createdAt: -1 });

export const BotDecisionLog =
  mongoose.models.BotDecisionLog || mongoose.model("BotDecisionLog", botDecisionLogSchema);
