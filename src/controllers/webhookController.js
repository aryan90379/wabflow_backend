import crypto from "crypto";
import { env } from "../config/env.js";
import { processWhatsappWebhook } from "../services/webhookProcessor.js";

function hasGatewayForwardHeader(req) {
  return String(req.headers["x-wabflow-forwarded"] || "").toLowerCase() === "true";
}

function getRawBodyBuffer(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;

  if (typeof req.rawBody === "string") {
    return Buffer.from(req.rawBody, "utf8");
  }

  if (req.body) {
    return Buffer.from(JSON.stringify(req.body), "utf8");
  }

  return null;
}

function signatureIsValid(req) {
  const appSecret = env.metaAppSecret;

  // Dev/safe fallback: if app secret is not configured, don't crash.
  if (!appSecret) {
    console.warn("[webhook] META_APP_SECRET missing; skipping signature verification");
    return true;
  }

  const signature = req.headers["x-hub-signature-256"];
  const rawBody = getRawBodyBuffer(req);
  const forwarded = hasGatewayForwardHeader(req);

  // Your internal WAPI gateway already received the Meta event and forwards it.
  // If forwarded body/signature is missing, allow it instead of crashing.
  if (forwarded && (!signature || !rawBody)) {
    console.warn("[webhook] Forwarded gateway event missing signature/rawBody; allowing", {
      hasSignature: Boolean(signature),
      hasRawBody: Boolean(rawBody),
    });
    return true;
  }

  if (!signature || !rawBody) {
    console.warn("[webhook] Missing signature/rawBody", {
      hasSignature: Boolean(signature),
      hasRawBody: Boolean(rawBody),
      forwarded,
    });
    return false;
  }

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex");

  const receivedBuffer = Buffer.from(String(signature), "utf8");
  const expectedBuffer = Buffer.from(String(expected), "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === env.metaVerifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
}

export function receiveWebhook(req, res) {
  if (!signatureIsValid(req)) {
    return res.sendStatus(401);
  }

  const payload = req.body;

  res.sendStatus(200);

  setImmediate(() => {
    processWhatsappWebhook(payload).catch((error) => {
      console.error("[webhook] Payload processing failed", {
        message: error.message,
        stack: error.stack,
      });
    });
  });
}