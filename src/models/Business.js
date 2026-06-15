import mongoose from "mongoose";

const dayHoursSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    open: { type: String, default: "09:00" },
    close: { type: String, default: "18:00" },
  },
  { _id: false }
);

const businessSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    businessType: { type: String, default: "other", trim: true, lowercase: true },
    description: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    phone: { type: String, default: "" },
    timezone: { type: String, default: "Asia/Kolkata" },
    openingHours: {
      monday: { type: dayHoursSchema, default: () => ({}) },
      tuesday: { type: dayHoursSchema, default: () => ({}) },
      wednesday: { type: dayHoursSchema, default: () => ({}) },
      thursday: { type: dayHoursSchema, default: () => ({}) },
      friday: { type: dayHoursSchema, default: () => ({}) },
      saturday: { type: dayHoursSchema, default: () => ({}) },
      sunday: { type: dayHoursSchema, default: () => ({ enabled: false }) },
    },
    settings: {
      botEnabled: { type: Boolean, default: true },
      aiEnabled: { type: Boolean, default: false },
      handoffEnabled: { type: Boolean, default: true },
      language: {
        type: String,
        enum: ["english", "hindi", "hinglish"],
        default: "hinglish",
      },
      fallbackMessage: {
        type: String,
        default: "Sorry, I could not understand that. Please choose an option or ask for a human.",
      },
      handoffMessage: {
        type: String,
        default: "I am connecting you with a team member. They will reply here shortly.",
      },
    },
    integrations: {
      whatsappConnected: { type: Boolean, default: false },
    },
    teamAccess: {
      businessCode: { type: String, default: null, unique: true, sparse: true },
      staffLoginEnabled: { type: Boolean, default: true },
      maxStaff: { type: Number, default: 5 },
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

businessSchema.index({ ownerId: 1, createdAt: -1 });

export const Business = mongoose.models.Business || mongoose.model("Business", businessSchema);
