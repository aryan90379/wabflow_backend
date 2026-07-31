import { Queue } from "bullmq";
import { createRedisConnection } from "./redisConnection.js";

export const emailQueue = new Queue("email-queue", {
  connection: createRedisConnection(),
});
