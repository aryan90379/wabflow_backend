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

/**
 * Generates the Flow JSON based on the booking configuration.
 */
export function generateBookingFlowJson(config) {
  const collectFields = {
    name: config.collectFields?.name !== false,
    phone: config.collectFields?.phone !== false,
    notes: Boolean(config.collectFields?.notes),
  };

  const completePayload = {
    startDate: "${form.booking_date}",
    startTime: "${form.booking_time}",
    serviceItemId: "${data.serviceItemId}",
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
        {
          type: "Form",
          name: "booking_form",
          children: [
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
              input_type: "phone",
              required: true,
            }] : []),
            {
              type: "TextInput",
              name: "booking_date",
              label: "Preferred Date (DD-MM-YYYY)",
              required: true,
            },
            {
              type: "TextInput",
              name: "booking_time",
              label: "Preferred Time (HH:MM AM/PM)",
              required: true,
            },
            ...(config.collectFields?.notes ? [{
              type: "TextInput",
              name: "booking_notes",
              label: "Any Notes?",
              required: false,
            }] : []),
            {
              type: "Footer",
              label: "Submit Request",
              on_click_action: {
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
    version: "3.1",
    data_api_version: "3.0",
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
