import { env } from "../config/env.js";
import { WhatsappAccount } from "../models/WhatsappAccount.js";
import { decryptSecret } from "../utils/crypto.js";

const GRAPH_BASE =
  `https://graph.facebook.com/${
    env.metaGraphVersion || "v21.0"
  }`;

async function parseMetaResponse(response) {
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
        `Meta request failed with status ${response.status}`
    );

    error.status = response.status;

    error.meta = {
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

export async function getWhatsappAccountWithToken(
  accountId
) {
  if (!accountId) {
    throw new Error(
      "WhatsApp account ID is required."
    );
  }

  /*
   * These fields are select:false in the model,
   * so they must be explicitly selected here.
   */
  const account =
    await WhatsappAccount.findOne({
      _id: accountId,
      status: "active",
    }).select(
      "+encryptedValue +encryptionIv +encryptionTag +encryptedFlowPrivateKey +flowPrivateKeyIv +flowPrivateKeyTag"
    );

  if (!account) {
    throw new Error(
      "Active WhatsApp account not found."
    );
  }

  if (
    !account.encryptedValue ||
    !account.encryptionIv ||
    !account.encryptionTag
  ) {
    throw new Error(
      `WhatsApp account ${account._id} does not contain a complete encrypted access token.`
    );
  }

  const accessToken = decryptSecret({
    encryptedValue:
      account.encryptedValue,

    encryptionIv:
      account.encryptionIv,

    encryptionTag:
      account.encryptionTag,
  });

  return {
    account,
    accessToken,
  };
}

export async function sendWhatsappPayload(
  accountId,
  payload
) {
  if (
    !payload ||
    typeof payload !== "object"
  ) {
    throw new Error(
      "WhatsApp payload is required."
    );
  }

  const {
    account,
    accessToken,
  } = await getWhatsappAccountWithToken(
    accountId
  );

  const response = await fetch(
    `${GRAPH_BASE}/${account.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${accessToken}`,

        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        messaging_product:
          "whatsapp",
        ...payload,
      }),
    }
  );

  return parseMetaResponse(response);
}

export async function sendWhatsappTemplatePayload(
  accountId,
  to,
  template
) {
  if (!template?.name) {
    throw new Error("WhatsApp template name is required.");
  }

  return sendWhatsappPayload(accountId, {
    to,
    type: "template",
    template: {
      name: template.name,
      language: {
        code: template.language || "en_US",
      },
      ...(template.headerType === "IMAGE" && template.headerImageUrl
        ? {
            components: [
              {
                type: "header",
                parameters: [
                  {
                    type: "image",
                    image: {
                      link: template.headerImageUrl,
                    },
                  },
                ],
              },
            ],
          }
        : {}),
    },
  });
}

function sanitizeOptions(
  options = [],
  limit = 3
) {
  return options
    .slice(0, limit)
    .map((option, index) => ({
      id: String(
        option.id ||
          `option_${index + 1}`
      ).slice(0, 200),

      title: String(
        option.title ||
          `Option ${index + 1}`
      ).slice(0, 20),

      description: String(
        option.description || ""
      ).slice(0, 72),
    }));
}

function hasUrl(text = "") {
  return /https?:\/\/\S+/i.test(String(text || ""));
}

