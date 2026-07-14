import mongoose from "mongoose";

const bookingReminderSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    leadTimeMinutes: { type: Number, required: true, default: 1440 },
    scheduledFor: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ["queued", "processing", "sent", "failed", "skipped", "cancelled"],
      default: "queued",
      index: true,
    },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatsappMessageTemplate", default: null },
    phone: { type: String, default: "" },
    sentAt: { type: Date, default: null },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    whatsappMessageId: { type: String, default: "" },
    error: { type: String, default: "" },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", index: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true },
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
    endTime: { type: String, default: "" },
    guests: { type: Number, default: 1 },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    notes: { type: String, default: "" },
    cardTheme: {
      type: String,
      enum: ["platinum", "emerald", "jade", "sapphire", "amethyst", "rose_gold", "obsidian"],
      default: "platinum",
    },
    customFields: {
      type: [
        {
          name: { type: String, required: true },
          question: { type: String, required: true },
          value: { type: String, default: "" },
        },
      ],
      default: [],
    },
    reminders: { type: [bookingReminderSchema], default: [] },
    updatedByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    updatedByName: { type: String, default: "" },
    metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

bookingSchema.index({ businessId: 1, status: 1, createdAt: -1 });
bookingSchema.index({ "reminders.status": 1, "reminders.scheduledFor": 1 });

export const Booking = mongoose.models.Booking || mongoose.model("Booking", bookingSchema);
