import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    googleId: { type: String, unique: true, sparse: true, index: true },
    googleEmail: { type: String, lowercase: true, trim: true, default: "" },
    appleId: { type: String, unique: true, sparse: true, index: true },
    appleEmail: { type: String, lowercase: true, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },
    profilepic: { type: String, default: "" },
    lastLoginAt: { type: Date, default: Date.now },
    language: { type: String, enum: ['en', 'hi'], default: 'en' },
    languageSet: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model("User", userSchema);
