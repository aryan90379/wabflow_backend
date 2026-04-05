import { Appointment } from '../models/Appointment.js';
import { Message } from '../models/Message.js';
import { Patient } from '../models/Patient.js'; // 👈 Import Patient model

export const getAppointments = async (req, res) => {
  try {
    const appointments = await Appointment.find({ doctorId: req.user._id }).sort({ date: 1, time: 1 });
    res.status(200).json(appointments);
  } catch (error) {
    console.error("Fetch appointments error:", error);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
};

export const createAppointment = async (req, res) => {
  try {
    // 👈 FIX: Add "|| {}" to safely fallback if req.body is completely missing/undefined
    const { patientName, phone, treatmentType, date, time } = req.body || {};

    // 👈 FIX: Add strict validation so it tells the frontend exactly what went wrong instead of crashing
    if (!patientName || !date || !time) {
      return res.status(400).json({ 
        error: "Missing required fields. If you sent data, ensure express.json() is configured before your routes in app.js!" 
      });
    }

    // 1. Create the Appointment safely
    const newAppointment = await Appointment.create({
      doctorId: req.user._id,
      patientName,
      bookedByPhone: phone || "N/A", 
      treatmentType: treatmentType || 'Consultation',
      date,
      time,
      status: 'confirmed'
    });

    // 2. Automatically sync this person to the Patients CRM
    let patient = await Patient.findOne({ name: patientName, doctorId: req.user._id });
    if (!patient) {
     const [y, m, d] = date.split('-');

await Patient.create({
  doctorId: req.user._id,
  name: patientName,
  phone: phone || "N/A",
  status: 'pending_tx',
  lastVisit: new Date(y, m - 1, d) // ✅ NO UTC SHIFT
});
    }

    res.status(201).json({ success: true, appointment: newAppointment });
  } catch (error) {
    console.error("Create appointment error:", error);
    res.status(500).json({ error: "Failed to create appointment", details: error.message });
  }
};

export const getAppointmentDetails = async (req, res) => {
  try {
    const appointment = await Appointment.findOne({ _id: req.params.id, doctorId: req.user._id }).lean();
    if (!appointment) return res.status(404).json({ error: "Appointment not found" });

    let messages = [];
    if (appointment.conversationId) {
      messages = await Message.find({ conversationId: appointment.conversationId }).sort({ createdAt: 1 }).lean();
    }

    res.status(200).json({ appointment, messages });
  } catch (error) {
    console.error("Fetch appointment details error:", error);
    res.status(500).json({ error: "Failed to fetch details" });
  }
};