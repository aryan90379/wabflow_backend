import { Business } from "../models/Business.js";
import { AutomationFlow } from "../models/AutomationFlow.js";

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
  });

  try {
    const stepId = "step_welcome";
    await AutomationFlow.create({
      businessId: business._id,
      name: "Welcome Assistant",
      status: "published",
      isDefault: true,
      version: 2,
      trigger: { type: "any_message" },
      entryStepId: stepId,
      steps: [
        {
          id: stepId,
          type: "message",
          name: "Welcome Message",
          config: {
            text: `Hey! Welcome to ${business.name}. How can we help you today?`,
            buttons: [],
          },
        },
      ],
    });
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
  ];

  for (const key of allowed) {
    if (req.body[key] !== undefined) req.business.set(key, req.body[key]);
  }

  await req.business.save();
  return res.json({ success: true, business: req.business });
}
