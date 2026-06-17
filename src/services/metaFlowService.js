import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { env } from "../config/env.js";
import { WhatsappAccount } from "../models/WhatsappAccount.js";
import { encryptSecret } from "../utils/crypto.js";

const GRAPH_VERSION = env.metaGraphVersion || "v21.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const FLOW_IMAGE_MAX_BYTES = Number(process.env.META_FLOW_IMAGE_MAX_BYTES || 300000);

function generateFlowKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });
}

export async function uploadPhoneNumberFlowPublicKey(phoneNumberId, accessToken, publicKey) {
  const url = `${BASE_URL}/${phoneNumberId}/whatsapp_business_encryption`;
  const response = await axios.post(
    url,
    new URLSearchParams({ business_public_key: publicKey }).toString(),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
  return response.data;
}

export async function ensurePhoneNumberFlowPublicKey(account, accessToken) {
  if (!account?.phoneNumberId) {
    throw new Error("WhatsApp phone number ID is required to configure Flow encryption.");
  }

  if (account.flowPublicKeySetAt && account.encryptedFlowPrivateKey) {
    return { created: false };
  }

  const { publicKey, privateKey } = generateFlowKeyPair();
  await uploadPhoneNumberFlowPublicKey(account.phoneNumberId, accessToken, publicKey);

  const encrypted = encryptSecret(privateKey);
  await WhatsappAccount.updateOne(
    { _id: account._id },
    {
      $set: {
        encryptedFlowPrivateKey: encrypted.encryptedValue,
        flowPrivateKeyIv: encrypted.encryptionIv,
        flowPrivateKeyTag: encrypted.encryptionTag,
        flowPublicKeySetAt: new Date(),
      },
    }
  );

  account.encryptedFlowPrivateKey = encrypted.encryptedValue;
  account.flowPrivateKeyIv = encrypted.encryptionIv;
  account.flowPrivateKeyTag = encrypted.encryptionTag;
  account.flowPublicKeySetAt = new Date();

  return { created: true };
}

function toMinutes(value) {
  const [hour, minute] = String(value || "").split(":").map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function formatTimeLabel(value) {
  const minutes = toMinutes(value);
  if (minutes === null) return String(value || "").trim();

  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function buildTimeSlotOptions(availability = {}) {
  const configuredSlots = (availability.slots || [])
    .map((slot) => String(slot || "").trim())
    .filter(Boolean);

  const slots = configuredSlots.length
    ? configuredSlots
    : availability.mode === "range"
      ? buildHourlyRangeSlots(availability.from, availability.to)
      : [];

  return slots.slice(0, 10).map((slot) => ({
    id: slot.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80),
    title: formatTimeLabel(slot).slice(0, 30),
  }));
}

function buildHourlyRangeSlots(from = "09:00", to = "18:00") {
  const start = toMinutes(from);
  const end = toMinutes(to);
  if (start === null || end === null || end <= start) return [];

  const slots = [];
  for (let minutes = start; minutes < end && slots.length < 10; minutes += 60) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }
  return slots;
}

function safeImageUrl(value = "") {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

async function imageUrlToBase64(url) {
  const safeUrl = safeImageUrl(url);
  if (!safeUrl) {
    return {
      imageBase64: "",
      imageBytes: 0,
      status: "skipped",
      reason: "invalid_url",
    };
  }

  try {
    const response = await axios.get(safeUrl, {
      responseType: "arraybuffer",
      timeout: 10000,
      maxContentLength: FLOW_IMAGE_MAX_BYTES,
      maxBodyLength: FLOW_IMAGE_MAX_BYTES,
      headers: {
        Accept: "image/jpeg,image/png,image/webp,image/*",
      },
    });

    const contentType = String(response.headers?.["content-type"] || "");
    const buffer = Buffer.from(response.data);

    if (!contentType.startsWith("image/")) {
      console.warn("[meta-flow] Room image skipped because URL did not return an image", {
        url: safeUrl,
        contentType,
      });
      return {
        imageBase64: "",
        imageBytes: buffer.length,
        status: "skipped",
        reason: "not_image",
      };
    }

    if (buffer.length > FLOW_IMAGE_MAX_BYTES) {
      console.warn("[meta-flow] Room image skipped because it is too large", {
        url: safeUrl,
        bytes: buffer.length,
        maxBytes: FLOW_IMAGE_MAX_BYTES,
      });
      return {
        imageBase64: "",
        imageBytes: buffer.length,
        status: "skipped",
        reason: "too_large",
      };
    }

    return {
      imageBase64: buffer.toString("base64"),
      imageBytes: buffer.length,
      status: "inlined",
      reason: "",
    };
  } catch (error) {
    console.warn("[meta-flow] Could not inline room image", {
      url: safeUrl,
      error: error.message,
    });
    return {
      imageBase64: "",
      imageBytes: 0,
      status: "skipped",
      reason: error.message,
    };
  }
}

export async function prepareBookingFlowImages(config = {}) {
  const rooms = Array.isArray(config.rooms) ? config.rooms : [];

  if (!rooms.length) {
    return config;
  }

  const preparedRooms = await Promise.all(
    rooms.map(async (room) => {
      if (room.imageBase64 || !room.imageUrl) {
        return room;
      }

      const imageResult = await imageUrlToBase64(room.imageUrl);
      return {
        ...room,
        imageBase64: imageResult.imageBase64,
        imageBytes: imageResult.imageBytes,
        imageStatus: imageResult.status,
        imageStatusReason: imageResult.reason,
      };
    })
  );

  console.log("[meta-flow] Prepared booking room images", {
    rooms: preparedRooms.map((room) => ({
      id: String(room.id || ""),
      name: String(room.name || "").slice(0, 80),
      hasImageUrl: Boolean(room.imageUrl),
      hasImageBase64: Boolean(room.imageBase64),
      imageBytes: room.imageBytes || 0,
      imageStatus: room.imageStatus || (room.imageBase64 ? "inlined" : "none"),
      reason: room.imageStatusReason || "",
    })),
  });

  return {
    ...config,
    rooms: preparedRooms,
  };
}

function formatRoomDetail(room = {}) {
  const parts = [];

  if (room.price !== null && room.price !== undefined && room.price !== "") {
    parts.push(`${room.currency || "INR"} ${room.price}`);
  }

  if (room.description) {
    parts.push(String(room.description).trim());
  }

  return parts
    .filter(Boolean)
    .join(" - ")
    .slice(0, 300);
}

function buildRoomPreviewComponents(rooms = []) {
  const roomsWithImages = rooms
    .map((room) => ({
      ...room,
      imageBase64: String(room.imageBase64 || "").trim(),
      detail: formatRoomDetail(room),
    }))
    .filter((room) => room.imageBase64)
    .slice(0, 3);

  if (!roomsWithImages.length) {
    return [];
  }

  return [
    {
      type: "TextSubheading",
      text: roomsWithImages.length === 1 ? "Selected room" : "Room options",
    },
    ...roomsWithImages.flatMap((room) => [
      {
        type: "TextBody",
        text: String(room.name).slice(0, 80),
      },
      {
        type: "Image",
        src: room.imageBase64,
        height: 160,
        "scale-type": "cover",
      },
      ...(room.detail
        ? [{
            type: "TextCaption",
            text: room.detail,
          }]
        : []),
    ]),
  ];
}

/**
 * Generates the Flow JSON based on the booking configuration.
 */
export function generateBookingFlowJson(config) {
  const collectFields = {
    name: config.collectFields?.name !== false,
    phone: config.collectFields?.phone !== false,
    notes: Boolean(config.collectFields?.notes),
  };
  const rooms = (config.rooms || [])
    .filter((room) => room.id && room.name)
    .slice(0, 10)
    .map((room) => ({
      id: room.id,
      name: room.name,
      description: room.description || "",
      imageUrl: room.imageUrl || "",
      imageBase64: room.imageBase64 || "",
      price: room.price ?? null,
      currency: room.currency || "INR",
    }));
  const shouldSelectRoom = Boolean(config.roomSelection && rooms.length);
  const timeSlots = buildTimeSlotOptions(config.availability || {});

  const completePayload = {
    startDate: "${form.booking_date}",
    startTime: timeSlots.length ? "${form.booking_time_slot}" : "${form.booking_time}",
    serviceItemId: shouldSelectRoom ? "${form.service_item_id}" : "${data.serviceItemId}",
    flowConfigId: config.flowConfigId || "booking",
  };

  if (collectFields.name) completePayload.customerName = "${form.customer_name}";
  if (collectFields.phone) completePayload.customerPhone = "${form.customer_phone}";
  if (collectFields.notes) completePayload.notes = "${form.booking_notes}";

  const screens = [];

  // Main Booking Screen
  const mainScreen = {
    id: "BOOKING_FORM",
    title: "Book Appointment",
    terminal: true,
    data: {
      serviceItemId: {
        type: "string",
        __example__: "12345"
      }
    },
    layout: {
      type: "SingleColumnLayout",
      children: [
        ...buildRoomPreviewComponents(rooms),
        {
          type: "Form",
          name: "booking_form",
          children: [
            ...(shouldSelectRoom ? [{
              type: rooms.length <= 3 ? "RadioButtonsGroup" : "Dropdown",
              name: "service_item_id",
              label: "Select a room",
              required: true,
              "data-source": rooms.map((room) => ({
                id: String(room.id),
                title: String(room.name).slice(0, 30),
              })),
            }] : []),
            ...(config.collectFields?.name !== false ? [{
              type: "TextInput",
              name: "customer_name",
              label: "Your Name",
              required: true,
            }] : []),
            ...(config.collectFields?.phone !== false ? [{
              type: "TextInput",
              name: "customer_phone",
              label: "Phone Number",
              "input-type": "phone",
              required: true,
            }] : []),
            {
              type: "DatePicker",
              name: "booking_date",
              label: "Preferred Date",
              required: true,
            },
            ...(timeSlots.length ? [{
              type: timeSlots.length <= 3 ? "RadioButtonsGroup" : "Dropdown",
              name: "booking_time_slot",
              label: "Preferred Time",
              required: true,
              "data-source": timeSlots,
            }] : [{
              type: "TextInput",
              name: "booking_time",
              label: "Preferred Time (HH:MM AM/PM)",
              required: true,
            }]),
            ...(config.collectFields?.notes ? [{
              type: "TextArea",
              name: "booking_notes",
              label: "Any Notes?",
              required: false,
            }] : []),
            {
              type: "Footer",
              label: "Submit Request",
              "on-click-action": {
                name: "complete",
                payload: completePayload
              }
            }
          ]
        }
      ]
    }
  };

  screens.push(mainScreen);

  return {
    version: config.version || env.metaFlowJsonVersion,
    routing_model: {
      BOOKING_FORM: []
    },
    screens
  };
}

/**
 * Creates a flow on WhatsApp.
 */
export async function createFlow(wabaId, accessToken, name) {
  const url = `${BASE_URL}/${wabaId}/flows`;
  const response = await axios.post(
    url,
    {
      name: name.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 30) + "_" + Date.now(),
      categories: ["APPOINTMENT_BOOKING"]
    },
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  return response.data; // { id: "FLOW_ID" }
}

/**
 * Updates flow JSON.
 */
export async function updateFlowAssets(flowId, accessToken, flowJson) {
  const url = `${BASE_URL}/${flowId}/assets`;

  // Write JSON to temp file
  const tempFilePath = path.join(os.tmpdir(), `flow_${flowId}.json`);
  fs.writeFileSync(tempFilePath, JSON.stringify(flowJson));

  const formData = new FormData();
  formData.append("name", "flow.json");
  formData.append("asset_type", "FLOW_JSON");
  formData.append("file", fs.createReadStream(tempFilePath));

  try {
    const response = await axios.post(url, formData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...formData.getHeaders()
      }
    });
    return response.data;
  } finally {
    try {
      fs.unlinkSync(tempFilePath);
    } catch (e) {}
  }
}

/**
 * Publishes the flow.
 */
export async function publishFlow(flowId, accessToken) {
  const url = `${BASE_URL}/${flowId}/publish`;
  const response = await axios.post(
    url,
    {},
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  return response.data;
}
