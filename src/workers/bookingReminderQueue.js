import { Queue } from "bullmq";
import { createRedisConnection } from "./redisConnection.js";

export const bookingReminderQueue = new Queue("booking-reminders", {
  connection: createRedisConnection(),
});
