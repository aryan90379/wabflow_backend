function parseMessage(message, value, entryId) {
  let type = message.type || "unknown";
  let text = "";
  let selectionId = "";
  let selectionTitle = "";
  let media = {};

  if (type === "text") {
    text = message.text?.body || "";
  } else if (type === "interactive") {
    if (message.interactive?.type === "nfm_reply") {
      const reply = message.interactive.nfm_reply;
      try {
        const responseJson = JSON.parse(reply.response_json || "{}");
        selectionId = "flow_submission";
        selectionTitle = "Flow Form Submitted";
        text = "Booking form submitted";
        type = "flow_reply";
        media = { responseJson }; // Storing form fields in media for easy access
      } catch (e) {
        text = "Flow form submitted but could not parse response.";
        type = "flow_reply";
      }
    } else {
      const reply = message.interactive?.button_reply || message.interactive?.list_reply || {};
      selectionId = reply.id || "";
      selectionTitle = reply.title || "";
      text = selectionTitle;
      type = message.interactive?.button_reply ? "button" : "list";
    }
  } else if (type === "button") {
    selectionId = message.button?.payload || "";
    selectionTitle = message.button?.text || "";
    text = selectionTitle;
  }

  if (["image", "video", "audio", "document"].includes(type)) {
    const item = message[type] || {};
    media = {
      id: item.id || "",
      mimeType: item.mime_type || "",
      filename: item.filename || "",
      caption: item.caption || "",
    };
    text = item.caption || "";
  }

  if (type === "location") {
    text = [message.location?.name, message.location?.address].filter(Boolean).join(" - ");
  }

  return {
    kind: "message",
    webhookEventId: entryId,
    phoneNumberId: value.metadata?.phone_number_id,
    displayPhoneNumber: value.metadata?.display_phone_number,
    messageId: message.id,
    from: message.from,
    profileName: value.contacts?.find((item) => item.wa_id === message.from)?.profile?.name || "",
    timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
    type,
    text,
    selectionId,
    selectionTitle,
    media,
    raw: message,
  };
}

export function extractWhatsappEvents(payload) {
  const events = [];

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};

      for (const message of value.messages || []) {
        events.push(parseMessage(message, value, entry.id));
      }

      for (const status of value.statuses || []) {
        events.push({
          kind: "status",
          webhookEventId: entry.id,
          phoneNumberId: value.metadata?.phone_number_id,
          messageId: status.id,
          status: status.status,
          timestamp: status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date(),
          errors: status.errors || [],
          raw: status,
        });
      }
    }
  }

  return events;
}
