import mongoose from 'mongoose';

const emailEventSchema = new mongoose.Schema(
  {
    snsMessageId: { type: String, required: true, unique: true }, // For idempotency
    messageId: { type: String, index: true }, // Original SES message ID
    eventType: { type: String, required: true, index: true }, // e.g., 'Delivery', 'Bounce', 'Complaint', 'Reject', 'Open', 'Send'
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailJob', index: true },
    emailId: { type: mongoose.Schema.Types.ObjectId, ref: 'Email', index: true },
    recipient: { type: String }, // Who this event pertains to
    rawPayload: { type: mongoose.Schema.Types.Mixed }, // Store the raw SES JSON
  },
  { timestamps: true }
);

export const EmailEvent = mongoose.model('EmailEvent', emailEventSchema);
