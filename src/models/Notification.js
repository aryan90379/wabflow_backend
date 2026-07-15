import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", required: true, index: true },
    type: { 
      type: String, 
      enum: ["NEW_CHAT", "NEW_MESSAGE", "NEW_LEAD", "NEW_BOOKING", "HUMAN_HANDOFF", "TASK_REMINDER", "CAMPAIGN_UPDATE", "SYSTEM"],
      required: true 
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} }, // Custom data like chatId, leadId, etc.
    status: {
      type: String,
      enum: ["pending", "processing", "sent", "failed"],
      default: "pending",
      index: true
    },
    error: { type: String }, // To store error message if failed
    isRead: { type: Boolean, default: false },
    readAt: { type: Date }
  },
  { timestamps: true }
);

export const Notification = mongoose.models.Notification || mongoose.model("Notification", notificationSchema);
