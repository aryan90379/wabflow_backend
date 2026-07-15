import mongoose from "mongoose";

const appContentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const AppContent =
  mongoose.models.AppContent || mongoose.model("AppContent", appContentSchema);
