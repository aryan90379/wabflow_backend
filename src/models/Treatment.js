import mongoose from "mongoose";

const treatmentSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
    treatmentType: { type: String, required: true },
    date: { type: Date, required: true },
    doctorName: { type: String, required: true },
    cost: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Treatment = mongoose.models.Treatment || mongoose.model("Treatment", treatmentSchema);