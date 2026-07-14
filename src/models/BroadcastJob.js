import mongoose from "mongoose";

const broadcastJobSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsappMessageTemplate", required: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsappAccount", required: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember" },
    name: { type: String, default: "Broadcast" },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed", "cancelled"],
      default: "queued",
      index: true,
    },
    defaultCountryCode: { type: String, default: "91" },
    totalCount: { type: Number, default: 0 },
    queuedCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    templateCategory: {
      type: String,
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
      default: "MARKETING",
    },
    pricingMarket: { type: String, default: "India" },
    pricingCurrency: { type: String, default: "INR" },
    ratePerMessage: { type: Number, default: 0 },
    estimatedCost: { type: Number, default: 0 },
    pricedRecipientCount: { type: Number, default: 0 },
    unpricedRecipientCount: { type: Number, default: 0 },
    pricingVersion: { type: String, default: "" },
    currentPhone: { type: String, default: "" },
    error: { type: String, default: "" },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

broadcastJobSchema.index({ businessId: 1, createdAt: -1 });

export const BroadcastJob =
  mongoose.models.BroadcastJob || mongoose.model("BroadcastJob", broadcastJobSchema);
