import mongoose from "mongoose";

const permissionsSchema = new mongoose.Schema(
  {
    inbox: {
      viewAll: { type: Boolean, default: false },
      viewAssigned: { type: Boolean, default: true },
      reply: { type: Boolean, default: false },
      assign: { type: Boolean, default: false },
      close: { type: Boolean, default: false },
    },
    bot: {
      view: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      publish: { type: Boolean, default: false },
      pauseConversation: { type: Boolean, default: false },
    },
    leads: {
      view: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      assign: { type: Boolean, default: false },
    },
    bookings: {
      view: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      confirm: { type: Boolean, default: false },
      cancel: { type: Boolean, default: false },
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
      editBusiness: { type: Boolean, default: false },
      manageWhatsapp: { type: Boolean, default: false },
      billing: { type: Boolean, default: false },
    },
    analytics: {
      view: { type: Boolean, default: false },
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
