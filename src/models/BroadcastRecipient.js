import mongoose from "mongoose";

const broadcastRecipientSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    broadcastJobId: { type: mongoose.Schema.Types.ObjectId, ref: "BroadcastJob", required: true, index: true },
    index: { type: Number, required: true },
    phoneRaw: { type: String, default: "" },
    phone: { type: String, required: true },
    customerName: { type: String, default: "" },
    status: {
      type: String,
      enum: ["queued", "sending", "sent", "failed", "skipped"],
      default: "queued",
      index: true,
    },
    error: { type: String, default: "" },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    sentAt: Date,
  },
  { timestamps: true }
);

broadcastRecipientSchema.index({ broadcastJobId: 1, index: 1 });
broadcastRecipientSchema.index({ broadcastJobId: 1, status: 1, index: 1 });
broadcastRecipientSchema.index({ broadcastJobId: 1, phone: 1 }, { unique: true });

export const BroadcastRecipient =
  mongoose.models.BroadcastRecipient ||
  mongoose.model("BroadcastRecipient", broadcastRecipientSchema);
