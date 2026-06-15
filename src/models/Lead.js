import mongoose from "mongoose";

const leadSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    source: { type: String, default: "whatsapp" },
    intent: { type: String, default: "enquiry", index: true },
    score: { type: Number, min: 0, max: 100, default: 20 },
    status: {
      type: String,
      enum: ["new", "contacted", "interested", "booked", "won", "lost"],
      default: "new",
      index: true,
    },
    requirement: { type: String, default: "" },
    budget: { type: mongoose.Schema.Types.Mixed, default: null },
    preferredDate: { type: String, default: "" },
    preferredTime: { type: String, default: "" },
    city: { type: String, default: "" },
    updatedByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    updatedByName: { type: String, default: "" },
    metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

leadSchema.index({ businessId: 1, status: 1, createdAt: -1 });

export const Lead = mongoose.models.Lead || mongoose.model("Lead", leadSchema);
