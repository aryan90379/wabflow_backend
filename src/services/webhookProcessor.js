import { BroadcastRecipient, Message, WhatsappAccount } from "../models/index.js";
import { extractWhatsappEvents } from "./webhookParser.js";
import { processIncomingMessage } from "./botEngine.js";
import { emitBroadcastProgress, refreshBroadcastJobCounts } from "./broadcastProgressService.js";
import { broadcastToBusiness } from "./socketService.js";
import { broadcastRawToBusiness } from "./rawChatSocketService.js";

const validStatuses = new Set([
  "sent",
  "delivered",
  "read",
  "failed",
]);

async function processStatus(event) {
  if (!event?.messageId || !validStatuses.has(event.status)) {
    return;
  }

  const message = await Message.findOneAndUpdate(
    {
      whatsappMessageId: event.messageId,
    },
    {
      $set: {
        status: event.status,
        ...(event.errors?.length
          ? {
              error: event.errors,
            }
          : {}),
      },
    },
    { new: true }
  );

  if (message?.businessId) {
    const messagePayload = message.toObject();
    broadcastToBusiness(String(message.businessId), "new_message", messagePayload);
    broadcastRawToBusiness(String(message.businessId), "new_message", messagePayload);
  }

  const recipient = await BroadcastRecipient.findOneAndUpdate(
    { whatsappMessageId: event.messageId },
    {
      $set: {
        status: event.status,
        ...(event.status === "sent" || event.status === "delivered" || event.status === "read"
          ? { sentAt: new Date() }
          : {}),
        ...(event.errors?.length
          ? { error: event.errors.map(item => item?.message || item?.title || String(item)).join(", ") }
          : { error: "" }),
      },
    },
    { new: true }
  );

  if (recipient?.broadcastJobId) {
    const job = await refreshBroadcastJobCounts(recipient.broadcastJobId);
    if (job) emitBroadcastProgress(job, recipient);
  }
}

async function findActiveAccount(phoneNumberId) {
  if (!phoneNumberId) {
    return null;
  }

  return WhatsappAccount.findOne({
    phoneNumberId: String(phoneNumberId),
    status: "active",
  });
}

export async function processWhatsappWebhook(payload) {
  const parsedEvents = extractWhatsappEvents(payload);
  const events = Array.isArray(parsedEvents) ? parsedEvents : [];

  if (!events.length) {
    return;
  }

  const phoneNumberIds = [
    ...new Set(
      events
        .map((event) => event?.phoneNumberId)
        .filter(Boolean)
    ),
  ].map(String);

  if (phoneNumberIds.length) {
    await WhatsappAccount.updateMany(
      {
        phoneNumberId: {
          $in: phoneNumberIds,
        },
      },
      {
        $set: {
          lastWebhookAt: new Date(),
        },
      }
    );
  }

  const accountCache = new Map();

  for (const event of events) {
    try {
      if (event?.kind === "status") {
        await processStatus(event);
        continue;
      }

      if (event?.kind !== "message") {
        continue;
      }

      const phoneNumberId = event.phoneNumberId
        ? String(event.phoneNumberId)
        : "";

      if (!phoneNumberId) {
        console.warn(
          "[webhook] Message event missing phoneNumberId",
          {
            messageId: event.messageId || null,
          }
        );

        continue;
      }

      let account = accountCache.get(phoneNumberId);

      if (account === undefined) {
        account = await findActiveAccount(phoneNumberId);

        accountCache.set(
          phoneNumberId,
          account || null
        );
      }

      if (!account) {
        console.warn("[webhook] No active WhatsApp account", {
          phoneNumberId,
          messageId: event.messageId || null,
        });

        continue;
      }

      /*
       * Do not check token fields here.
       *
       * They use select:false in the schema and are intentionally
       * loaded only inside whatsappClient.js immediately before sending.
       */
      event.phoneNumberId = phoneNumberId;
      event.whatsappAccountId = account._id;
      event.businessId = account.businessId;
      event.whatsappAccount = account;

      await processIncomingMessage(event);
    } catch (error) {
      console.error("[webhook] Event processing failed", {
        kind: event?.kind || null,
        messageId: event?.messageId || null,
        phoneNumberId: event?.phoneNumberId || null,
        error: error?.message || String(error),
        stack: error?.stack,
      });
    }
  }
}
