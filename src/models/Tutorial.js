import mongoose from "mongoose";

const tutorialSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    titleEn: { type: String, default: "" },
    titleHi: { type: String, default: "" },
    description: { type: String, default: "" },
    descriptionEn: { type: String, default: "" },
    descriptionHi: { type: String, default: "" },
    url: { type: String, default: "" },
    urlEn: { type: String, default: "" },
    urlHi: { type: String, default: "" },
    thumbnail: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Tutorial = mongoose.models.Tutorial || mongoose.model("Tutorial", tutorialSchema);