export function buildWhatsappPayload(
  to,
  response
) {
  if (!to) {
    throw new Error(
      "WhatsApp recipient is required."
    );
  }

  const configuredResponse =
    response || {};

  const type =
    configuredResponse.type ||
    "text";

  if (type === "buttons") {
    const options = sanitizeOptions(
      configuredResponse.options,
      3
    );

    if (!options.length) {
      return {
        to,
        type: "text",
        text: {
          body: String(
            configuredResponse.text ||
              "Choose an option"
          ),
          preview_url: hasUrl(configuredResponse.text),
        },
      };
    }

    return {
      to,
      type: "interactive",
      interactive: {
        type: "button",

        ...(configuredResponse.mediaUrl
          ? {
              header: {
                type: "image",
                image: { link: configuredResponse.mediaUrl },
              },
            }
          : configuredResponse.header
          ? {
              header: {
                type: "text",
                text: String(
                  configuredResponse.header
                ).slice(0, 60),
              },
            }
          : {}),

        body: {
          text: String(
            configuredResponse.text ||
              "Choose an option"
          ).slice(0, 1024),
        },

        ...(configuredResponse.footer
          ? {
              footer: {
                text: String(
                  configuredResponse.footer
                ).slice(0, 60),
              },
            }
          : {}),

        action: {
          buttons: options.map(
            (option) => ({
              type: "reply",
              reply: {
                id: option.id,
                title: option.title,
              },
            })
          ),
        },
      },
    };
  }

  if (type === "flow") {
    return {
      to,
      type: "interactive",
      interactive: {
        type: "flow",
        header: configuredResponse.mediaUrl
          ? { type: "image", image: { link: configuredResponse.mediaUrl } }
          : configuredResponse.header
            ? { type: "text", text: String(configuredResponse.header).slice(0, 60) }
            : undefined,
        body: { text: String(configuredResponse.text || "Open form").slice(0, 1024) },
        footer: configuredResponse.footer ? { text: String(configuredResponse.footer).slice(0, 60) } : undefined,
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: configuredResponse.flowConfigId || "flow_token",
            flow_id: configuredResponse.flowId,
            flow_cta: String(configuredResponse.buttonText || "Open Form").slice(0, 20),
            flow_action: "navigate",
            flow_action_payload: {
              screen: "BOOKING_FORM",
              data: configuredResponse.flowData || {}
            }
          }
        }
      }
    };
  }

  if (type === "list") {
    const options = sanitizeOptions(
      configuredResponse.options,
      100
    );

    const rows = options
      .slice(0, 10)
      .map((option) => ({
        id: option.id,
        title: option.title,

        ...(option.description
          ? {
              description:
                option.description,
            }
          : {}),
      }));

    if (!rows.length) {
      return {
        to,
        type: "text",
        text: {
          body: String(
            configuredResponse.text ||
              "No options are available."
          ),
          preview_url: hasUrl(configuredResponse.text),
        },
      };
    }

    return {
      to,
      type: "interactive",
      interactive: {
        type: "list",

        ...(configuredResponse.header
          ? {
              header: {
                type: "text",
                text: String(
                  configuredResponse.header
                ).slice(0, 60),
              },
            }
          : {}),

        body: {
          text: String(
            configuredResponse.text ||
              "Choose an option"
          ).slice(0, 1024),
        },

        ...(configuredResponse.footer
          ? {
              footer: {
                text: String(
                  configuredResponse.footer
                ).slice(0, 60),
              },
            }
          : {}),

        action: {
          button: String(
            configuredResponse.buttonText ||
              "View options"
          ).slice(0, 20),

          sections: [
            {
              title: "Options",
              rows,
            },
          ],
        },
      },
    };
  }

  if (
    ["image", "video", "document"].includes(
      type
    )
  ) {
    if (!configuredResponse.mediaUrl) {
      throw new Error(
        `mediaUrl is required for WhatsApp ${type} messages.`
      );
    }

    return {
      to,
      type,

      [type]: {
        link:
          configuredResponse.mediaUrl,

        ...(configuredResponse.text
          ? {
              caption: String(
                configuredResponse.text
              ).slice(0, 1024),
            }
          : {}),

        ...(type === "document" &&
        configuredResponse.filename
          ? {
              filename:
                configuredResponse.filename,
            }
          : {}),
      },
    };
  }

  return {
    to,
    type: "text",
    text: {
      body: String(
        configuredResponse.text || ""
      ),
      preview_url: hasUrl(configuredResponse.text),
    },
  };
}

export async function sendConfiguredWhatsappResponse(
  accountId,
  to,
  response
) {
  return sendWhatsappPayload(
    accountId,
    buildWhatsappPayload(
      to,
      response
    )
  );
}
