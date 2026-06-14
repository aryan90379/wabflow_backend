import { AutomationRule, BotKnowledge, AutomationFlow } from "../models/index.js";
import { normalizeText, tokenize } from "../utils/text.js";


function isAwayHours(business) {
  const timezone = business?.timezone || "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayKey = String(values.weekday || "").toLowerCase();
  const hours = business?.openingHours?.[dayKey];
  if (!hours || hours.enabled === false) return true;

  const now = `${values.hour}:${values.minute}`;
  const open = hours.open || "09:00";
  const close = hours.close || "18:00";

  if (open <= close) return now < open || now > close;
  return now > close && now < open;
}

function keywordScore(text, keywords = [], mode = "any") {
  const normalized = normalizeText(text);
  const cleanKeywords = keywords.map(normalizeText).filter(Boolean);
  if (!cleanKeywords.length) return 0;

  const matches = cleanKeywords.filter((keyword) => normalized.includes(keyword));

  if (mode === "exact") return cleanKeywords.includes(normalized) ? 100 : 0;
  if (mode === "all") return matches.length === cleanKeywords.length ? 90 + matches.length : 0;
  if (mode === "contains") return matches.length ? 70 + matches.length : 0;
  return matches.length ? 60 + matches.length : 0;
}

export async function findMatchingRule({ business, businessId, text, intent, isFirstMessage }) {
  const rules = await AutomationRule.find({ businessId, active: true }).sort({ priority: -1, createdAt: 1 });

  let best = null;
  let bestScore = 0;

  for (const rule of rules) {
    let score = 0;

    if (rule.triggerType === "first_message" && isFirstMessage) score = 1000 + rule.priority;
    if (rule.triggerType === "intent" && rule.intent === intent) score = 800 + rule.priority;
    if (rule.triggerType === "any_message") score = 10 + rule.priority;
    if (rule.triggerType === "away_hours" && isAwayHours(business)) score = 900 + rule.priority;
    if (rule.triggerType === "keyword") {
      score = keywordScore(text, rule.keywords, rule.matchMode) + rule.priority;
    }

    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  return best;
}

export async function findMatchingKnowledge({ businessId, text }) {
  const tokens = tokenize(text);
  if (!tokens.length) return null;

  const candidates = await BotKnowledge.find({
    businessId,
    active: true,
    $or: [
      { keywords: { $in: tokens } },
      { question: { $regex: tokens.slice(0, 5).join("|"), $options: "i" } },
    ],
  })
    .sort({ priority: -1 })
    .limit(20);

  const normalized = normalizeText(text);
  let best = null;
  let bestScore = 0;

  for (const item of candidates) {
    const keywordMatches = item.keywords.filter((keyword) => normalized.includes(normalizeText(keyword))).length;
    const questionTokens = tokenize(item.question);
    const overlap = questionTokens.filter((token) => tokens.includes(token)).length;
    const score = item.priority * 2 + keywordMatches * 10 + overlap * 3;

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

export async function findTriggeredFlow({ businessId, accountId, text, intent, isFirstMessage }) {
  const flows = await AutomationFlow.find({
    businessId,
    status: "published",
    $or: [{ whatsappAccountId: null }, { whatsappAccountId: accountId }],
  }).sort({ isDefault: -1, updatedAt: -1 });

  let fallback = null;

  for (const flow of flows) {
    const trigger = flow.trigger || {};

    if (flow.isDefault) fallback = fallback || flow;
    if (trigger.type === "first_message" && isFirstMessage) return flow;
    if (trigger.type === "intent" && trigger.intent === intent) return flow;
    if (trigger.type === "keyword" && keywordScore(text, trigger.keywords, trigger.matchMode) > 0) return flow;
    if (trigger.type === "any_message") return flow;
  }

  return fallback;
}
