import mongoose from "mongoose";

const botKnowledgeSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    category: {
      type: String,
      enum: ["faq", "pricing", "timing", "location", "policy", "service", "custom"],
      default: "faq",
      index: true,
    },
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true },
    keywords: [{ type: String, trim: true, lowercase: true }],
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

botKnowledgeSchema.index({ question: "text", answer: "text", keywords: "text" });
botKnowledgeSchema.index({ businessId: 1, active: 1, priority: -1 });

export const BotKnowledge =
  mongoose.models.BotKnowledge || mongoose.model("BotKnowledge", botKnowledgeSchema);
