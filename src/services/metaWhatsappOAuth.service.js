import { Business } from "../models/Business.js";
import { WhatsappAccount } from "../models/WhatsappAccount.js";
import { encryptSecret } from "../utils/crypto.js";

const GRAPH_VERSION =
  process.env.META_GRAPH_VERSION || "v21.0";

const GRAPH_BASE =
  `https://graph.facebook.com/${GRAPH_VERSION}`;

const WHATSAPP_PIN =
  process.env.WHATSAPP_2FA_PIN || "123456";

const safe = (value) => {
  if (!value) {
    return "";
  }

  const str = String(value);

  if (str.length <= 12) {
    return "***";
  }

  return `${str.slice(0, 6)}...${str.slice(-4)}`;
};

const buildUrl = (path, params = {}) => {
  const cleanPath = path.startsWith("/")
    ? path
    : `/${path}`;

  const url = new URL(
    `${GRAPH_BASE}${cleanPath}`
  );

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const readJson = async (
  response,
  label = "Meta API"
) => {
  const raw = await response.text();

  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {
      raw,
    };
  }

  if (!response.ok || data?.error) {
    const metaError = data?.error || {};

    const error = new Error(
      metaError.message ||
        raw ||
        `${label} failed with status ${response.status}`
    );

    error.status = response.status;

    error.meta = {
      label,
      code: metaError.code,
      subcode: metaError.error_subcode,
      type: metaError.type,
      fbtraceId: metaError.fbtrace_id,
    };

    throw error;
  }

  return data;
};

const graphGet = async (
  path,
  accessToken,
  params = {},
  label = "Graph GET"
) => {
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

const getScopeTargets = (
  debugData,
  scopeName
) => {
  const scopes =
    debugData?.data?.granular_scopes || [];

  const found = scopes.find(
    (scope) => scope.scope === scopeName
  );

  return found?.target_ids || [];
};

const exchangeOAuthCode = async ({
  appId,
  appSecret,
  code,
  redirectUri,
}) => {
  const tokenUrl = new URL(
    `${GRAPH_BASE}/oauth/access_token`
  );

  tokenUrl.searchParams.set(
    "client_id",
    appId
  );

  tokenUrl.searchParams.set(
    "client_secret",
    appSecret
  );

  tokenUrl.searchParams.set(
    "redirect_uri",
    redirectUri
  );

  tokenUrl.searchParams.set(
    "code",
    code
  );

  return readJson(
    await fetch(tokenUrl.toString()),
    "Exchange OAuth code"
  );
};

const exchangeLongLivedToken = async ({
  appId,
  appSecret,
  shortToken,
}) => {
  return readJson(
    await fetch(
      buildUrl("/oauth/access_token", {
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      })
    ),
    "Exchange long-lived token"
  );
};

async function debugAccessToken({
  accessToken,
  appId,
  appSecret,
}) {
  const debugData = await readJson(
    await fetch(
      buildUrl("/debug_token", {
        input_token: accessToken,
        access_token: `${appId}|${appSecret}`,
      })
    ),
    "Debug token"
  );

  if (!debugData?.data?.is_valid) {
    throw new Error(
      "Meta returned an invalid access token."
    );
  }

  return debugData;
}

async function resolveWabaId({
  accessToken,
  appId,
  appSecret,
  debugData: suppliedDebugData,
}) {
  const debugData =
    suppliedDebugData ||
    (await debugAccessToken({
      accessToken,
      appId,
      appSecret,
    }));

  const directWabaId = getScopeTargets(
    debugData,
    "whatsapp_business_management"
  )[0];

  if (directWabaId) {
    return {
      wabaId: directWabaId,
      debugData,
    };
  }

  const businessTargets = getScopeTargets(
    debugData,
    "business_management"
  );

  for (const metaBusinessId of businessTargets) {
    for (const edge of [
      "owned_whatsapp_business_accounts",
      "client_whatsapp_business_accounts",
    ]) {
      try {
        const result = await graphGet(
          `/${metaBusinessId}/${edge}`,
          accessToken,
          {
            fields: "id,name",
          },
          `Fetch ${edge}`
        );

        if (result?.data?.[0]?.id) {
          return {
            wabaId: result.data[0].id,
            debugData,
          };
        }
      } catch (error) {
        console.warn(
          "[MetaOAuth] WABA edge skipped",
          {
            metaBusinessId,
            edge,
            error: error.message,
          }
        );
      }
    }
  }

  throw new Error(
    "No WhatsApp Business Account found for this Meta login."
  );
}

async function resolvePhone({
  wabaId,
  accessToken,
}) {
  const phoneData = await graphGet(
    `/${wabaId}/phone_numbers`,
    accessToken,
    {
      fields:
        "id,display_phone_number,verified_name",
    },
    "Fetch WABA phone numbers"
  );

  const selectedPhone =
    phoneData?.data?.find((phone) =>
      String(
        phone.display_phone_number || ""
      ).startsWith("+91")
    ) ||
    phoneData?.data?.[0];

  if (!selectedPhone?.id) {
    throw new Error(
      "No WhatsApp phone number found for this WABA."
    );
  }

  return selectedPhone;
}

async function registerPhone({
  phoneNumberId,
  accessToken,
}) {
  try {
    return await graphPost(
      `/${phoneNumberId}/register`,
      accessToken,
      {
        messaging_product: "whatsapp",
        pin: WHATSAPP_PIN,
      },
      "Register phone number"
    );
  } catch (error) {
    const message = String(
      error.message || ""
    ).toLowerCase();

    if (
      message.includes("already") &&
      message.includes("registered")
    ) {
      return {
        success: true,
        alreadyRegistered: true,
      };
    }

    throw error;
  }
}

function getTokenExpiry(
  tokenData,
  longTokenData
) {
  const expiresIn =
    longTokenData?.expires_in ||
    tokenData?.expires_in;

  if (!expiresIn) {
    return null;
  }

  const seconds = Number(expiresIn);

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return null;
  }

  return new Date(
    Date.now() + seconds * 1000
  );
}

