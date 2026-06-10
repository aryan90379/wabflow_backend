import { User } from "../models/User.js";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const WHATSAPP_PIN = process.env.WHATSAPP_2FA_PIN || "123456";

const safe = (value) => {
  if (!value) return "";
  const str = String(value);
  if (str.length <= 12) return "***";
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
};

const buildUrl = (path, params = {}) => {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${GRAPH_BASE}${cleanPath}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const readJson = async (res, label = "Meta API") => {
  const raw = await res.text();

  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!res.ok || data?.error) {
    const metaError = data?.error || {};
    const err = new Error(
      metaError.message || raw || `${label} failed with status ${res.status}`
    );

    err.status = res.status;
    err.meta = {
      label,
      code: metaError.code,
      subcode: metaError.error_subcode,
      type: metaError.type,
      fbtrace_id: metaError.fbtrace_id,
    };

    throw err;
  }

  return data;
};

const graphGet = async (path, accessToken, params = {}, label = "Graph GET") => {
  return readJson(
    await fetch(
      buildUrl(path, {
        ...params,
        access_token: accessToken,
      })
    ),
    label
  );
};

const graphPost = async (
  path,
  accessToken,
  body = {},
  label = "Graph POST"
) => {
  return readJson(
    await fetch(buildUrl(path), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    label
  );
};

const getScopeTargets = (debugData, scopeName) => {
  const scopes = debugData?.data?.granular_scopes || [];
  const found = scopes.find((s) => s.scope === scopeName);
  return found?.target_ids || [];
};

const exchangeCodeWithBlankRedirectUri = async ({
  appId,
  appSecret,
  code,
  flowId,
}) => {
  /**
   * IMPORTANT:
   * Your frontend uses Facebook JS SDK FB.login({ response_type: "code" }).
   * For this flow Meta expects redirect_uri to be exactly blank during code exchange.
   *
   * Do NOT use buildUrl() here because buildUrl() intentionally removes empty strings.
   */
  const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", "");
  tokenUrl.searchParams.set("code", code);

  console.log(`[${flowId}] Exchanging auth code`, {
    redirectUriMode: "blank",
    urlHasRedirectUri: tokenUrl.toString().includes("redirect_uri="),
  });

  return readJson(await fetch(tokenUrl.toString()), "Exchange auth code");
};

export const connectWhatsApp = async (req, res) => {
  const flowId = `wa_${Date.now()}`;

  console.log(`\n[${flowId}] WhatsApp connect started`);

  try {
    const code = req.body?.code;

    let wabaId =
      req.body?.wabaId ||
      req.body?.waba_id ||
      req.body?.whatsappBusinessAccountId ||
      null;

    let phoneNumberId =
      req.body?.phoneNumberId ||
      req.body?.phone_number_id ||
      req.body?.businessPhoneNumberId ||
      null;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: "Missing Meta authorization code",
      });
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
      return res.status(500).json({
        success: false,
        error: "Missing META_APP_ID or META_APP_SECRET",
      });
    }

    console.log(`[${flowId}] Input`, {
      hasCode: Boolean(code),
      wabaId: wabaId || null,
      phoneNumberId: phoneNumberId || null,
      metaRedirectUriEnv: process.env.META_REDIRECT_URI || "blank",
    });

    // 1. Exchange authorization code for access token.
    // Must include redirect_uri= blank for your JS SDK flow.
    const tokenData = await exchangeCodeWithBlankRedirectUri({
      appId,
      appSecret,
      code,
      flowId,
    });

    console.log(`[${flowId}] Short token received`, {
      token: safe(tokenData.access_token),
    });

    // 2. Upgrade short token to long-lived token.
    const longTokenData = await readJson(
      await fetch(
        buildUrl("/oauth/access_token", {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: tokenData.access_token,
        })
      ),
      "Exchange long-lived token"
    );

    const accessToken = longTokenData.access_token || tokenData.access_token;

    console.log(`[${flowId}] Long token ready`, {
      token: safe(accessToken),
      expiresIn: longTokenData.expires_in || null,
    });

    // 3. Debug token.
    const debugData = await readJson(
      await fetch(
        buildUrl("/debug_token", {
          input_token: accessToken,
          access_token: `${appId}|${appSecret}`,
        })
      ),
      "Debug token"
    );

    const scopes = debugData?.data?.granular_scopes || [];

    console.log(`[${flowId}] Token debug`, {
      appId: debugData?.data?.app_id,
      isValid: debugData?.data?.is_valid,
      scopes: scopes.map((s) => ({
        scope: s.scope,
        targets: s.target_ids || [],
      })),
    });

    // 4. Prefer WABA from frontend Embedded Signup.
    if (!wabaId) {
      const wabaTargets = getScopeTargets(
        debugData,
        "whatsapp_business_management"
      );

      if (wabaTargets.length) {
        wabaId = wabaTargets[0];
        console.log(`[${flowId}] WABA found from granular scope`, { wabaId });
      }
    }

    // 5. Last-resort fallback through Business object edges.
    // Never use /me/whatsapp_business_accounts.
    if (!wabaId) {
      const businessTargets = getScopeTargets(debugData, "business_management");

      for (const businessId of businessTargets) {
        try {
          const owned = await graphGet(
            `/${businessId}/owned_whatsapp_business_accounts`,
            accessToken,
            { fields: "id,name" },
            "Fetch owned WABAs"
          );

          if (owned?.data?.length) {
            wabaId = owned.data[0].id;
            console.log(`[${flowId}] WABA found from owned edge`, {
              businessId,
              wabaId,
            });
            break;
          }
        } catch (err) {
          console.warn(`[${flowId}] owned WABA lookup skipped`, {
            businessId,
            error: err.message,
            meta: err.meta || null,
          });
        }

        try {
          const client = await graphGet(
            `/${businessId}/client_whatsapp_business_accounts`,
            accessToken,
            { fields: "id,name" },
            "Fetch client WABAs"
          );

          if (client?.data?.length) {
            wabaId = client.data[0].id;
            console.log(`[${flowId}] WABA found from client edge`, {
              businessId,
              wabaId,
            });
            break;
          }
        } catch (err) {
          console.warn(`[${flowId}] client WABA lookup skipped`, {
            businessId,
            error: err.message,
            meta: err.meta || null,
          });
        }
      }
    }

    if (!wabaId) {
      throw new Error(
        "Missing WABA ID. Embedded Signup did not return waba_id, and token debug did not contain a usable WABA target."
      );
    }

    console.log(`[${flowId}] Using WABA`, { wabaId });

    // 6. Get phone details.
    let selectedPhone = null;

    if (phoneNumberId) {
      selectedPhone = await graphGet(
        `/${phoneNumberId}`,
        accessToken,
        { fields: "id,display_phone_number,verified_name" },
        "Fetch selected phone"
      );

      console.log(`[${flowId}] Phone fetched from frontend phoneNumberId`, {
        phoneNumberId: selectedPhone.id,
        displayPhoneNumber: selectedPhone.display_phone_number,
      });
    } else {
      const phoneData = await graphGet(
        `/${wabaId}/phone_numbers`,
        accessToken,
        { fields: "id,display_phone_number,verified_name" },
        "Fetch WABA phone numbers"
      );

      console.log(`[${flowId}] Phones found`, {
        count: phoneData?.data?.length || 0,
      });

      selectedPhone =
        phoneData?.data?.find((p) =>
          String(p.display_phone_number || "").startsWith("+91")
        ) || phoneData?.data?.[0];

      phoneNumberId = selectedPhone?.id || null;
    }

    if (!selectedPhone?.id || !phoneNumberId) {
      throw new Error("No WhatsApp phone number found for this WABA");
    }

    console.log(`[${flowId}] Selected phone`, {
      phoneNumberId,
      displayPhoneNumber: selectedPhone.display_phone_number,
      verifiedName: selectedPhone.verified_name || null,
    });

    // 7. Register phone number.
    let registerData = null;

    try {
      registerData = await graphPost(
        `/${phoneNumberId}/register`,
        accessToken,
        {
          messaging_product: "whatsapp",
          pin: WHATSAPP_PIN,
        },
        "Register phone number"
      );

      console.log(`[${flowId}] Phone registered`, registerData);
    } catch (err) {
      const message = String(err.message || "").toLowerCase();

      if (message.includes("already") && message.includes("registered")) {
        console.warn(`[${flowId}] Phone already registered, continuing`, {
          phoneNumberId,
        });
      } else {
        throw err;
      }
    }

    // 8. Subscribe app to WABA webhooks.
    const subscribeData = await graphPost(
      `/${wabaId}/subscribed_apps`,
      accessToken,
      {},
      "Subscribe app to WABA"
    );

    console.log(`[${flowId}] WABA webhook subscription complete`, subscribeData);

    // 9. Save to DB.
    const userId = req.user?.id || req.user?._id || req.userId;

    if (!userId) {
      throw new Error("Missing authenticated user ID");
    }

    await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          whatsappApiDetails: {
            accessToken,
            tokenType: longTokenData.token_type || tokenData.token_type || null,
            expiresIn: longTokenData.expires_in || null,
            wabaId,
            phoneNumberId,
            displayPhoneNumber: selectedPhone.display_phone_number || null,
            verifiedName: selectedPhone.verified_name || null,
            connectedAt: new Date(),
          },
          "integrations.whatsappApi": true,
          "integrations.whatsappPending": false,
        },
      },
      { new: true }
    );

    console.log(`[${flowId}] WhatsApp connect completed`, {
      userId,
      wabaId,
      phoneNumberId,
    });

    return res.json({
      success: true,
      message: "WhatsApp connected and registered",
      wabaId,
      phoneNumberId,
      displayPhoneNumber: selectedPhone.display_phone_number,
      verifiedName: selectedPhone.verified_name || null,
    });
  } catch (error) {
    console.error(`[${flowId}] WhatsApp connect failed`, {
      message: error.message,
      meta: error.meta || null,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
    });

    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      meta: error.meta || null,
    });
  }
};