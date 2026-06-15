import mongoose from "mongoose";

const lastMessageSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    type: { type: String, default: "text" },
    direction: { type: String, enum: ["inbound", "outbound"], default: "inbound" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const awaitingInputSchema = new mongoose.Schema(
  {
    nodeId: String,
    fieldKey: String,
    saveTo: { type: String, default: "session" },
    validation: { type: mongoose.Schema.Types.Mixed, default: {} },
    nextNodeId: String,
  },
  { _id: false }
);

const botStateSchema = new mongoose.Schema(
  {
    active: { type: Boolean, default: false },
    flowId: { type: mongoose.Schema.Types.ObjectId, ref: "AutomationFlow", default: null },
    flowVersion: { type: Number, default: null },
    currentNodeId: { type: String, default: null },
    awaitingInput: { type: awaitingInputSchema, default: null },
    variables: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    startedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    whatsappAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappAccount",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "bot_handling", "human_needed", "closed"],
      default: "open",
      index: true,
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignedToMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    assignedToName: { type: String, default: "" },
    humanTakeoverByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    automationPausedByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    automationPausedAt: { type: Date, default: null },
    automationResumeByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    lastHandledByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    lastHandledByName: { type: String, default: "" },
    closedByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    closedAt: { type: Date, default: null },
    lastMessage: { type: lastMessageSchema, default: () => ({}) },
    unreadCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    botState: { type: botStateSchema, default: () => ({}) },
  },
  { timestamps: true }
);

conversationSchema.index({ whatsappAccountId: 1, contactId: 1 }, { unique: true });
conversationSchema.index({ businessId: 1, status: 1, lastMessageAt: -1 });

export const Conversation =
  mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
