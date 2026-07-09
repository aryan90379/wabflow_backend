import crypto from "crypto";
import { env } from "../config/env.js";
import { StaffLoginLink } from "../models/StaffLoginLink.js";

const STAFF_LOGIN_LINK_DAYS = 14;

export function hashStaffLoginToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function buildStaffLoginLinkUrl(token) {
  const baseUrl = env.staffLoginLinkBaseUrl.replace(/\/$/, "");
  return `${baseUrl}/${encodeURIComponent(token)}`;
}

export async function createStaffLoginLink({ businessId, member, createdBy }) {
  const token = `sl_${crypto.randomBytes(18).toString("base64url")}`;
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
