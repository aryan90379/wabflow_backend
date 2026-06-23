import { Booking } from "../models/index.js";
import { bookingReminderQueue } from "../workers/bookingReminderQueue.js";
import { sendApprovedTemplateMessage } from "./templateMessageService.js";

export const DEFAULT_BOOKING_REMINDER_LEAD_MINUTES = 24 * 60;

const REMINDER_JOB_PREFIX = "booking-reminder";

export function getBookingAppointmentDate(booking) {
  if (!booking?.startDate || !booking?.startTime) return null;

  const dateText = String(booking.startDate).slice(0, 10);
  const timeText = String(booking.startTime).slice(0, 5);
  const timezoneOffset = String(
    booking.metadata?.get?.("timezoneOffset") ||
    booking.metadata?.timezoneOffset ||
    process.env.DEFAULT_BOOKING_TIMEZONE_OFFSET ||
    "+05:30"
  );

  const appointmentDate = new Date(`${dateText}T${timeText}:00.000${timezoneOffset}`);
  return Number.isNaN(appointmentDate.getTime()) ? null : appointmentDate;
}

const normalizeLeadTimes = (value) => {
  const raw = Array.isArray(value) && value.length ? value : [{ leadTimeMinutes: DEFAULT_BOOKING_REMINDER_LEAD_MINUTES }];
  const seen = new Set();

  return raw
    .map((item) => Number(item?.leadTimeMinutes ?? item))
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0)
    .map((minutes) => Math.round(minutes))
    .filter((minutes) => {
      if (seen.has(minutes)) return false;
      seen.add(minutes);
      return true;
    });
};

export function getReminderVariables(booking) {
  const metadata = booking.metadata || {};
  const getMeta = (key) => metadata.get?.(key) ?? metadata[key] ?? "";
  const reason = booking.notes || getMeta("appointmentReason") || getMeta("roomType") || "your visit";
  const businessName = getMeta("businessName") || getMeta("clinicName") || "our team";
  const dateLabel = booking.startDate || "";
  const timeLabel = booking.startTime || "";

  return [
    booking.customerName || "there",
    reason,
    businessName,
    dateLabel,
    timeLabel,
  ];
}

export async function prepareBookingReminders(bookingInput) {
  const booking = bookingInput?.save ? bookingInput : await Booking.findById(bookingInput?._id || bookingInput);
  if (!booking) return null;

  const metadata = booking.metadata || new Map();
  const getMeta = (key) => metadata.get?.(key) ?? metadata[key];
  const shouldSend = getMeta("sendWhatsappReminder") === true;
  const templateId = getMeta("reminderTemplateId");
  const phone = getMeta("reminderPhone") || booking.customerPhone;
  const requestedReminders = getMeta("reminders");

  if (!shouldSend || !templateId || !phone) {
    booking.reminders = (booking.reminders || []).map((reminder) => (
      ["sent", "failed"].includes(reminder.status) ? reminder : { ...reminder, status: "cancelled" }
    ));
    await booking.save();
    return booking;
  }

  const appointmentDate = getBookingAppointmentDate(booking);
  if (!appointmentDate) return booking;

  const now = new Date();
  const existingByKey = new Map((booking.reminders || []).map((reminder) => [reminder.key, reminder]));
  const reminders = normalizeLeadTimes(requestedReminders).map((leadTimeMinutes) => {
    const key = `${leadTimeMinutes}m`;
    const scheduledForRaw = new Date(appointmentDate.getTime() - leadTimeMinutes * 60 * 1000);
    const scheduledFor = scheduledForRaw <= now ? now : scheduledForRaw;
    const existing = existingByKey.get(key);

    if (existing?.status === "sent") return existing;

    return {
      key,
      leadTimeMinutes,
      scheduledFor,
      status: "queued",
      templateId,
      phone,
      sentAt: null,
      messageId: null,
      whatsappMessageId: "",
      error: "",
    };
  });

  booking.reminders = reminders;
  await booking.save();
  await scheduleBookingReminderJobs(booking);
  return booking;
}

export async function scheduleBookingReminderJobs(booking) {
  for (const reminder of booking.reminders || []) {
    if (reminder.status !== "queued") continue;

    const delay = Math.max(0, new Date(reminder.scheduledFor).getTime() - Date.now());
    const jobId = `${REMINDER_JOB_PREFIX}:${booking._id}:${reminder.key}`;

    await bookingReminderQueue.add(
      "send-booking-reminder",
      { bookingId: String(booking._id), reminderKey: reminder.key },
      {
        jobId,
        delay,
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      }
    );
  }
}

export async function sendBookingReminder({ bookingId, reminderKey }) {
  const booking = await Booking.findById(bookingId);
  if (!booking || ["cancelled", "completed"].includes(booking.status)) return null;

  const reminder = (booking.reminders || []).find((item) => item.key === reminderKey);
  if (!reminder || reminder.status === "sent" || reminder.status === "cancelled") return null;

  if (new Date(reminder.scheduledFor).getTime() > Date.now() + 5000) {
    await scheduleBookingReminderJobs(booking);
    return null;
  }

  reminder.status = "processing";
  reminder.error = "";
  await booking.save();

  try {
    const result = await sendApprovedTemplateMessage({
      businessId: booking.businessId,
      templateId: reminder.templateId,
      phone: reminder.phone,
      customerName: booking.customerName,
      templateVariables: getReminderVariables(booking),
    });

    reminder.status = "sent";
    reminder.sentAt = new Date();
    reminder.messageId = result.message?._id || null;
    reminder.whatsappMessageId = result.message?.whatsappMessageId || "";
    await booking.save();
    return result;
  } catch (error) {
    reminder.status = "failed";
    reminder.error = error?.meta?.message || error.message || "Reminder failed.";
    await booking.save();
    throw error;
  }
}
