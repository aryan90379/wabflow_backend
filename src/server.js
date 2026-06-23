import { app } from "./app.js";
import { connectDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { startFollowUpWorker } from "./services/followUpWorker.js";
import { initSocket } from "./services/socketService.js";
import { initRawChatSocket } from "./services/rawChatSocketService.js";
import { notificationQueue, notificationWorker } from "./workers/notificationWorker.js";
import { broadcastQueue, broadcastWorker } from "./workers/broadcastWorker.js";
import { bookingReminderQueue } from "./workers/bookingReminderQueue.js";
import { bookingReminderWorker } from "./workers/bookingReminderWorker.js";

async function start() {
  await connectDatabase();

  const server = app.listen(env.port, () => {
    console.log(`[server] WabFlow API listening on port ${env.port}`);
  });

  initSocket(server);
  initRawChatSocket(server);

  const followUpTimer = startFollowUpWorker();

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    clearInterval(followUpTimer);
    
    // Gracefully shut down BullMQ
    await notificationWorker.close();
    await notificationQueue.close();
    await broadcastWorker.close();
    await broadcastQueue.close();
    await bookingReminderWorker.close();
    await bookingReminderQueue.close();

    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  console.error("[server] Startup failed", error);
  process.exit(1);
});
