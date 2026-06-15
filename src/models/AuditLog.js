import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    actorType: { type: String, enum: ["owner", "staff", "system", "bot"], required: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessMember", default: null },
    actorName: { type: String, default: "" },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", default: null },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ businessId: 1, createdAt: -1 });
auditLogSchema.index({ businessId: 1, entityType: 1, entityId: 1 });
auditLogSchema.index({ businessId: 1, action: 1 });
auditLogSchema.index({ businessId: 1, actorMemberId: 1 });

export const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
