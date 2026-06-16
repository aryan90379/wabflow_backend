import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import os from "os";

const GRAPH_VERSION = "v18.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Generates the Flow JSON based on the booking configuration.
 */
export function generateBookingFlowJson(config) {
  const screens = [];

  // Main Booking Screen
  const mainScreen = {
    id: "BOOKING_FORM",
    title: "Book Appointment",
    terminal: true,
    data: {},
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
                payload: {
                  customerName: "${form.customer_name}",
                  customerPhone: "${form.customer_phone}",
                  startDate: "${form.booking_date}",
                  startTime: "${form.booking_time}",
                  notes: "${form.booking_notes}",
                  flowConfigId: config.flowConfigId || "booking"
                }
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
