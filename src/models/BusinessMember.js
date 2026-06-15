import mongoose from "mongoose";

const permissionsSchema = new mongoose.Schema(
  {
    inbox: {
      view: { type: Boolean, default: false },
      reply: { type: Boolean, default: false },
      manage: { type: Boolean, default: false },
    },
    team: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      revoke: { type: Boolean, default: false },
      resetPassword: { type: Boolean, default: false },
    },
    settings: {
      view: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
    },
  },
  { _id: false }
);

const businessMemberSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, // If linked to a normal User
    memberType: { type: String, enum: ["owner", "staff"], required: true },
    role: { type: String, enum: ["owner", "admin", "manager", "agent", "viewer"], required: true },
    name: { type: String, required: true },
    displayName: { type: String, default: "" },
    staffCode: { type: String, unique: true, sparse: true, trim: true },
    businessCode: { type: String, trim: true },
    passwordHash: { type: String, default: null },
    currentPassword: { type: String, default: null },
    passwordVersion: { type: Number, default: 1 },
    status: { type: String, enum: ["active", "disabled", "revoked", "pending"], default: "active" },
    permissions: { type: permissionsSchema, default: () => ({}) },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    lastLoginAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    disabledAt: { type: Date, default: null },
    disabledBy: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    passwordChangedAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },
    notes: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

businessMemberSchema.index({ businessId: 1, status: 1 });
businessMemberSchema.index({ businessCode: 1 });
businessMemberSchema.index({ businessId: 1, role: 1 });

export const BusinessMember = mongoose.models.BusinessMember || mongoose.model("BusinessMember", businessMemberSchema);
