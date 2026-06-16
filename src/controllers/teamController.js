import crypto from "crypto";
import bcrypt from "bcryptjs";
import { BusinessMember } from "../models/BusinessMember.js";
import { Business } from "../models/Business.js";
import { StaffSession } from "../models/StaffSession.js";
import { AuditLog } from "../models/AuditLog.js";

// Helper to generate a strong password
function generateTemporaryPassword() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
  let pass = "";
  for (let i = 0; i < 16; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

// Helper to log audit actions
export async function logAudit(businessId, actor, action, entityType, entityId, details = {}) {
  await AuditLog.create({
    businessId,
    actorType: actor.type,
    actorUserId: actor.userId || null,
    actorMemberId: actor.memberId || null,
    actorName: actor.name || "System",
    action,
    entityType,
    entityId,
    ...details
  });
}

export async function listTeamMembers(req, res) {
  const { businessId } = req.params;
  const members = await BusinessMember.find({ businessId }).select("-passwordHash").sort({ createdAt: -1 });
  return res.json({ success: true, members });
}

export async function createTeamMember(req, res) {
  const { businessId } = req.params;
  const { name, role, permissions } = req.body;

  const business = await Business.findById(businessId);
  if (!business) return res.status(404).json({ success: false, error: "Business not found." });

  // Generate business code if not exists
  let bCode = business.teamAccess?.businessCode;
  if (!bCode) {
    bCode = `WAB-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    business.teamAccess = { ...business.teamAccess, businessCode: bCode };
    await business.save();
  }

  // Generate staff code and temporary password
  const staffCode = `ST-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const password = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const member = await BusinessMember.create({
    businessId,
    memberType: "staff",
    role,
    name,
    displayName: name,
    staffCode,
    businessCode: bCode,
    passwordHash,
    currentPassword: password,
    permissions: permissions || {},
    createdBy: req.actor.memberId || null,
  });

  await logAudit(businessId, req.actor, "staff.created", "BusinessMember", member._id, {
    before: null,
    after: { name, role }
  });

  return res.json({
    success: true,
    member: { ...member.toObject(), passwordHash: undefined },
    credentials: {
      businessCode: bCode,
      staffCode,
      password // Returning password only once
    }
  });
}

export async function updateTeamMember(req, res) {
  const { businessId, memberId } = req.params;
  const { name, role, permissions, status, notes, avatarUrl, displayName } = req.body;

  const member = await BusinessMember.findOne({ _id: memberId, businessId });
  if (!member) return res.status(404).json({ success: false, error: "Member not found." });

  const before = { name: member.name, role: member.role, permissions: member.permissions, status: member.status };

  if (name) member.name = name;
  if (role) member.role = role;
  if (permissions) member.permissions = permissions;
  if (status) member.status = status;
  if (notes !== undefined) member.notes = notes;
  if (avatarUrl !== undefined) member.avatarUrl = avatarUrl;
  if (displayName !== undefined) member.displayName = displayName;

  await member.save();

  await logAudit(businessId, req.actor, "staff.permissions_updated", "BusinessMember", member._id, {
    before,
    after: { name: member.name, role: member.role, permissions: member.permissions, status: member.status }
  });

  return res.json({ success: true, member: { ...member.toObject(), passwordHash: undefined } });
}

export async function resetMemberPassword(req, res) {
  const { businessId, memberId } = req.params;
  
  const member = await BusinessMember.findOne({ _id: memberId, businessId });
  if (!member) return res.status(404).json({ success: false, error: "Member not found." });

  const password = generateTemporaryPassword();
  member.passwordHash = await bcrypt.hash(password, 10);
  member.currentPassword = password;
  member.passwordVersion += 1;
  member.mustChangePassword = true;
  await member.save();

  // Revoke all existing sessions
  await StaffSession.updateMany({ memberId }, { status: "revoked", revokedAt: new Date(), revokedBy: req.actor.memberId || null });

  await logAudit(businessId, req.actor, "staff.password_regenerated", "BusinessMember", member._id);

  return res.json({
    success: true,
    credentials: {
      businessCode: member.businessCode,
      staffCode: member.staffCode,
      password
    }
  });
}

export async function revokeMemberAccess(req, res) {
  const { businessId, memberId } = req.params;
  
  const member = await BusinessMember.findOne({ _id: memberId, businessId });
  if (!member) return res.status(404).json({ success: false, error: "Member not found." });

  member.status = "revoked";
  member.revokedAt = new Date();
  member.revokedBy = req.actor.memberId || null;
  member.passwordVersion += 1; // invalidate existing tokens just in case
  await member.save();

  await StaffSession.updateMany({ memberId, status: "active" }, { status: "revoked", revokedAt: new Date(), revokedBy: req.actor.memberId || null });

  await logAudit(businessId, req.actor, "staff.revoked", "BusinessMember", member._id);

  return res.json({ success: true, message: "Member access revoked." });
}

export async function disableMemberAccess(req, res) {
  const { businessId, memberId } = req.params;
  
  const member = await BusinessMember.findOne({ _id: memberId, businessId });
  if (!member) return res.status(404).json({ success: false, error: "Member not found." });

  member.status = "disabled";
  member.disabledAt = new Date();
  member.disabledBy = req.actor.memberId || null;
  await member.save();

  await StaffSession.updateMany({ memberId, status: "active" }, { status: "revoked", revokedAt: new Date(), revokedBy: req.actor.memberId || null });

  await logAudit(businessId, req.actor, "staff.disabled", "BusinessMember", member._id);

  return res.json({ success: true, message: "Member access disabled." });
}

export async function enableMemberAccess(req, res) {
  const { businessId, memberId } = req.params;
  
  const member = await BusinessMember.findOne({ _id: memberId, businessId });
  if (!member) return res.status(404).json({ success: false, error: "Member not found." });

  member.status = "active";
  await member.save();

  await logAudit(businessId, req.actor, "staff.enabled", "BusinessMember", member._id);

  return res.json({ success: true, message: "Member access enabled." });
}

export async function listMemberSessions(req, res) {
  const { businessId, memberId } = req.params;
  const sessions = await StaffSession.find({ businessId, memberId }).sort({ lastSeenAt: -1 });
  return res.json({ success: true, sessions });
}

export async function revokeMemberSession(req, res) {
  const { businessId, memberId, sessionId } = req.params;
  const session = await StaffSession.findOneAndUpdate(
    { _id: sessionId, businessId, memberId },
    { status: "revoked", revokedAt: new Date(), revokedBy: req.actor.memberId || null },
    { new: true }
  );
  if (!session) return res.status(404).json({ success: false, error: "Session not found." });

  await logAudit(businessId, req.actor, "staff.session_revoked", "StaffSession", session._id);

  return res.json({ success: true, session });
}

export async function listAuditLogs(req, res) {
  const { businessId } = req.params;
  const { action, entityType, limit = 50, skip = 0 } = req.query;

  const query = { businessId };
  if (action) query.action = action;
  if (entityType) query.entityType = entityType;

  const logs = await AuditLog.find(query).sort({ createdAt: -1 }).skip(Number(skip)).limit(Number(limit));
  const total = await AuditLog.countDocuments(query);

  return res.json({ success: true, logs, total });
}
