import { env } from "../config/env.js";
import { WhatsappAccount } from "../models/WhatsappAccount.js";
import { encryptSecret } from "../utils/crypto.js";
import { getWhatsappAccountWithToken } from "../services/whatsappClient.js";

const GRAPH_BASE =
  `https://graph.facebook.com/${
    env.metaGraphVersion || "v21.0"
  }`;

const safe = (value) => {
  if (!value) {
    return "";
  }

  const str = String(value);

  return str.length <= 12
    ? "***"
    : `${str.slice(0, 6)}...${str.slice(-4)}`;
};

const buildUrl = (
  path,
  params = {}
) => {
  const url = new URL(
    `${GRAPH_BASE}${
      path.startsWith("/")
        ? path
        : `/${path}`
    }`
  );

  for (
    const [key, value]
    of Object.entries(params)
  ) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      url.searchParams.set(
        key,
        String(value)
      );
    }
  }

  return url.toString();
};

async function readJson(
  response,
  label
) {
  const raw = await response.text();

  let data = {};

  try {
    data = raw
      ? JSON.parse(raw)
      : {};
  } catch {
    data = {
      raw,
    };
  }

  if (
    !response.ok ||
    data?.error
  ) {
    const metaError =
      data?.error || {};

    const error = new Error(
      metaError.message ||
        `${label} failed with status ${response.status}`
    );

    error.status =
      response.status;

    error.meta = {
      label,
      code: metaError.code,
      subcode:
        metaError.error_subcode,
      type: metaError.type,
      fbtraceId:
        metaError.fbtrace_id,
    };

    throw error;
  }

  return data;
}

const graphGet = async (
  path,
  token,
  params = {},
  label = "Graph GET"
) => {
  return readJson(
    await fetch(
      buildUrl(path, {
        ...params,
        access_token: token,
      })
    ),
    label
  );
};

