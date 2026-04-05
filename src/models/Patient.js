import mongoose from "mongoose";

const patientSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    age: { type: Number },
    status: { type: String, enum: ['active', 'dormant', 'pending_tx'], default: 'active' },
    lastVisit: { type: Date, default: Date.now },
    totalValue: { type: Number, default: 0 },
    notes: { type: String }
  },
  { timestamps: true }
);

export const Patient = mongoose.models.Patient || mongoose.model("Patient", patientSchema);