import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { connectWhatsappFromOAuthCode } from "../services/metaWhatsappOAuth.service.js";

const CALLBACK_URL =
  process.env.META_WHATSAPP_REDIRECT_URI ||
  "https://api.wabflow.synqra.in/api/meta/whatsapp/callback";

const APP_DEEPLINK = "wabflow://whatsapp/connect";

export async function createWhatsappConnectState(req, res) {
  const { businessId } = req.body;

  if (!businessId) {
    return res.status(400).json({
      success: false,
      error: "businessId is required.",
    });
  }

  const state = jwt.sign(
    {
      userId: req.userId,
      businessId,
      purpose: "whatsapp_connect",
    },
    env.jwtSecret(),
    { expiresIn: "10m" }
  );

  return res.json({
    success: true,
    state,
    redirectUri: CALLBACK_URL,
  });
}

export async function metaWhatsappCallback(req, res) {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.redirect(
        `${APP_DEEPLINK}?status=error&message=${encodeURIComponent(
          error_description || error
        )}`
      );
    }

    if (!code || !state) {
      return res.redirect(
        `${APP_DEEPLINK}?status=error&message=${encodeURIComponent(
          "Missing code or state"
        )}`
      );
    }

    let payload;

    try {
      payload = jwt.verify(String(state), env.jwtSecret());
    } catch {
      return res.redirect(
        `${APP_DEEPLINK}?status=error&message=${encodeURIComponent(
          "Invalid or expired state"
        )}`
      );
    }

    if (payload.purpose !== "whatsapp_connect") {
      return res.redirect(
        `${APP_DEEPLINK}?status=error&message=${encodeURIComponent(
          "Invalid state purpose"
        )}`
      );
    }

    await connectWhatsappFromOAuthCode({
      code: String(code),
      redirectUri: CALLBACK_URL,
      userId: payload.userId,
      businessId: payload.businessId,
    });

    return res.redirect(`${APP_DEEPLINK}?status=success`);
  } catch (err) {
    console.error("❌ Meta WhatsApp callback failed:", {
      message: err.message,
      meta: err.meta || null,
    });

    return res.redirect(
      `${APP_DEEPLINK}?status=error&message=${encodeURIComponent(
        err.message || "WhatsApp connection failed"
      )}`
    );
  }
}
