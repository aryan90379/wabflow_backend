import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: { type: String, enum: ['bot', 'user', 'doctor'], required: true },
  text: { type: String, required: true },
  metaId: { type: String } // The WhatsApp message ID
}, { timestamps: true });

export const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);