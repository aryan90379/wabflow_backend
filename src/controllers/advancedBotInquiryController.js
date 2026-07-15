import { AdvancedBotInquiry } from "../models/index.js";

const normalizeText = (value) => String(value || "").trim();

export const createAdvancedBotInquiry = async (req, res) => {
  const {
    requesterType,
    fullName,
    email,
    whatsappNumber,
    companyName,
    role,
    website,
    purpose,
    capabilities,
    timeline,
    budgetRange,
    preferredContactTime,
  } = req.body;

  if (!["individual", "company"].includes(requesterType)) {
    return res.status(400).json({ error: "Please select individual or company" });
  }

  if (!normalizeText(fullName) || !normalizeText(email) || !normalizeText(whatsappNumber) || !normalizeText(purpose)) {
    return res.status(400).json({ error: "Name, email, WhatsApp number, and project purpose are required" });
  }

  if (requesterType === "company" && (!normalizeText(companyName) || !normalizeText(role))) {
    return res.status(400).json({ error: "Company name and your role are required for company inquiries" });
  }

  const inquiry = await AdvancedBotInquiry.create({
    businessId: req.business._id,
    createdBy: req.userId,
    requesterType,
    fullName: normalizeText(fullName),
    email: normalizeText(email),
    whatsappNumber: normalizeText(whatsappNumber),
    companyName: requesterType === "company" ? normalizeText(companyName) : "",
    role: requesterType === "company" ? normalizeText(role) : "",
    website: normalizeText(website),
    purpose: normalizeText(purpose),
    capabilities: Array.isArray(capabilities)
      ? capabilities.map(normalizeText).filter(Boolean).slice(0, 12)
      : [],
    timeline: normalizeText(timeline),
    budgetRange: normalizeText(budgetRange),
    preferredContactTime: normalizeText(preferredContactTime),
  });

  res.status(201).json(inquiry);
};

export const listAdvancedBotInquiries = async (req, res) => {
  const inquiries = await AdvancedBotInquiry.find({ businessId: req.business._id })
    .sort({ createdAt: -1 });

  res.json(inquiries);
};

export const getAdvancedBotInquiry = async (req, res) => {
  const inquiry = await AdvancedBotInquiry.findOne({
    _id: req.params.inquiryId,
    businessId: req.business._id,
  });

  if (!inquiry) {
    return res.status(404).json({ error: "Advanced bot inquiry not found" });
  }

  res.json(inquiry);
};

export const adminListAdvancedBotInquiries = async (req, res) => {
  const inquiries = await AdvancedBotInquiry.find({})
    .sort({ createdAt: -1 })
    .populate("businessId", "businessName name")
    .populate("createdBy", "name email");

  res.json(inquiries);
};

export const adminGetAdvancedBotInquiry = async (req, res) => {
  const inquiry = await AdvancedBotInquiry.findById(req.params.inquiryId)
    .populate("businessId", "businessName name phone email website")
    .populate("createdBy", "name email");

  if (!inquiry) {
    return res.status(404).json({ error: "Advanced bot inquiry not found" });
  }

  res.json(inquiry);
};

export const adminUpdateAdvancedBotInquiry = async (req, res) => {
  const inquiry = await AdvancedBotInquiry.findById(req.params.inquiryId);
  if (!inquiry) {
    return res.status(404).json({ error: "Advanced bot inquiry not found" });
  }

  const { status, internalNotes } = req.body;
  if (status && !["new", "contacted", "qualified", "closed"].includes(status)) {
    return res.status(400).json({ error: "Invalid inquiry status" });
  }

  if (status) inquiry.status = status;
  if (typeof internalNotes === "string") inquiry.internalNotes = internalNotes.trim();
  await inquiry.save();

  res.json(inquiry);
};
