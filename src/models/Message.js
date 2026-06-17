import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    whatsappAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappAccount",
      required: true,
      index: true,
    },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    senderType: { type: String, enum: ["customer", "bot", "human", "owner", "staff"], required: true },
    sentByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sentByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    sentByName: { type: String, default: "" },
    sentByAvatarUrl: { type: String, default: "" },
    type: {
      type: String,
      enum: ["text", "image", "video", "audio", "document", "button", "list", "flow", "flow_reply", "location", "unknown"],
      default: "text",
    },
    text: { type: String, default: "" },
    interactive: {
      id: { type: String, default: "" },
      title: { type: String, default: "" },
    },
    media: {
      id: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      filename: { type: String, default: "" },
      caption: { type: String, default: "" },
    },
    mediaUrl: { type: String, default: "" },
    whatsappMessageId: { type: String, sparse: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["received", "queued", "sent", "delivered", "read", "failed"],
      default: "received",
      index: true,
    },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
    rawWebhookEventId: { type: String, default: "" },
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ businessId: 1, createdAt: -1 });

export const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);