const graphPost = async (
  path,
  token,
  body = {},
  label = "Graph POST"
) => {
  return readJson(
    await fetch(
      buildUrl(path),
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${token}`,

          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify(body),
      }
    ),
    label
  );
};

const normalizeDisplayName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const displayNamesMatch = (first, second) =>
  Boolean(first && second) &&
  normalizeDisplayName(first) === normalizeDisplayName(second);

function syncOfficialDisplayNameRequest(account) {
  const requested =
    account.officialDisplayNameRequested ||
    account.profileDisplayName ||
    "";

  if (!requested) {
    account.officialDisplayNameRequestStatus = "none";
    account.officialDisplayNameApprovedAt = null;
    return;
  }

  if (displayNamesMatch(requested, account.verifiedName)) {
    account.officialDisplayNameRequestStatus = "approved";
    account.officialDisplayNameApprovedAt =
      account.officialDisplayNameApprovedAt || new Date();
    return;
  }

  account.officialDisplayNameRequestStatus = "pending";
  account.officialDisplayNameApprovedAt = null;
}

function consumeOfficialDisplayNameChangeSlot(account, requestedName) {
  const limit = env.whatsappDisplayNameChangeLimit;

  if (!limit || limit < 1) {
    return;
  }

  const windowDays =
    env.whatsappDisplayNameChangeWindowDays || 30;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const now = new Date();
  const windowStart =
    account.officialDisplayNameChangeWindowStart;

  if (
    !windowStart ||
    now.getTime() - windowStart.getTime() >= windowMs
  ) {
    account.officialDisplayNameChangeWindowStart = now;
    account.officialDisplayNameChangeCount = 0;
  }

  if (account.officialDisplayNameChangeCount >= limit) {
    const error = new Error(
      `Official WhatsApp name can only be requested ${limit} time${
        limit === 1 ? "" : "s"
      } every ${windowDays} days.`
    );
    error.status = 429;
    throw error;
  }

  account.officialDisplayNameChangeCount =
    (account.officialDisplayNameChangeCount || 0) + 1;
  account.officialDisplayNameRequestedAt = now;
  account.officialDisplayNameRequested = requestedName;
}

/**
 * Checks whether the WABA (WhatsApp Business Account) associated with this
 * WhatsApp account has a payment method attached in Meta Business Manager.
 *
 * Meta's Graph API exposes this via:
 *   GET /{waba-id}?fields=payment_method_attached
 *
 * We cache the result on the account document for 6 hours to avoid
 * making redundant API calls on every list request.
 */
async function checkWabaPaymentMethod(account, accessToken) {
  // Meta's Graph API does not currently expose a boolean for payment method attached 
  // on the WABA object. Attempting to query `payment_method_attached` results in a 
  // GraphMethodException (#100).
  //
  // To avoid spamming the logs with API errors, we will bypass this check. 
  // You should rely on Webhooks (`payment_configuration_update`) or the Meta Business Suite UI 
  // to track payment status.
  
  /*
  // Original broken code:
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const lastChecked = account.hasPaymentMethodCheckedAt;
  if (lastChecked && Date.now() - lastChecked.getTime() < SIX_HOURS_MS) {
    return; 
  }

  if (!account.wabaId) return;

  try {
    const wabaData = await graphGet(
      `/${account.wabaId}`,
      accessToken,
      { fields: "id,payment_method_attached" }, // THIS FIELD DOES NOT EXIST
      "Check WABA payment method"
    );

    const hasPayment = wabaData?.payment_method_attached;
    account.hasPaymentMethod = typeof hasPayment === "boolean" ? hasPayment : null;
    account.hasPaymentMethodCheckedAt = new Date();
  } catch (error) {
    console.warn("[wa-payment] Could not check WABA payment method", {
      accountId: String(account._id),
      wabaId: account.wabaId,
      error: error.message,
    });
  }
  */
}

async function refreshWhatsappAccountIdentity(account) {
  if (!account || account.status !== "active") {
    return account;
  }

  try {
    const { accessToken } =
      await getWhatsappAccountWithToken(account._id);

    const phone = await graphGet(
      `/${account.phoneNumberId}`,
      accessToken,
      {
        fields:
          "id,display_phone_number,verified_name",
      },
      "Refresh WhatsApp phone identity"
    );

    account.displayPhoneNumber =
      phone?.display_phone_number ||
      account.displayPhoneNumber ||
      "";
    account.verifiedName =
      phone?.verified_name || account.verifiedName || "";
    account.officialDisplayNameLastSyncedAt = new Date();

    const profile = await graphGet(
      `/${account.phoneNumberId}/whatsapp_business_profile`,
      accessToken,
      {
        fields:
          "about,address,description,email,profile_picture_url,websites,vertical",
      },
      "Refresh WhatsApp business profile"
    );

    const metaProfile =
      Array.isArray(profile?.data) ? profile.data[0] : null;

    if (metaProfile) {
      account.profileAbout =
        metaProfile.about || account.profileAbout || "";
      account.profileDescription =
        metaProfile.description || account.profileDescription || "";
      account.profilePictureUrl =
        metaProfile.profile_picture_url || account.profilePictureUrl || "";
      account.profileAddress =
        metaProfile.address || account.profileAddress || "";
      account.profileEmail =
        metaProfile.email || account.profileEmail || "";
      account.profileWebsites =
        Array.isArray(metaProfile.websites)
          ? metaProfile.websites.filter(Boolean)
          : account.profileWebsites || [];
      account.profileVertical =
        metaProfile.vertical || account.profileVertical || "";
    }

    syncOfficialDisplayNameRequest(account);

    // Check payment method (cached for 6 h — non-fatal)
    await checkWabaPaymentMethod(account, accessToken);

    await account.save();
  } catch (error) {
    console.warn(
      "[wa-profile] Could not refresh Meta display name",
      {
        accountId: String(account._id),
        phoneNumberId: account.phoneNumberId,
        error: error.message,
        meta: error.meta || null,
      }
    );
  }

  return account;
}

function imageContentTypeFromUrl(url = "") {
  const lower = String(url || "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function createMetaUploadSession({
  accessToken,
  fileLength,
  fileType,
}) {
  if (!env.metaAppId) {
    throw new Error("META_APP_ID is required to upload WhatsApp profile pictures.");
  }

  return readJson(
    await fetch(
      buildUrl(`/${env.metaAppId}/uploads`, {
        file_length: fileLength,
        file_type: fileType,
        access_token: accessToken,
      }),
      { method: "POST" }
    ),
    "Create Meta upload session"
  );
}

async function uploadMetaFileBytes({
  accessToken,
  uploadSessionId,
  buffer,
}) {
  const result = await readJson(
    await fetch(
      buildUrl(`/${uploadSessionId}`),
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_offset: "0",
          "Content-Type": "application/octet-stream",
        },
        body: buffer,
      }
    ),
    "Upload Meta file bytes"
  );

  if (!result.h) {
    throw new Error("Meta upload did not return a profile picture handle.");
  }

  return result.h;
}

async function uploadWhatsappProfilePictureHandle(profilePictureUrl, accessToken) {
  const imageResponse = await fetch(profilePictureUrl);
  if (!imageResponse.ok) {
    throw new Error(`Could not fetch profile picture URL. Status ${imageResponse.status}`);
  }

  const contentType =
    imageResponse.headers.get("content-type")?.split(";")[0]?.trim() ||
    imageContentTypeFromUrl(profilePictureUrl);

  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(contentType)) {
    throw new Error(`WhatsApp profile picture must be a JPEG, PNG, or WebP image. Got ${contentType}.`);
  }

  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  const uploadSession = await createMetaUploadSession({
    accessToken,
    fileLength: buffer.length,
    fileType: contentType.replace("image/jpg", "image/jpeg"),
  });

  return uploadMetaFileBytes({
    accessToken,
    uploadSessionId: uploadSession.id,
    buffer,
  });
}

function scopeTargets(
  debugData,
  scopeName
) {
  const scope =
    (
      debugData?.data
        ?.granular_scopes || []
    ).find(
      (item) =>
        item.scope === scopeName
    );

  return scope?.target_ids || [];
}

async function exchangeCode(
  code,
  redirectUri = ""
) {
  const tokenUrl = new URL(
    `${GRAPH_BASE}/oauth/access_token`
  );

  tokenUrl.searchParams.set(
    "client_id",
    env.metaAppId
  );

  tokenUrl.searchParams.set(
    "client_secret",
    env.metaAppSecret
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
    await fetch(tokenUrl),
    "Exchange authorization code"
  );
}

async function exchangeLongLivedToken(
  shortToken
) {
  return readJson(
    await fetch(
      buildUrl(
        "/oauth/access_token",
        {
          grant_type:
            "fb_exchange_token",

          client_id:
            env.metaAppId,

          client_secret:
            env.metaAppSecret,

          fb_exchange_token:
            shortToken,
        }
      )
    ),
    "Exchange long-lived token"
  );
}

async function resolveWabaId({
  debugData,
  accessToken,
  suppliedWabaId,
}) {
  if (suppliedWabaId) {
    return String(
      suppliedWabaId
    );
  }

  const directTargets =
    scopeTargets(
      debugData,
      "whatsapp_business_management"
    );

  if (directTargets.length) {
    return String(
      directTargets[0]
    );
  }

  const businessTargets =
    scopeTargets(
      debugData,
      "business_management"
    );

  for (
    const metaBusinessId
    of businessTargets
  ) {
    for (const edge of [
      "owned_whatsapp_business_accounts",
      "client_whatsapp_business_accounts",
    ]) {
      try {
        const result =
          await graphGet(
            `/${metaBusinessId}/${edge}`,
            accessToken,
            {
              fields: "id,name",
            },
            `Fetch ${edge}`
          );

        if (
          result?.data?.[0]?.id
        ) {
          return String(
            result.data[0].id
          );
        }
      } catch (error) {
        console.warn(
          "[wa-connect] WABA edge skipped",
          {
            metaBusinessId,
            edge,
            error:
              error.message,
          }
        );
      }
    }
  }

  return null;
}

function getTokenExpiry(
  shortTokenData,
  longTokenData
) {
  const expiresIn =
    longTokenData?.expires_in ||
    shortTokenData?.expires_in;

  if (!expiresIn) {
    return null;
  }

  const seconds =
    Number(expiresIn);

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return null;
  }

  return new Date(
    Date.now() +
      seconds * 1000
  );
}

export async function connectWhatsApp(
  req,
  res
) {
  const flowId =
    `wa_${Date.now()}`;

  try {
    const code =
      req.body.code;

    const redirectUri =
      req.body.redirectUri ||
      req.body.redirect_uri ||
      "";

    let wabaId =
      req.body.wabaId ||
      req.body.waba_id ||
      req.body
        .whatsappBusinessAccountId ||
      null;

    let phoneNumberId =
      req.body.phoneNumberId ||
      req.body.phone_number_id ||
      req.body
        .businessPhoneNumberId ||
      null;

    if (!code) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Meta authorization code is required.",
        });
    }

    if (
      !env.metaAppId ||
      !env.metaAppSecret
    ) {
      return res
        .status(500)
        .json({
          success: false,
          error:
            "META_APP_ID and META_APP_SECRET are required.",
        });
    }

    console.log(
      `[${flowId}] WhatsApp connection started`,
      {
        businessId: String(
          req.business._id
        ),
        wabaId,
        phoneNumberId,
        redirectUri:
          redirectUri ||
          "(blank)",
      }
    );

    const shortTokenData =
      await exchangeCode(
        code,
        redirectUri
      );

    if (
      !shortTokenData
        ?.access_token
    ) {
      throw new Error(
        "Meta did not return an access token."
      );
    }

    let longTokenData = {};

    try {
      longTokenData =
        await exchangeLongLivedToken(
          shortTokenData
            .access_token
        );
    } catch (error) {
      console.warn(
        `[${flowId}] Long-lived token exchange skipped`,
        {
          error:
            error.message,
          meta:
            error.meta ||
            null,
        }
      );
    }

    const accessToken =
      longTokenData
        .access_token ||
      shortTokenData
        .access_token;

    console.log(
      `[${flowId}] Token ready`,
      {
        token:
          safe(accessToken),
      }
    );

    const debugData =
      await readJson(
        await fetch(
          buildUrl(
            "/debug_token",
            {
              input_token:
                accessToken,

              access_token:
                `${env.metaAppId}|${env.metaAppSecret}`,
            }
          )
        ),
        "Debug token"
      );

    if (
      !debugData?.data
        ?.is_valid
    ) {
      throw new Error(
        "Meta returned an invalid access token."
      );
    }

    wabaId =
      await resolveWabaId({
        debugData,
        accessToken,
        suppliedWabaId:
          wabaId,
      });

    if (!wabaId) {
      throw new Error(
        "Could not resolve a WhatsApp Business Account ID."
      );
    }

    let selectedPhone;

    if (phoneNumberId) {
      phoneNumberId =
        String(phoneNumberId);

      selectedPhone =
        await graphGet(
          `/${phoneNumberId}`,
          accessToken,
          {
            fields:
              "id,display_phone_number,verified_name",
          },
          "Fetch selected phone"
        );
    } else {
      const phones =
        await graphGet(
          `/${wabaId}/phone_numbers`,
          accessToken,
          {
            fields:
              "id,display_phone_number,verified_name",
          },
          "Fetch WABA phone numbers"
        );

      selectedPhone =
        phones?.data?.[0];

      phoneNumberId =
        selectedPhone?.id
          ? String(
              selectedPhone.id
            )
          : null;
    }

    if (
      !selectedPhone?.id ||
      !phoneNumberId
    ) {
      throw new Error(
        "No WhatsApp phone number was found."
      );
    }

    const linkedElsewhere =
      await WhatsappAccount.findOne({
        phoneNumberId,
        businessId: {
          $ne:
            req.business._id,
        },
        status: "active",
      });

    if (linkedElsewhere) {
      return res
        .status(409)
        .json({
          success: false,
          error:
            "This WhatsApp number is already connected to another business.",
        });
    }

    try {
      await graphPost(
        `/${phoneNumberId}/register`,
        accessToken,
        {
          messaging_product:
            "whatsapp",

          pin:
            env.whatsappPin ||
            "123456",
        },
        "Register phone number"
      );
    } catch (error) {
      const message =
        String(
          error.message || ""
        ).toLowerCase();

      if (
        !(
          message.includes(
            "already"
          ) &&
          message.includes(
            "registered"
          )
        )
      ) {
        throw error;
      }
    }

    await graphPost(
      `/${wabaId}/subscribed_apps`,
      accessToken,
      {},
      "Subscribe app to WABA"
    );

    const encryptedToken =
      encryptSecret(
        accessToken
      );

    const tokenExpiresAt =
      getTokenExpiry(
        shortTokenData,
        longTokenData
      );

    const account =
      await WhatsappAccount
        .findOneAndUpdate(
          {
            phoneNumberId,
          },
          {
            $set: {
              businessId:
                req.business._id,

              wabaId:
                String(wabaId),

              phoneNumberId,

              displayPhoneNumber:
                selectedPhone
                  .display_phone_number ||
                "",

              verifiedName:
                selectedPhone
                  .verified_name ||
                "",

              encryptedValue:
                encryptedToken
                  .encryptedValue,

              encryptionIv:
                encryptedToken
                  .encryptionIv,

              encryptionTag:
                encryptedToken
                  .encryptionTag,

              tokenType:
                longTokenData
                  .token_type ||
                shortTokenData
                  .token_type ||
                "bearer",

              tokenExpiresAt,
              connectedAt:
                new Date(),

              status: "active",
            },
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert:
              true,
            runValidators:
              true,
          }
        );

    await refreshWhatsappAccountIdentity(account);

    req.business.integrations =
      req.business
        .integrations || {};

    req.business
      .integrations
      .whatsappConnected =
      true;

    await req.business.save();

    console.log(
      `[${flowId}] WhatsApp connection completed`,
      {
        businessId:
          String(
            req.business._id
          ),

        accountId:
          String(account._id),

        wabaId:
          String(wabaId),

        phoneNumberId,

        hasEncryptedToken:
          Boolean(
            encryptedToken
              .encryptedValue &&
              encryptedToken
                .encryptionIv &&
              encryptedToken
                .encryptionTag
          ),
      }
    );

    return res.json({
      success: true,

      account: {
        _id:
          account._id,

        businessId:
          account.businessId,

        wabaId:
          account.wabaId,

        phoneNumberId:
          account.phoneNumberId,

        displayPhoneNumber:
          account
            .displayPhoneNumber,

        verifiedName:
          account.verifiedName,

        status:
          account.status,

        connectedAt:
          account.connectedAt,
      },
    });
  } catch (error) {
    console.error(
      `[${flowId}] WhatsApp connection failed`,
      {
        message:
          error.message,

        meta:
          error.meta ||
          null,

        stack:
          error.stack,
      }
    );

    return res
      .status(
        error.status ||
          500
      )
      .json({
        success: false,

        error:
          error.message ||
          "WhatsApp connection failed.",

        ...(
          process.env
            .NODE_ENV !==
            "production" &&
          error.meta
            ? {
                meta:
                  error.meta,
              }
            : {}
        ),
      });
  }
}

export async function listWhatsappAccounts(
  req,
  res
) {
  /*
   * Encryption fields remain excluded automatically
   * because they have select:false in the schema.
   */
  const accounts =
    await WhatsappAccount
      .find({
        businessId:
          req.business._id,
      })
      .sort({
        connectedAt: -1,
      });

  const refreshedAccounts =
    await Promise.all(
      accounts.map((account) =>
        refreshWhatsappAccountIdentity(account)
      )
    );

  return res.json({
    success: true,
    accounts: refreshedAccounts,
  });
}

export async function disconnectWhatsappAccount(
  req,
  res
) {
  /*
   * Do not set required token fields to undefined.
   * Do not call document.save() after removing them.
   *
   * An atomic update changes only status and leaves
   * the encrypted token fields valid in the document.
   */
  const account =
    await WhatsappAccount
      .findOneAndUpdate(
        {
          _id:
            req.params
              .accountId,

          businessId:
            req.business._id,
        },
        {
          $set: {
            status:
              "disconnected",
          },
        },
        {
          new: true,
        }
      );

  if (!account) {
    return res
      .status(404)
      .json({
        success: false,
        error:
          "WhatsApp account not found.",
      });
  }

  const activeCount =
    await WhatsappAccount
      .countDocuments({
        businessId:
          req.business._id,

        status:
          "active",
      });

  req.business.integrations =
    req.business
      .integrations || {};

  req.business
    .integrations
    .whatsappConnected =
    activeCount > 0;

  await req.business.save();

  console.log(
    "[wa-disconnect] WhatsApp account disconnected locally",
    {
      businessId:
        String(
          req.business._id
        ),

      accountId:
        String(account._id),

      phoneNumberId:
        account.phoneNumberId,
    }
  );

  return res.json({
    success: true,

    message:
      "WhatsApp account disconnected locally.",

    account: {
      _id:
        account._id,

      phoneNumberId:
        account.phoneNumberId,

      displayPhoneNumber:
        account
          .displayPhoneNumber,

      verifiedName:
        account.verifiedName,

      status:
        account.status,
    },
  });
}

export async function updateWhatsappBusinessProfile(
  req,
  res
) {
  const account =
    await WhatsappAccount.findOne({
      _id:
        req.params.accountId,
      businessId:
        req.business._id,
      status: "active",
    });

  if (!account) {
    return res
      .status(404)
      .json({
        success: false,
        error:
          "Active WhatsApp account not found.",
      });
  }

  const displayName =
    String(
      req.body
        .displayName ||
        ""
    )
      .trim()
      .slice(0, 80);

  const about =
    String(
      req.body.about ||
        ""
    )
      .trim()
      .slice(0, 139);

  const description =
    String(
      req.body
        .description ||
        ""
    )
    .trim()
      .slice(0, 512);

  const address =
    String(
      req.body.address ||
        ""
    )
      .trim()
      .slice(0, 256);

  const email =
    String(
      req.body.email ||
        ""
    )
      .trim()
      .slice(0, 128);

  const websites = Array.isArray(req.body.websites)
    ? req.body.websites
    : req.body.website
      ? [req.body.website]
      : [];

  const cleanWebsites =
    websites
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 2);

  const vertical =
    String(
      req.body.vertical ||
        ""
    )
      .trim()
      .slice(0, 64);

  const hasProfilePictureUrl =
    Object.prototype.hasOwnProperty.call(
      req.body,
      "profilePictureUrl"
    );

  const profilePictureUrl =
    hasProfilePictureUrl
      ? String(
          req.body
            .profilePictureUrl ||
            ""
        )
          .trim()
      : "";

  const previousRequestedName =
    account.officialDisplayNameRequested ||
    account.profileDisplayName ||
    account.verifiedName ||
    "";

  const officialNameChanged =
    Boolean(displayName) &&
    !displayNamesMatch(
      displayName,
      previousRequestedName
    );

  const baseMetaPayload = {
    messaging_product:
      "whatsapp",
    ...(about ? { about } : {}),
    ...(address ? { address } : {}),
    ...(description
      ? { description }
      : {}),
    ...(email ? { email } : {}),
    ...(cleanWebsites.length
      ? { websites: cleanWebsites }
      : {}),
    ...(vertical ? { vertical } : {}),
  };

  try {
    if (
      about ||
      address ||
      description ||
      email ||
      cleanWebsites.length ||
      vertical ||
      profilePictureUrl
    ) {
      const {
        accessToken,
      } =
        await getWhatsappAccountWithToken(
          account._id
        );

      const metaPayload = {
        ...baseMetaPayload,
      };

      let profilePictureHandle = "";
      if (profilePictureUrl) {
        profilePictureHandle =
          await uploadWhatsappProfilePictureHandle(
            profilePictureUrl,
            accessToken
          );
        metaPayload.profile_picture_handle =
          profilePictureHandle;
      }

      await graphPost(
        `/${account.phoneNumberId}/whatsapp_business_profile`,
        accessToken,
        metaPayload,
        "Update WhatsApp business profile"
      );

      const refreshedProfile = await graphGet(
        `/${account.phoneNumberId}/whatsapp_business_profile`,
        accessToken,
        {
          fields:
            "about,address,description,email,profile_picture_url,websites,vertical",
        },
        "Fetch WhatsApp business profile"
      );

      console.log("[wa-profile] Meta profile after update", {
        accountId: String(account._id),
        requestedProfilePictureUrl: profilePictureUrl || "",
        profilePictureHandle: safe(profilePictureHandle),
        metaProfilePictureUrl:
          refreshedProfile?.data?.[0]
            ?.profile_picture_url ||
          "",
      });

      const metaProfile =
        Array.isArray(refreshedProfile?.data)
          ? refreshedProfile.data[0]
          : null;

      if (metaProfile) {
        account.profileAbout =
          metaProfile.about || about;
        account.profileDescription =
          metaProfile.description || description;
        account.profilePictureUrl =
          metaProfile.profile_picture_url ||
          profilePictureUrl ||
          account.profilePictureUrl ||
          "";
        account.profileAddress =
          metaProfile.address || address;
        account.profileEmail =
          metaProfile.email || email;
        account.profileWebsites =
          Array.isArray(metaProfile.websites)
            ? metaProfile.websites.filter(Boolean)
            : cleanWebsites;
        account.profileVertical =
          metaProfile.vertical || vertical;
      }
    }

    if (
      officialNameChanged &&
      !displayNamesMatch(
        displayName,
        account.verifiedName
      )
    ) {
      consumeOfficialDisplayNameChangeSlot(
        account,
        displayName
      );
    } else if (displayName) {
      account.officialDisplayNameRequested =
        displayName;
    }

    account.profileDisplayName =
      displayName;
    syncOfficialDisplayNameRequest(
      account
    );
    account.profileAbout = about || account.profileAbout || "";
    account.profileDescription =
      description || account.profileDescription || "";
    account.profileAddress = address || account.profileAddress || "";
    account.profileEmail = email || account.profileEmail || "";
    account.profileWebsites =
      cleanWebsites.length ? cleanWebsites : account.profileWebsites || [];
    account.profileVertical = vertical || account.profileVertical || "";
    
    const storedProfilePictureUrl =
      account.profilePictureUrl || "";

    if (profilePictureUrl && storedProfilePictureUrl !== profilePictureUrl) {
      account.profilePictureChangeCount = (account.profilePictureChangeCount || 0) + 1;
      account.profilePictureLastUpdatedAt = new Date();
      account.profilePictureUpdateStatus = "success";
    }
    
    if (hasProfilePictureUrl && !storedProfilePictureUrl) {
      account.profilePictureUrl =
        profilePictureUrl || "";
    }

    await account.save();

    return res.json({
      success: true,
      account,
      message:
        account
          .officialDisplayNameRequestStatus ===
        "pending"
          ? "WhatsApp profile updated. Official name request is saved here and will show in WhatsApp after Meta approval."
          : "WhatsApp profile updated.",
    });
  } catch (error) {
    console.error(
      "[wa-profile] Update failed",
      {
        businessId:
          String(
            req.business._id
          ),
        accountId:
          String(account._id),
        error:
          error.message,
        meta:
          error.meta ||
          null,
      }
    );

    return res
      .status(
        error.status ||
          500
      )
      .json({
        success: false,
        error:
          error.message ||
          "Could not update WhatsApp profile.",
        ...(
          process.env
            .NODE_ENV !==
            "production" &&
          error.meta
            ? {
                meta:
                  error.meta,
              }
            : {}
        ),
      });
  }
}
