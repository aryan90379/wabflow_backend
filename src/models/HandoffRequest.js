import mongoose from "mongoose";

const handoffRequestSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    reason: { type: String, default: "customer_requested_human" },
    status: { type: String, enum: ["open", "assigned", "resolved"], default: "open", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

handoffRequestSchema.index({ businessId: 1, status: 1, createdAt: -1 });

export const HandoffRequest =
  mongoose.models.HandoffRequest || mongoose.model("HandoffRequest", handoffRequestSchema);
