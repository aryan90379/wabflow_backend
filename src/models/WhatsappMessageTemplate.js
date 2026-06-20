import mongoose from "mongoose";

const templateButtonSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    title: { type: String, required: true, trim: true, maxlength: 25 },
  },
  { _id: false }
);

const whatsappMessageTemplateSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    whatsappAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsappAccount",
      required: true,
      index: true,
    },
    wabaId: { type: String, required: true, index: true },
    metaTemplateId: { type: String, default: "", index: true },
    name: { type: String, required: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["MARKETING", "UTILITY"],
      default: "MARKETING",
    },
    language: { type: String, default: "en_US" },
    body: { type: String, required: true, trim: true, maxlength: 1024 },
    footer: { type: String, default: "", trim: true, maxlength: 60 },
    headerType: {
      type: String,
      enum: ["NONE", "IMAGE"],
      default: "NONE",
    },
    headerImageUrl: { type: String, default: "", trim: true },
    buttons: { type: [templateButtonSchema], default: [] },
    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected", "paused", "disabled", "unknown"],
      default: "draft",
      index: true,
    },
    rejectionReason: { type: String, default: "" },
    lastSubmittedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

whatsappMessageTemplateSchema.index({ businessId: 1, name: 1 }, { unique: true });
whatsappMessageTemplateSchema.index({ businessId: 1, status: 1, updatedAt: -1 });

export const WhatsappMessageTemplate =
  mongoose.models.WhatsappMessageTemplate ||
  mongoose.model("WhatsappMessageTemplate", whatsappMessageTemplateSchema);
