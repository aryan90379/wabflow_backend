import {
  FollowUpTask,
  Conversation,
  Contact,
  WhatsappAccount,
} from "../models/index.js";
import { sendAndSaveMessage } from "./conversationService.js";

let running = false;

async function claimNextTask() {
  return FollowUpTask.findOneAndUpdate(
    { status: "pending", scheduledAt: { $lte: new Date() } },
    { $set: { status: "processing" } },
    { new: true, sort: { scheduledAt: 1 } }
  );
}

export async function runFollowUpWorkerOnce() {
  if (running) return;
  running = true;

  try {
    for (let count = 0; count < 25; count += 1) {
      const task = await claimNextTask();
      if (!task) break;

      try {
        const [conversation, contact] = await Promise.all([
          Conversation.findOne({ _id: task.conversationId, businessId: task.businessId }),
          Contact.findById(task.contactId),
        ]);

        if (!conversation || !contact) throw new Error("Conversation or contact no longer exists.");
        const account = await WhatsappAccount.findById(conversation.whatsappAccountId);
        if (!account || account.status !== "active") throw new Error("WhatsApp account is not active.");

        await sendAndSaveMessage({
          account,
          contact,
          conversation,
          response: { type: "text", text: task.message },
          senderType: "bot",
        });

        task.status = "sent";
        task.sentAt = new Date();
        task.error = "";
        await task.save();
      } catch (error) {
        task.status = "failed";
        task.error = error.message;
        await task.save();
      }
    }
  } finally {
    running = false;
  }
}

export function startFollowUpWorker() {
  runFollowUpWorkerOnce().catch((error) => console.error("[follow-up]", error.message));
  return setInterval(() => {
    runFollowUpWorkerOnce().catch((error) => console.error("[follow-up]", error.message));
  }, 60_000);
}
