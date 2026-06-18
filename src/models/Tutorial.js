import mongoose from "mongoose";

const tutorialSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    url: { type: String, required: true },
    thumbnail: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Tutorial = mongoose.models.Tutorial || mongoose.model("Tutorial", tutorialSchema);
