import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    type: { type: String, required: true, default: 'WhatsApp Broadcast' }, // e.g., WhatsApp, Email, SMS
    description: { type: String, required: true }, // The message body
    link: { type: String }, // Booking/Website link
    status: { type: String, enum: ['active', 'completed', 'draft'], default: 'active' },
    imageUrl: { type: String }, // 👈 NEW: Added image URL field
    // Metrics
    sent: { type: Number, default: 0 },
    repliesCount: { type: Number, default: 0 },
    replies: [{ type: String }], // Array to store conversation IDs later
    booked: { type: Number, default: 0 } // Track conversions
  },
  { timestamps: true }
);

export const Campaign = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);