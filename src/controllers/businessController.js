import { Business } from "../models/Business.js";
import {
  AutomationFlow,
  AutomationRule,
  BotDecisionLog,
  BotKnowledge,
  Booking,
  BroadcastJob,
  BroadcastRecipient,
  Contact,
  Conversation,
  FollowUpTask,
  HandoffRequest,
  Lead,
  Message,
  Notification,
  QrShortLink,
  ServiceItem,
  WhatsappAccount,
  WhatsappMessageTemplate,
} from "../models/index.js";
import { AuditLog } from "../models/AuditLog.js";
import { BusinessMember } from "../models/BusinessMember.js";
import { ListGroup } from "../models/ListGroup.js";
import { ListItem } from "../models/ListItem.js";
import { StaffSession } from "../models/StaffSession.js";

const MEDICAL_BUSINESS_TYPES = new Set(["doctor", "clinic", "hospital"]);

function splitServiceNames(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function serviceToBookingOption(service) {
  return {
    id: String(service._id || service.id),
    name: service.name,
    description: service.description || "",
    price: service.price,
    currency: service.currency || "INR",
  };
}

function medicalBookingConfig(services = []) {
  return {
    roomSelection: true,
    otherOption: true,
    selectionLabel: "What do you want the appointment for?",
    otherOptionLabel: "Other",
    collectFields: {
      name: true,
      phone: true,
      notes: true,
    },
    notesLabel: "Describe your problem",
    notesRequired: true,
    rooms: services.map(serviceToBookingOption),
  };
}

function buildDefaultFlowDefinition(business, services = []) {
  const isMedical = MEDICAL_BUSINESS_TYPES.has(String(business.businessType || "").toLowerCase());
  const welcomeText = isMedical
    ? `Hello, welcome to ${business.name || "our clinic"}. How can we help you today?`
    : `Hey! Welcome to ${business.name || "our business"}. How can we help you today?`;

  const buttons = isMedical
    ? [
        {
          id: "book_appointment",
          label: "Book appointment",
          action: {
            type: "preset",
            preset: "preset_booking",
            bookingConfig: medicalBookingConfig(services),
          },
        },
      ]
    : [];

  return {
    businessId: business._id,
    name: "Welcome Assistant",
    status: "published",
    isDefault: true,
    version: 2,
    trigger: { type: "any_message" },
    entryStepId: "step_welcome",
    steps: [
      {
        id: "step_welcome",
        type: "message",
        name: "Welcome Message",
        config: {
          text: welcomeText,
          buttons,
        },
      },
    ],
  };
}

async function seedServicesFromBusiness(business, source = {}) {
  if (!MEDICAL_BUSINESS_TYPES.has(String(business.businessType || "").toLowerCase())) return [];

  const names = splitServiceNames(
    source.specialization ||
    source.services ||
    business.metadata?.get?.("specialization") ||
    business.metadata?.specialization ||
    ""
  );

  const uniqueNames = [...new Set(names)].slice(0, 10);
  if (!uniqueNames.length) return ServiceItem.find({ businessId: business._id, type: "service", active: { $ne: false } }).limit(10);

  const services = [];
  for (const name of uniqueNames) {
    const service = await ServiceItem.findOneAndUpdate(
      { businessId: business._id, type: "service", name },
      { $setOnInsert: { businessId: business._id, type: "service", name, active: true } },
      { upsert: true, new: true }
    );
    services.push(service);
  }

  return services;
}

async function recreateDefaultFlow(business) {
  const services = await ServiceItem.find({
    businessId: business._id,
    type: MEDICAL_BUSINESS_TYPES.has(String(business.businessType || "").toLowerCase()) ? "service" : "room",
    active: { $ne: false },
  }).limit(10);

  await AutomationFlow.deleteMany({ businessId: business._id, isDefault: true });
  return AutomationFlow.create(buildDefaultFlowDefinition(business, services));
}

export async function createBusiness(req, res) {
  const business = await Business.create({
    ownerId: req.userId,
    name: req.body.name,
    businessType: req.body.businessType || "other",
    description: req.body.description || "",
    address: req.body.address || "",
    city: req.body.city || "",
    phone: req.body.phone || "",
    timezone: req.body.timezone || "Asia/Kolkata",
    ...(req.body.openingHours ? { openingHours: req.body.openingHours } : {}),
    ...(req.body.settings ? { settings: req.body.settings } : {}),
    ...(req.body.metadata ? { metadata: req.body.metadata } : {}),
  });

  try {
    await seedServicesFromBusiness(business, req.body.metadata || {});
    await recreateDefaultFlow(business);
  } catch (err) {
    console.error("Failed to create default flow for business", err);
  }

  return res.status(201).json({ success: true, business });
}

export async function listMyBusinesses(req, res) {
  if (req.authType === "staff") {
    const business = await Business.findById(req.businessId);
    if (!business || !business.active) {
      return res.json({ success: true, businesses: [] });
    }
    return res.json({ success: true, businesses: [business] });
  }

  const businesses = await Business.find({ ownerId: req.userId, active: true }).sort({ createdAt: -1 });
  return res.json({ success: true, businesses });
}

export async function getBusiness(req, res) {
  return res.json({ success: true, business: req.business });
}

export async function updateBusiness(req, res) {
  const allowed = [
    "name",
    "businessType",
    "description",
    "address",
    "city",
    "phone",
    "timezone",
    "openingHours",
    "settings",
    "metadata",
  ];

  const wasOnboardingReset = Boolean(req.business.settings?.onboardingResetRequired);
  const previousType = req.business.businessType;

  for (const key of allowed) {
    if (req.body[key] !== undefined) req.business.set(key, req.body[key]);
  }

  await req.business.save();
  if (
    previousType !== req.business.businessType ||
    (wasOnboardingReset && req.body.settings?.onboardingResetRequired === false)
  ) {
    await seedServicesFromBusiness(req.business, req.body.metadata || {});
    await recreateDefaultFlow(req.business);
    await WhatsappAccount.updateMany(
      { businessId: req.business._id },
      { $set: { bookingFlowDefinitionHash: "" } }
    );
  }
  return res.json({ success: true, business: req.business });
}

export async function resetBusinessForOnboarding(req, res) {
  const businessId = req.business._id;
  const preservedWhatsappAccounts = await WhatsappAccount.countDocuments({ businessId });
  const preservedQrLinks = await QrShortLink.countDocuments({ businessId });

  await Promise.all([
    AutomationFlow.deleteMany({ businessId }),
    AutomationRule.deleteMany({ businessId }),
    BotKnowledge.deleteMany({ businessId }),
    BotDecisionLog.deleteMany({ businessId }),
    Booking.deleteMany({ businessId }),
    BroadcastJob.deleteMany({ businessId }),
    BroadcastRecipient.deleteMany({ businessId }),
    Contact.deleteMany({ businessId }),
    Conversation.deleteMany({ businessId }),
    FollowUpTask.deleteMany({ businessId }),
    HandoffRequest.deleteMany({ businessId }),
    Lead.deleteMany({ businessId }),
    ListGroup.deleteMany({ businessId }),
    ListItem.deleteMany({ businessId }),
    Message.deleteMany({ businessId }),
    Notification.deleteMany({ businessId }),
    ServiceItem.deleteMany({ businessId }),
    StaffSession.deleteMany({ businessId }),
    WhatsappMessageTemplate.deleteMany({ businessId }),
    BusinessMember.deleteMany({ businessId, memberType: { $ne: "owner" } }),
    AuditLog.deleteMany({ businessId }),
  ]);

  req.business.set({
    name: "New business",
    businessType: "other",
    description: "",
    address: "",
    city: "",
    phone: "",
    metadata: {},
    settings: {
      ...(req.business.settings?.toObject?.() || req.business.settings || {}),
      botEnabled: true,
      aiEnabled: false,
      handoffEnabled: true,
      onboardingResetRequired: true,
    },
  });
  await req.business.save();

  await WhatsappAccount.updateMany(
    { businessId },
    { $set: { bookingFlowDefinitionHash: "" } }
  );

  return res.json({
    success: true,
    business: req.business,
    preserved: {
      whatsappAccounts: preservedWhatsappAccounts,
      qrLinks: preservedQrLinks,
    },
  });
}
