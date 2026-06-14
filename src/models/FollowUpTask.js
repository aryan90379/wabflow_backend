import mongoose from "mongoose";

const followUpTaskSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    type: { type: String, default: "lead_followup" },
    message: { type: String, required: true },
    scheduledAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ["pending", "processing", "sent", "cancelled", "failed"], default: "pending", index: true },
    sentAt: { type: Date, default: null },
    error: { type: String, default: "" },
  },
  { timestamps: true }
);

followUpTaskSchema.index({ status: 1, scheduledAt: 1 });

export const FollowUpTask =
  mongoose.models.FollowUpTask || mongoose.model("FollowUpTask", followUpTaskSchema);
