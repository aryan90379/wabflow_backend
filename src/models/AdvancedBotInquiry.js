import mongoose from "mongoose";

const advancedBotInquirySchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requesterType: {
      type: String,
      enum: ["individual", "company"],
      required: true,
    },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    whatsappNumber: { type: String, required: true, trim: true },
    companyName: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, default: "" },
    website: { type: String, trim: true, default: "" },
    purpose: { type: String, required: true, trim: true },
    capabilities: [{ type: String, trim: true }],
    timeline: { type: String, trim: true, default: "" },
    budgetRange: { type: String, trim: true, default: "" },
    preferredContactTime: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "closed"],
      default: "new",
      index: true,
    },
    internalNotes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

advancedBotInquirySchema.index({ createdAt: -1 });

export const AdvancedBotInquiry =
  mongoose.models.AdvancedBotInquiry ||
  mongoose.model("AdvancedBotInquiry", advancedBotInquirySchema);
