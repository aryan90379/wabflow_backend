import { Worker } from "bullmq";
import { sendBookingReminder } from "../services/bookingReminderService.js";
import { createRedisConnection } from "./redisConnection.js";

export const bookingReminderWorker = new Worker(
  "booking-reminders",
  async (job) => {
    const { bookingId, reminderKey } = job.data;
    await sendBookingReminder({ bookingId, reminderKey });
  },
  {
    connection: createRedisConnection(),
    concurrency: Number(process.env.BOOKING_REMINDER_WORKER_CONCURRENCY || 2),
  }
);

bookingReminderWorker.on("completed", (job) => {
  console.log(`[booking-reminder] Job ${job.id} completed.`);
});

bookingReminderWorker.on("failed", (job, error) => {
  console.error(`[booking-reminder] Job ${job?.id} failed:`, error.message);
});
