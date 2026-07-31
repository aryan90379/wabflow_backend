import { Worker } from "bullmq";
import { EmailService } from "../services/EmailService.js";
import { EmailJob } from "../models/EmailJob.js";
import { createRedisConnection } from "./redisConnection.js";

export const emailWorker = new Worker(
  "email-queue",
  async (job) => {
    const { from, to, subject, bodyText, bodyHtml, threadId, jobId } = job.data;
    await EmailService.sendEmail({
      from,
      to,
      subject,
      bodyText,
      bodyHtml,
      threadId,
      jobId,
    });
    
    if (jobId) {
      await EmailJob.findByIdAndUpdate(jobId, { $inc: { sentEmails: 1 } });
    }
  },
  {
    connection: createRedisConnection(),
    concurrency: 5, // Process 5 emails concurrently (rate limit for SES)
    limiter: {
      max: 14, // SES sandbox usually allows 14 per second
      duration: 1000,
    }
  }
);

emailWorker.on("completed", async (job) => {
  console.log(`[email-worker] Job ${job.id} completed.`);
  
  if (job.data.jobId) {
    const emailJob = await EmailJob.findById(job.data.jobId);
    if (emailJob && emailJob.sentEmails + emailJob.failedEmails >= emailJob.totalEmails) {
      emailJob.status = 'completed';
      await emailJob.save();
    }
  }
});

emailWorker.on("failed", async (job, error) => {
  console.error(`[email-worker] Job ${job?.id} failed:`, error.message);
  
  if (job?.data?.jobId) {
    await EmailJob.findByIdAndUpdate(job.data.jobId, { $inc: { failedEmails: 1 } });
    
    const emailJob = await EmailJob.findById(job.data.jobId);
    if (emailJob && emailJob.sentEmails + emailJob.failedEmails >= emailJob.totalEmails) {
      emailJob.status = 'completed';
      await emailJob.save();
    }
  }
});
