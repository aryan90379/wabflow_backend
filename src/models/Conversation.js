import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patientPhone: { type: String, required: true },
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  lastMessageAt: { type: Date, default: Date.now }
}, { timestamps: true });

export const Conversation = mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);