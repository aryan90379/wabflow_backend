import crypto from "crypto";
import { env } from "../config/env.js";

function getKey() {
  const encodedKey = String(
    env.tokenEncryptionKey || ""
  ).trim();

  if (!encodedKey) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is required to store WhatsApp access tokens"
    );
  }

  if (!/^[a-fA-F0-9]{64}$/.test(encodedKey)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hexadecimal characters"
    );
  }

  return Buffer.from(
    encodedKey,
    "hex"
  );
}

export function encryptSecret(value) {
  if (
    value === undefined ||
    value === null ||
    String(value).length === 0
  ) {
    throw new Error(
      "Cannot encrypt an empty WhatsApp access token"
    );
  }

  const iv = crypto.randomBytes(12);

  const cipher =
    crypto.createCipheriv(
      "aes-256-gcm",
      getKey(),
      iv
    );

  const encrypted = Buffer.concat([
    cipher.update(
      String(value),
      "utf8"
    ),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    encryptedValue:
      encrypted.toString("base64"),

    encryptionIv:
      iv.toString("base64"),

    encryptionTag:
      tag.toString("base64"),
  };
}

export function decryptSecret(
  secret = {}
) {
  const {
    encryptedValue,
    encryptionIv,
    encryptionTag,
  } = secret;

  if (
    !encryptedValue ||
    !encryptionIv ||
    !encryptionTag
  ) {
    throw new Error(
      "Encrypted WhatsApp access token is incomplete: encryptedValue, encryptionIv and encryptionTag are required"
    );
  }

  const decipher =
    crypto.createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(
        String(encryptionIv),
        "base64"
      )
    );

  decipher.setAuthTag(
    Buffer.from(
      String(encryptionTag),
      "base64"
    )
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(
        String(encryptedValue),
        "base64"
      )
    ),
    decipher.final(),
  ]).toString("utf8");
}