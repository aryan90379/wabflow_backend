import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' }, // Link to WhatsApp chat
  bookedByPhone: { type: String, default: "N/A" }, // Made optional for manual web bookings
  patientName: { type: String, required: true },
  patientAge: { type: Number },
  treatmentType: { type: String, default: "Consultation" }, // 👈 ADDED THIS FIELD
  date: { type: String, required: true }, 
  time: { type: String, required: true }, 
  status: { type: String, enum: ['confirmed', 'cancelled', 'completed'], default: 'confirmed' }
}, { timestamps: true });

export const Appointment = mongoose.models.Appointment || mongoose.model("Appointment", appointmentSchema);