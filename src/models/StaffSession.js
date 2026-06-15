import mongoose from "mongoose";

const staffSessionSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", required: true, index: true },
    sessionId: { type: String, required: true, unique: true },
    tokenVersion: { type: Number, required: true }, // Should match passwordVersion at creation
    deviceId: { type: String, default: "" },
    deviceName: { type: String, default: "" },
    platform: { type: String, default: "unknown" },
    appVersion: { type: String, default: "" },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    pushToken: { type: String, default: "" },
    status: { type: String, enum: ["active", "revoked", "expired"], default: "active" },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
  },
  { timestamps: true }
);

staffSessionSchema.index({ memberId: 1, status: 1 });

export const StaffSession = mongoose.models.StaffSession || mongoose.model("StaffSession", staffSessionSchema);
