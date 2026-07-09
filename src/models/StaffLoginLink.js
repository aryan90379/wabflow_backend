import mongoose from "mongoose";

const staffLoginLinkSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    passwordVersion: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    lastUsedAt: { type: Date, default: null },
    usageCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

staffLoginLinkSchema.index({ memberId: 1, expiresAt: 1 });

export const StaffLoginLink = mongoose.models.StaffLoginLink || mongoose.model("StaffLoginLink", staffLoginLinkSchema);
