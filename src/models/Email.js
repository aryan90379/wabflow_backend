import mongoose from 'mongoose';

const emailSchema = new mongoose.Schema(
  {
    messageId: { type: String, index: true },
    threadId: { type: String, index: true }, // To group replies
    from: { type: String, required: true },
    to: [{ type: String, required: true }],
    cc: [{ type: String }],
    bcc: [{ type: String }],
    subject: { type: String, required: true },
    bodyText: { type: String },
    bodyHtml: { type: String },
    folder: { type: String, enum: ['inbox', 'sent', 'draft', 'trash'], default: 'sent' },
    status: { type: String, enum: ['pending', 'sent', 'failed', 'delivered', 'bounced', 'complaint'], default: 'pending' },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailJob' }, // If it was part of a bulk job
    error: { type: String },
    attachments: [
      {
        filename: String,
        url: String,
        contentType: String,
        size: Number,
      }
    ],
    opened: { type: Boolean, default: false },
    openedAt: { type: Date },
  },
  { timestamps: true }
);

export const Email = mongoose.model('Email', emailSchema);
