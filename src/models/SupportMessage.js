import mongoose from "mongoose";

const supportMessageSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["user", "developer"],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: [
      {
        type: String,
      },
    ],
  },
  { timestamps: true }
);

export const SupportMessage =
  mongoose.models.SupportMessage ||
  mongoose.model("SupportMessage", supportMessageSchema);
