import mongoose from "mongoose";

const contactSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    waId: { type: String, required: true },
    phone: { type: String, required: true },
    name: { type: String, default: "" },
    tags: [{ type: String, trim: true, lowercase: true }],
    leadStage: {
      type: String,
      enum: ["new", "interested", "booked", "won", "lost"],
      default: "new",
      index: true,
    },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    notes: { type: String, default: "" },
    customFields: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

contactSchema.index({ businessId: 1, waId: 1 }, { unique: true });
contactSchema.index({ businessId: 1, lastMessageAt: -1 });

export const Contact = mongoose.models.Contact || mongoose.model("Contact", contactSchema);
