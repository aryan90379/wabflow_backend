import { Patient } from '../models/Patient.js';
import { User } from '../models/User.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Appointment } from '../models/Appointment.js';

import { format, toZonedTime } from 'date-fns-tz';

const TIME_ZONE = 'Asia/Kolkata';

// -----------------------------
// Doctor + Patient helpers
// -----------------------------
// 🔥 Now we find the doctor by the WhatsApp Phone ID that received the message
export async function getDoctorByPhoneId(phoneNumberId) {
  return User.findOne({ 'whatsappApiDetails.phoneNumberId': phoneNumberId }).lean();
}

export async function getKnownPatient(phone, doctorId) {
  return Patient.findOne({ phone, doctorId });
}

// -----------------------------
// Conversation + Messages
// -----------------------------
export async function logMessage(phone, doctorId, sender, text, metaId = null) {
  let convo = await Conversation.findOne({ patientPhone: phone, doctorId });

  if (!convo) {
    convo = await Conversation.create({
      doctorId,
      patientPhone: phone,
      lastMessageAt: new Date()
    });
  } else {
    convo.lastMessageAt = new Date();
    await convo.save();
  }

  await Message.create({
    conversationId: convo._id,
    sender,
    text,
    metaId
  });

  return convo._id;
}

// -----------------------------
// 🔥 TIMEZONE SAFE DATE LOGIC
// -----------------------------
function getNextDateForDay(dayName) {
  const dayMap = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6
  };

  const targetDay = dayMap[dayName];

  // Get current time in IST safely
  const now = new Date();
  const zonedNow = toZonedTime(now, TIME_ZONE);

  // Start from IST "today"
  let d = new Date(zonedNow);

  if (targetDay === undefined) {
    return format(d, 'yyyy-MM-dd', { timeZone: TIME_ZONE });
  }

  const today = d.getDay();
  let diff = targetDay - today;

  if (diff < 0) diff += 7;

  d.setDate(d.getDate() + diff);

  // Format in IST (NO UTC SHIFT EVER)
  return format(d, 'yyyy-MM-dd', { timeZone: TIME_ZONE });
}

// -----------------------------
// 🚀 BOOK APPOINTMENT (OPTIMIZED)
// -----------------------------
export async function bookAppointment(doctor, phone, appointmentData) {
  try {
    if (!doctor) throw new Error('Doctor not found');
    // ✅ Get correct IST date
    const actualDateString = getNextDateForDay(appointmentData.day);

    // ✅ Parallel ops (faster)
    const [convoId, existingPatient] = await Promise.all([
      logMessage(
        phone,
        doctor._id,
        'bot',
        `[SYSTEM] Appointment Booked for ${appointmentData.name} on ${appointmentData.day} (${actualDateString}) at ${appointmentData.time}`
      ),
      getKnownPatient(phone, doctor._id)
    ]);

    let patient = existingPatient;

    // ✅ Create patient only if not exists
    if (!patient) {
      patient = await Patient.create({
        doctorId: doctor._id,
        name: appointmentData.name,
        phone,
        age: parseInt(appointmentData.age) || null,
        status: 'pending_tx'
      });
    }

    // ✅ Save appointment (clean date string, no timezone bugs)
    await Appointment.create({
      doctorId: doctor._id,
      conversationId: convoId,
      bookedByPhone: phone,
      patientName: appointmentData.name,
      patientAge: parseInt(appointmentData.age) || null,
      date: actualDateString, // 🔒 SAFE YYYY-MM-DD (IST locked)
      time: appointmentData.time
    });

    return true;

  } catch (error) {
    console.error('Booking failed:', error);
    return false;
  }
}