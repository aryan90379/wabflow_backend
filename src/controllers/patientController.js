import { Patient } from '../models/Patient.js';
import { Treatment } from '../models/Treatment.js';

export const getPatients = async (req, res) => {
  try {
    const patients = await Patient.find({ doctorId: req.user._id }).sort({ updatedAt: -1 });
    res.status(200).json(patients);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch patients" });
  }
};

export const getPatientById = async (req, res) => {
  try {
    const patient = await Patient.findOne({ _id: req.params.id, doctorId: req.user._id });
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    
    const treatments = await Treatment.find({ patientId: patient._id }).sort({ date: -1 });
    res.status(200).json({ patient, treatments });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch patient details" });
  }
};

// Add create/update controllers here later for manual 

export const createPatient = async (req, res) => {
  try {
    const { 
      name, phone, age, status, lastVisit, notes, 
      treatmentType, treatmentDate, treatmentCost, doctorName 
    } = req.body;

    // 1. Create Patient
    const newPatient = await Patient.create({
      doctorId: req.user._id,
      name,
      phone,
      age: age ? parseInt(age) : null,
      status: status || 'active',
      lastVisit: lastVisit ? new Date(lastVisit) : new Date(),
      totalValue: treatmentCost ? parseFloat(treatmentCost) : 0,
      notes
    });

    // 2. Create Initial Treatment History (if provided)
    if (treatmentType) {
      await Treatment.create({
        patientId: newPatient._id,
        treatmentType,
        date: treatmentDate ? new Date(treatmentDate) : new Date(),
        doctorName: doctorName || req.user.name || 'Doctor',
        cost: treatmentCost ? parseFloat(treatmentCost) : 0
      });
    }

    res.status(201).json({ success: true, patient: newPatient });
  } catch (error) {
    console.error("Failed to create patient:", error);
    res.status(500).json({ error: "Failed to create patient" });
  }
};