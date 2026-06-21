import crypto from "crypto";
import mongoose from "mongoose";
import { QrShortLink } from "../models/QrShortLink.js";
import { WhatsappAccount } from "../models/WhatsappAccount.js";

const DEFAULT_MESSAGE = "Hi, I would like to know more.";
const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function normalizePhone(rawPhone = "") {
  return String(rawPhone).replace(/\D/g, "");
}

function cleanMessage(message = "") {
  const trimmed = String(message || "").trim();
  return (trimmed || DEFAULT_MESSAGE).slice(0, 500);
}

function cleanCustomSlug(slug = "") {
  const cleaned = String(slug || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
  if (!cleaned) return "";
  if (cleaned.length < 4 || cleaned.length > 32) return null;
  return cleaned;
}

function getShortLinkBaseUrl() {
  return (process.env.PUBLIC_SHORT_LINK_BASE_URL || "https://wabflow.synqra.in").replace(/\/$/, "");
}

function buildShortUrl(slug) {
  return `${getShortLinkBaseUrl()}/q/${slug}`;
}

function buildTargetUrl(link, resolvedPhoneNumber = "") {
  const encoded = encodeURIComponent(cleanMessage(link.starterMessage));
  return `https://wa.me/${normalizePhone(resolvedPhoneNumber || link.phoneNumber)}?text=${encoded}`;
}

async function resolveLinkPhoneNumber(link) {
  if (!link) return "";
  if (link.whatsappAccountId && mongoose.Types.ObjectId.isValid(link.whatsappAccountId)) {
    const account = await WhatsappAccount.findOne({
      _id: link.whatsappAccountId,
      businessId: link.businessId,
    }).select("displayPhoneNumber");
    const accountPhone = normalizePhone(account?.displayPhoneNumber);
    if (accountPhone) return accountPhone;
  }
  return normalizePhone(link.phoneNumber);
}

function serializeLink(link, includeTarget = true, resolvedPhoneNumber = "") {
  if (!link) return null;
  const plain = link.toObject ? link.toObject() : link;
  const phoneNumber = normalizePhone(resolvedPhoneNumber || plain.phoneNumber);
  return {
    id: String(plain._id || plain.id),
    _id: String(plain._id || plain.id),
    businessId: String(plain.businessId),
    whatsappAccountId: plain.whatsappAccountId ? String(plain.whatsappAccountId) : null,
    slug: plain.slug,
    title: plain.title,
    phoneNumber,
    starterMessage: plain.starterMessage,
    active: Boolean(plain.active),
    shortUrl: buildShortUrl(plain.slug),
    targetUrl: includeTarget ? buildTargetUrl(plain, phoneNumber) : undefined,
    scanCount: plain.scanCount || 0,
    lastScannedAt: plain.lastScannedAt || null,
    dailyScans: plain.dailyScans || [],
    recentScans: plain.recentScans || [],
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

async function generateSlug(length = 5) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let slug = "";
    const bytes = crypto.randomBytes(length);
    for (const byte of bytes) {
      slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
    }
    const existing = await QrShortLink.exists({ slug });
    if (!existing) return slug;
  }
  throw new Error("Could not generate a unique QR link.");
}

function getClientHeaders(req) {
  return {
    userAgent: String(req.get("x-qr-user-agent") || req.get("user-agent") || "").slice(0, 250),
    referer: String(req.get("x-qr-referer") || req.get("referer") || "").slice(0, 250),
  };
}

async function recordScan(link, req) {
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const dailyScans = Array.isArray(link.dailyScans) ? [...link.dailyScans] : [];
  const dayIndex = dailyScans.findIndex((item) => item.date === dayKey);
  if (dayIndex >= 0) {
    dailyScans[dayIndex] = {
      date: dayKey,
      count: (dailyScans[dayIndex].count || 0) + 1,
    };
  } else {
    dailyScans.push({ date: dayKey, count: 1 });
  }

  const recentScans = [
    { scannedAt: now, ...getClientHeaders(req) },
    ...(Array.isArray(link.recentScans) ? link.recentScans : []),
  ].slice(0, 50);

  link.scanCount = (link.scanCount || 0) + 1;
  link.lastScannedAt = now;
  link.dailyScans = dailyScans.slice(-120);
  link.recentScans = recentScans;
  await link.save();
}

async function findPublicLink(slug) {
  return QrShortLink.findOne({ slug: String(slug || "").trim() });
}

export async function resolvePublicQrShortLink(req, res) {
  const link = await findPublicLink(req.params.slug);
  if (!link || !link.active) {
    return res.status(404).json({
      success: false,
      error: "QR link is unavailable.",
    });
  }

  const phoneNumber = await resolveLinkPhoneNumber(link);
  if (!phoneNumber) {
    return res.status(404).json({
      success: false,
      error: "QR link phone number is unavailable.",
    });
  }

  await recordScan(link, req);
  return res.json({
    success: true,
    data: serializeLink(link, true, phoneNumber),
  });
}

export async function redirectPublicQrShortLink(req, res) {
  const link = await findPublicLink(req.params.slug);
  if (!link || !link.active) {
    return res.status(404).send("This WabFlow QR link is unavailable.");
  }

  const phoneNumber = await resolveLinkPhoneNumber(link);
  if (!phoneNumber) {
    return res.status(404).send("This WabFlow QR link phone number is unavailable.");
  }

  await recordScan(link, req);
  return res.redirect(302, buildTargetUrl(link, phoneNumber));
}

export async function listQrShortLinks(req, res) {
  const links = await QrShortLink.find({ businessId: req.business._id }).sort({ createdAt: -1 });
  const serializedLinks = await Promise.all(
    links.map(async (link) => serializeLink(link, true, await resolveLinkPhoneNumber(link)))
  );
  return res.json({
    success: true,
    data: serializedLinks,
  });
}

export async function createQrShortLink(req, res) {
  const customSlug = cleanCustomSlug(req.body.slug);
  if (customSlug === null) {
    return res.status(400).json({
      success: false,
      error: "Slug must be 4-32 characters and use only letters, numbers, dashes, or underscores.",
    });
  }

  const slug = customSlug || await generateSlug();
  const existingSlug = await QrShortLink.exists({ slug });
  if (existingSlug) {
    return res.status(409).json({ success: false, error: "That QR link slug is already taken." });
  }

  let whatsappAccountId = req.body.whatsappAccountId || null;
  let accountPhoneNumber = "";
  if (whatsappAccountId && mongoose.Types.ObjectId.isValid(whatsappAccountId)) {
    const account = await WhatsappAccount.findOne({
      _id: whatsappAccountId,
      businessId: req.business._id,
    }).select("_id displayPhoneNumber");
    whatsappAccountId = account?._id || null;
    accountPhoneNumber = normalizePhone(account?.displayPhoneNumber);
  } else {
    whatsappAccountId = null;
  }

  const phoneNumber = accountPhoneNumber || normalizePhone(req.body.phoneNumber);
  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: "Phone number is required." });
  }

  const link = await QrShortLink.create({
    businessId: req.business._id,
    whatsappAccountId,
    slug,
    title: String(req.body.title || "Bot QR Code").trim().slice(0, 80),
    phoneNumber,
    starterMessage: cleanMessage(req.body.starterMessage),
  });

  return res.status(201).json({
    success: true,
    data: serializeLink(link, true, phoneNumber),
  });
}

