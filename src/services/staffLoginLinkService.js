import crypto from "crypto";
import { env } from "../config/env.js";
import { StaffLoginLink } from "../models/StaffLoginLink.js";

const STAFF_LOGIN_LINK_DAYS = 14;
const STAFF_LOGIN_TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const STAFF_LOGIN_TOKEN_LENGTH = 7;

export function hashStaffLoginToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function buildStaffLoginLinkUrl(token) {
  const baseUrl = env.staffLoginLinkBaseUrl.replace(/\/$/, "");
  return `${baseUrl}/${encodeURIComponent(token)}`;
}

function createReadableStaffToken() {
  let code = "";
  for (let index = 0; index < STAFF_LOGIN_TOKEN_LENGTH; index += 1) {
    code += STAFF_LOGIN_TOKEN_ALPHABET[crypto.randomInt(STAFF_LOGIN_TOKEN_ALPHABET.length)];
  }
  return `s_${code}`;
}

export async function createStaffLoginLink({ businessId, member, createdBy }) {
  let token = createReadableStaffToken();
  let hasExistingLink = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    hasExistingLink = Boolean(await StaffLoginLink.exists({ tokenHash: hashStaffLoginToken(token) }));
    if (!hasExistingLink) break;
    token = createReadableStaffToken();
  }
  if (hasExistingLink) {
    throw new Error("Could not generate a unique staff login link.");
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + STAFF_LOGIN_LINK_DAYS);

  await StaffLoginLink.create({
    businessId,
    memberId: member._id,
    tokenHash: hashStaffLoginToken(token),
    passwordVersion: member.passwordVersion,
    createdBy: createdBy || null,
    expiresAt,
  });

  return {
    token,
    loginLink: buildStaffLoginLinkUrl(token),
    expiresAt,
  };
}
