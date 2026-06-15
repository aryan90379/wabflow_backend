import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    serviceItemId: { type: mongoose.Schema.Types.ObjectId, ref: "ServiceItem", default: null },
    type: {
      type: String,
      enum: ["appointment", "room_booking", "table_booking", "demo_class", "visit", "service_booking", "other"],
      default: "appointment",
    },
    status: {
      type: String,
      enum: ["requested", "confirmed", "cancelled", "completed"],
      default: "requested",
      index: true,
    },
    startDate: { type: String, default: "" },
    endDate: { type: String, default: "" },
    startTime: { type: String, default: "" },
    guests: { type: Number, default: 1 },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    notes: { type: String, default: "" },
    updatedByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    updatedByName: { type: String, default: "" },
    metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

bookingSchema.index({ businessId: 1, status: 1, createdAt: -1 });

export const Booking = mongoose.models.Booking || mongoose.model("Booking", bookingSchema);
