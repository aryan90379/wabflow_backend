export const WHATSAPP_PRICING_VERSION = "Meta list rate · 1 Jan 2026";

const INDIA_LIST_RATES_INR = Object.freeze({
  MARKETING: 0.8631,
  UTILITY: 0.115,
  AUTHENTICATION: 0.115,
});

export function normalizeTemplateCategory(value) {
  const category = String(value || "MARKETING").toUpperCase();
  return Object.hasOwn(INDIA_LIST_RATES_INR, category) ? category : "MARKETING";
}

export function estimateWhatsAppPricing(recipients = [], templateCategory = "MARKETING") {
  const category = normalizeTemplateCategory(templateCategory);
  const ratePerMessage = INDIA_LIST_RATES_INR[category];
  const pricedRecipientCount = recipients.filter((recipient) =>
    String(recipient?.phone || recipient || "").replace(/[^\d]/g, "").startsWith("91")
  ).length;
  const unpricedRecipientCount = Math.max(0, recipients.length - pricedRecipientCount);

  return {
    templateCategory: category,
    pricingMarket: "India",
    pricingCurrency: "INR",
    ratePerMessage,
    estimatedCost: Number((pricedRecipientCount * ratePerMessage).toFixed(4)),
    pricedRecipientCount,
    unpricedRecipientCount,
    pricingVersion: WHATSAPP_PRICING_VERSION,
  };
}
