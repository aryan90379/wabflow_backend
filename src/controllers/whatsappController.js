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

  return res.json({
    success: true,
    accounts,
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

  const profilePictureUrl =
    String(
      req.body
        .profilePictureUrl ||
        ""
    )
      .trim();

  const metaPayload = {
    messaging_product:
      "whatsapp",
    ...(about ? { about } : {}),
    ...(description
      ? { description }
      : {}),
    ...(profilePictureUrl
      ? {
          profile_picture_url:
            profilePictureUrl,
        }
      : {}),
  };

  try {
    if (
      about ||
      description ||
      profilePictureUrl
    ) {
      const {
        accessToken,
      } =
        await getWhatsappAccountWithToken(
          account._id
        );

      await graphPost(
        `/${account.phoneNumberId}/whatsapp_business_profile`,
        accessToken,
        metaPayload,
        "Update WhatsApp business profile"
      );
    }

    account.profileDisplayName =
      displayName;
    account.profileAbout = about;
    account.profileDescription =
      description;
    account.profilePictureUrl =
      profilePictureUrl;

    await account.save();

    return res.json({
      success: true,
      account,
      message:
        "WhatsApp profile updated.",
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