export async function updateQrShortLink(req, res) {
  const link = await QrShortLink.findOne({
    _id: req.params.linkId,
    businessId: req.business._id,
  });

  if (!link) {
    return res.status(404).json({ success: false, error: "QR link not found." });
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "title")) {
    link.title = String(req.body.title || "Bot QR Code").trim().slice(0, 80);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "phoneNumber")) {
    if (link.whatsappAccountId) {
      const accountPhoneNumber = await resolveLinkPhoneNumber(link);
      if (!accountPhoneNumber) {
        return res.status(400).json({ success: false, error: "Connected WhatsApp phone number is unavailable." });
      }
      link.phoneNumber = accountPhoneNumber;
    } else {
      const phoneNumber = normalizePhone(req.body.phoneNumber);
      if (!phoneNumber) {
        return res.status(400).json({ success: false, error: "Phone number is required." });
      }
      link.phoneNumber = phoneNumber;
    }
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "starterMessage")) {
    link.starterMessage = cleanMessage(req.body.starterMessage);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, "active")) {
    link.active = Boolean(req.body.active);
    link.disabledAt = link.active ? null : new Date();
  }

  await link.save();
  const phoneNumber = await resolveLinkPhoneNumber(link);
  return res.json({
    success: true,
    data: serializeLink(link, true, phoneNumber),
  });
}

export async function getQrShortLinkAnalytics(req, res) {
  const link = await QrShortLink.findOne({
    _id: req.params.linkId,
    businessId: req.business._id,
  });

  if (!link) {
    return res.status(404).json({ success: false, error: "QR link not found." });
  }

  return res.json({
    success: true,
    data: {
      id: String(link._id),
      slug: link.slug,
      shortUrl: buildShortUrl(link.slug),
      scanCount: link.scanCount || 0,
      lastScannedAt: link.lastScannedAt || null,
      dailyScans: link.dailyScans || [],
      recentScans: link.recentScans || [],
      active: link.active,
    },
  });
}
