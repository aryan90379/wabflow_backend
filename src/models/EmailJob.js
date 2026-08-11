import mongoose from 'mongoose';

const emailJobSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // e.g., 'Bulk Campaign - 2026-07-31'
    status: { type: String, enum: ['queued', 'processing', 'completed', 'failed'], default: 'queued' },
    totalEmails: { type: Number, default: 0 },
    sentEmails: { type: Number, default: 0 },
    failedEmails: { type: Number, default: 0 },
    
    // Deliverability Metrics
    totalDelivered: { type: Number, default: 0 },
    totalBounces: { type: Number, default: 0 },
    hardBounces: { type: Number, default: 0 },
    softBounces: { type: Number, default: 0 },
    complaints: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
    opens: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    unsubscribes: { type: Number, default: 0 },
    
    error: { type: String },
    createdBy: { type: String }, // User ID or 'admin'
  },
  { timestamps: true }
);

export const EmailJob = mongoose.model('EmailJob', emailJobSchema);
