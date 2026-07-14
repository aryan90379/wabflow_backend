import mongoose from "mongoose";

const templateButtonSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    title: { type: String, required: true, trim: true, maxlength: 25 },
    type: {
      type: String,
      enum: ["QUICK_REPLY", "URL", "PHONE_NUMBER"],
      default: "QUICK_REPLY",
    },
    url: { type: String, default: "", trim: true },
    phoneNumber: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const carouselCardSchema = new mongoose.Schema(
  {
    mediaType: { type: String, enum: ["IMAGE", "VIDEO"], default: "IMAGE" },
    mediaUrl: { type: String, required: true, trim: true },
    body: { type: String, default: "", trim: true, maxlength: 160 },
    buttons: { type: [templateButtonSchema], default: [] },
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
    format: {
      type: String,
      enum: ["STANDARD", "CAROUSEL"],
      default: "STANDARD",
    },
    category: {
      type: String,
      enum: ["MARKETING", "UTILITY", "AUTHENTICATION"],
      default: "MARKETING",
    },
    language: { type: String, default: "en_US" },
    body: { type: String, required: true, trim: true, maxlength: 1024 },
    footer: { type: String, default: "", trim: true, maxlength: 60 },
    headerType: {
      type: String,
      enum: ["NONE", "IMAGE", "VIDEO", "DOCUMENT"],
      default: "NONE",
    },
    headerImageUrl: { type: String, default: "", trim: true },
    buttons: { type: [templateButtonSchema], default: [] },
    carouselCards: { type: [carouselCardSchema], default: [] },
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
