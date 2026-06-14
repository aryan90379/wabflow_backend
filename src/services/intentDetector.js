import { normalizeText } from "../utils/text.js";

const intentPatterns = {
  human_request: ["human", "agent", "person", "representative", "staff", "call me", "talk to someone", "executive"],
  complaint: ["complaint", "bad service", "not happy", "issue", "problem", "refund", "angry"],
  pricing_enquiry: ["price", "pricing", "cost", "fees", "fee", "rate", "charges", "kitna", "daam"],
  booking_request: ["book", "booking", "appointment", "reserve", "schedule", "slot"],
  availability_check: ["available", "availability", "vacancy", "slots", "free today", "open slot"],
  location_query: ["location", "address", "where", "map", "directions", "kahan"],
  timing_query: ["timing", "hours", "open", "close", "when", "time"],
  service_query: ["service", "services", "menu", "course", "room", "package", "product", "treatment"],
  greeting: ["hi", "hello", "hey", "namaste", "hii", "start", "good morning", "good evening"],
};

export function detectIntent(text = "") {
  const normalized = normalizeText(text);
  let best = { intent: "unknown", confidence: 0.2 };

  for (const [intent, patterns] of Object.entries(intentPatterns)) {
    const matches = patterns.filter((pattern) => normalized.includes(pattern));
    if (!matches.length) continue;

    const confidence = Math.min(0.95, 0.55 + matches.length * 0.12);
    if (confidence > best.confidence) best = { intent, confidence };
  }

  return best;
}