export async function connectWhatsappFromOAuthCode({
  code,
  redirectUri,
  userId,
  businessId,
}) {
  if (!code) {
    throw new Error(
      "Missing Meta OAuth code."
    );
  }

  if (!redirectUri) {
    throw new Error(
      "Missing Meta OAuth redirect URI."
    );
  }

  if (!userId) {
    throw new Error("Missing userId.");
  }

  if (!businessId) {
    throw new Error("Missing businessId.");
  }

  const appId = process.env.META_APP_ID;
  const appSecret =
    process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error(
      "Missing META_APP_ID or META_APP_SECRET."
    );
  }

  const business = await Business.findOne({
    _id: businessId,
    ownerId: userId,
  });

  if (!business) {
    throw new Error(
      "Business not found or access denied."
    );
  }

  console.log(
    "[MetaOAuth] Exchanging code",
    {
      businessId: String(businessId),
      userId: String(userId),
      redirectUri,
    }
  );

  const tokenData =
    await exchangeOAuthCode({
      appId,
      appSecret,
      code,
      redirectUri,
    });

  if (!tokenData?.access_token) {
    throw new Error(
      "Meta did not return an access token."
    );
  }

  let longTokenData = {};

  try {
    longTokenData =
      await exchangeLongLivedToken({
        appId,
        appSecret,
        shortToken:
          tokenData.access_token,
      });
  } catch (error) {
    /*
     * Continue with the original token if Meta does
     * not allow long-lived exchange for this token type.
     */
    console.warn(
      "[MetaOAuth] Long-lived token exchange skipped",
      {
        error: error.message,
        meta: error.meta || null,
      }
    );
  }

  const accessToken =
    longTokenData.access_token ||
    tokenData.access_token;

  console.log(
    "[MetaOAuth] Token ready",
    {
      token: safe(accessToken),
      expiresIn:
        longTokenData.expires_in ||
        tokenData.expires_in ||
        null,
    }
  );

  const debugData =
    await debugAccessToken({
      accessToken,
      appId,
      appSecret,
    });

  const { wabaId } =
    await resolveWabaId({
      accessToken,
      appId,
      appSecret,
      debugData,
    });

  const selectedPhone =
    await resolvePhone({
      wabaId,
      accessToken,
    });

  /*
   * phoneNumberId is globally unique in your schema.
   * Prevent one active business from stealing another
   * business's connected number.
   */
  const linkedElsewhere =
    await WhatsappAccount.findOne({
      phoneNumberId: String(
        selectedPhone.id
      ),
      businessId: {
        $ne: business._id,
      },
      status: "active",
    });

  if (linkedElsewhere) {
    const error = new Error(
      "This WhatsApp number is already connected to another business."
    );

    error.status = 409;
    throw error;
  }

  await registerPhone({
    phoneNumberId: selectedPhone.id,
    accessToken,
  });

  await graphPost(
    `/${wabaId}/subscribed_apps`,
    accessToken,
    {},
    "Subscribe app to WABA"
  );

  /*
   * encryptSecret returns exactly:
   * encryptedValue
   * encryptionIv
   * encryptionTag
   */
  const encryptedToken =
    encryptSecret(accessToken);

  const tokenExpiresAt =
    getTokenExpiry(
      tokenData,
      longTokenData
    );

  const account =
    await WhatsappAccount.findOneAndUpdate(
      {
        phoneNumberId: String(
          selectedPhone.id
        ),
      },
      {
        $set: {
          businessId: business._id,
          wabaId: String(wabaId),
          phoneNumberId: String(
            selectedPhone.id
          ),
          displayPhoneNumber:
            selectedPhone.display_phone_number ||
            "",
          verifiedName:
            selectedPhone.verified_name ||
            "",

          encryptedValue:
            encryptedToken.encryptedValue,

          encryptionIv:
            encryptedToken.encryptionIv,

          encryptionTag:
            encryptedToken.encryptionTag,

          tokenType:
            longTokenData.token_type ||
            tokenData.token_type ||
            "bearer",

          tokenExpiresAt,
          status: "active",
          connectedAt: new Date(),
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

  business.integrations =
    business.integrations || {};

  business.integrations.whatsappConnected =
    true;

  await business.save();

  console.log(
    "[MetaOAuth] WhatsApp connected",
    {
      businessId: String(
        business._id
      ),
      accountId: String(account._id),
      wabaId: String(wabaId),
      phoneNumberId: String(
        selectedPhone.id
      ),
      hasEncryptedToken: Boolean(
        encryptedToken.encryptedValue &&
          encryptedToken.encryptionIv &&
          encryptedToken.encryptionTag
      ),
    }
  );

  return account;
}