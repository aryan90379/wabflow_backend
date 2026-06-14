import mongoose from "mongoose";

const serviceItemSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    type: {
      type: String,
      enum: ["service", "room", "course", "package", "product", "property", "table", "other"],
      default: "service",
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    price: { type: Number, default: null },
    currency: { type: String, default: "INR" },
    durationMinutes: { type: Number, default: null },
    images: [{ type: String }],
    availabilityEnabled: { type: Boolean, default: false },
    metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

serviceItemSchema.index({ businessId: 1, active: 1, type: 1 });

export const ServiceItem =
  mongoose.models.ServiceItem || mongoose.model("ServiceItem", serviceItemSchema);
