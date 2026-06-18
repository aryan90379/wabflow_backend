import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireBusinessAccess } from "../middleware/requireBusinessAccess.js";

import {
  appleAuth,
  checkEmail,
  getMe,
  linkAppleAuth,
  linkGoogleAuth,
  updateMe,
  googleAuth,
  staffLogin,
  staffLogout
} from "../controllers/authController.js";
import {
  listTeamMembers,
  createTeamMember,
  updateTeamMember,
  resetMemberPassword,
  revokeMemberAccess,
  enableMemberAccess,
  disableMemberAccess,
  listMemberSessions,
  revokeMemberSession,
  listAuditLogs
} from "../controllers/teamController.js";
import { requirePermission } from "../middleware/permissionMiddleware.js";
import {
  createBusiness,
  getBusiness,
  listMyBusinesses,
  updateBusiness,
} from "../controllers/businessController.js";
import {
  connectWhatsApp,
  disconnectWhatsappAccount,
  listWhatsappAccounts,
  updateWhatsappBusinessProfile,
} from "../controllers/whatsappController.js";
import {
  archiveFlow,
  createFlow,
  createKnowledge,
  createRule,
  createService,
  deleteKnowledge,
  deleteRule,
  deleteService,
  getFlow,
  listFlows,
  listKnowledge,
  listRules,
  listServices,
  publishFlow,
  removeServiceImage,
  updateFlow,
  updateKnowledge,
  updateRule,
  updateService,
  uploadMedia,
  uploadServiceImage
} from "../controllers/automationController.js";
import {
  getConversation,
  listConversations,
  listWhatsappMessageTemplates,
  createWhatsappMessageTemplate,
  sendWhatsappMessageTemplate,
  listMessages,
  markConversationRead,
  sendHumanMessage,
  updateConversationStatus,
  assignConversation,
} from "../controllers/inboxController.js";
import {
  createFollowUp,
  getBooking,
  getLead,
  listBookings,
  listDecisionLogs,
  listFollowUps,
  listHandoffs,
  listLeads,
  updateBooking,
  updateFollowUp,
  updateHandoff,
  updateLead,
} from "../controllers/crmController.js";

import { generateBookingFlow } from "../controllers/metaFlowController.js";
import { receiveWebhook, verifyWebhook } from "../controllers/webhookController.js";
import {
  getRooms,
  createRoom,
  updateRoom,
  deleteRoom,
} from "../controllers/roomController.js";
import { getTutorials, updateTutorials } from "../controllers/tutorialController.js";

const apiRouter = Router();

apiRouter.get("/health", (req, res) => {
  res.json({ success: true, service: "wabflow-backend", time: new Date().toISOString() });
});

apiRouter.post("/auth/google", asyncHandler(googleAuth));
apiRouter.post("/auth/apple", asyncHandler(appleAuth));
apiRouter.post("/auth/check-email", asyncHandler(checkEmail));
apiRouter.post("/auth/link/google", authMiddleware, asyncHandler(linkGoogleAuth));
apiRouter.post("/auth/link/apple", authMiddleware, asyncHandler(linkAppleAuth));
apiRouter.post("/auth/staff/login", asyncHandler(staffLogin));
apiRouter.post("/auth/staff/logout", authMiddleware, asyncHandler(staffLogout));
apiRouter.get("/auth/me", authMiddleware, asyncHandler(getMe));
apiRouter.patch("/auth/me", authMiddleware, asyncHandler(updateMe));

apiRouter.get("/webhooks/whatsapp", verifyWebhook);
apiRouter.post("/webhooks/whatsapp", receiveWebhook);

// --- Rooms ---
apiRouter.get("/businesses/:businessId/rooms", authMiddleware, requireBusinessAccess, asyncHandler(getRooms));
apiRouter.post("/businesses/:businessId/rooms", authMiddleware, requireBusinessAccess, requirePermission("catalog", "edit"), asyncHandler(createRoom));
apiRouter.put("/businesses/:businessId/rooms/:roomId", authMiddleware, requireBusinessAccess, requirePermission("catalog", "edit"), asyncHandler(updateRoom));
apiRouter.delete("/businesses/:businessId/rooms/:roomId", authMiddleware, requireBusinessAccess, requirePermission("catalog", "edit"), asyncHandler(deleteRoom));

// --- Tutorials ---
apiRouter.get("/tutorials", authMiddleware, asyncHandler(getTutorials));
apiRouter.post("/tutorials", authMiddleware, asyncHandler(updateTutorials));

const businessesRouter = Router();
businessesRouter.use(authMiddleware);
businessesRouter.post("/", asyncHandler(createBusiness));
businessesRouter.get("/", asyncHandler(listMyBusinesses));

const businessRouter = Router({ mergeParams: true });
businessRouter.use(requireBusinessAccess);

businessRouter.get("/", asyncHandler(getBusiness));
businessRouter.patch("/", requirePermission("settings.edit"), asyncHandler(updateBusiness));

businessRouter.post("/whatsapp/connect", requirePermission("settings.edit"), asyncHandler(connectWhatsApp));
businessRouter.get("/whatsapp/accounts", asyncHandler(listWhatsappAccounts));
businessRouter.patch("/whatsapp/accounts/:accountId/profile", requirePermission("settings.edit"), asyncHandler(updateWhatsappBusinessProfile));
businessRouter.delete("/whatsapp/accounts/:accountId", requirePermission("settings.edit"), asyncHandler(disconnectWhatsappAccount));

businessRouter.get("/knowledge", requirePermission("settings.view"), asyncHandler(listKnowledge));
businessRouter.post("/knowledge", requirePermission("settings.edit"), asyncHandler(createKnowledge));
businessRouter.patch("/knowledge/:knowledgeId", requirePermission("settings.edit"), asyncHandler(updateKnowledge));
businessRouter.delete("/knowledge/:knowledgeId", requirePermission("settings.edit"), asyncHandler(deleteKnowledge));

businessRouter.get("/services", requirePermission("settings.view"), asyncHandler(listServices));
businessRouter.post("/services", requirePermission("settings.edit"), asyncHandler(createService));
businessRouter.patch("/services/:serviceId", requirePermission("settings.edit"), asyncHandler(updateService));
businessRouter.delete("/services/:serviceId", requirePermission("settings.edit"), asyncHandler(deleteService));
businessRouter.post("/uploads", requirePermission("settings.edit"), asyncHandler(uploadMedia));
businessRouter.post("/services/:serviceId/images", requirePermission("settings.edit"), asyncHandler(uploadServiceImage));
businessRouter.delete("/services/:serviceId/images", requirePermission("settings.edit"), asyncHandler(removeServiceImage));

businessRouter.get("/automation-rules", requirePermission("settings.view"), asyncHandler(listRules));
businessRouter.post("/automation-rules", requirePermission("settings.edit"), asyncHandler(createRule));
businessRouter.patch("/automation-rules/:ruleId", requirePermission("settings.edit"), asyncHandler(updateRule));
businessRouter.delete("/automation-rules/:ruleId", requirePermission("settings.edit"), asyncHandler(deleteRule));
businessRouter.get("/rules", requirePermission("settings.view"), asyncHandler(listRules));
businessRouter.post("/rules", requirePermission("settings.edit"), asyncHandler(createRule));
businessRouter.patch("/rules/:ruleId", requirePermission("settings.edit"), asyncHandler(updateRule));
businessRouter.delete("/rules/:ruleId", requirePermission("settings.edit"), asyncHandler(deleteRule));

businessRouter.get("/flows", requirePermission("flows.view"), asyncHandler(listFlows));
businessRouter.post("/flows", requirePermission("flows.create"), asyncHandler(createFlow));
businessRouter.get("/flows/:flowId", requirePermission("flows.view"), asyncHandler(getFlow));
businessRouter.patch("/flows/:flowId", requirePermission("flows.edit"), asyncHandler(updateFlow));
businessRouter.put("/flows/:flowId", requirePermission("flows.edit"), asyncHandler(updateFlow));
businessRouter.post("/flows/:flowId/publish", requirePermission("flows.edit"), asyncHandler(publishFlow));

businessRouter.post("/flows/generate-booking", requirePermission("flows.create"), asyncHandler(generateBookingFlow));
businessRouter.post("/flows/:flowId/archive", requirePermission("flows.edit"), asyncHandler(archiveFlow));

businessRouter.get("/conversations", requirePermission("inbox.view"), asyncHandler(listConversations));
businessRouter.get("/message-templates", requirePermission("inbox.view"), asyncHandler(listWhatsappMessageTemplates));
businessRouter.post("/message-templates", requirePermission("inbox.reply"), asyncHandler(createWhatsappMessageTemplate));
businessRouter.post("/message-templates/:templateId/send", requirePermission("inbox.reply"), asyncHandler(sendWhatsappMessageTemplate));
businessRouter.get("/conversations/:conversationId", requirePermission("inbox.view"), asyncHandler(getConversation));
businessRouter.get("/conversations/:conversationId/messages", requirePermission("inbox.view"), asyncHandler(listMessages));
businessRouter.post("/conversations/:conversationId/messages", requirePermission("inbox.reply"), asyncHandler(sendHumanMessage));
businessRouter.patch("/conversations/:conversationId/read", requirePermission("inbox.view"), asyncHandler(markConversationRead));
businessRouter.patch("/conversations/:conversationId/status", requirePermission("inbox.manage"), asyncHandler(updateConversationStatus));
businessRouter.patch("/conversations/:conversationId/assign", requirePermission("inbox.manage"), asyncHandler(assignConversation));

businessRouter.get("/leads", requirePermission("inbox.view"), asyncHandler(listLeads));
businessRouter.get("/leads/:leadId", requirePermission("inbox.view"), asyncHandler(getLead));
businessRouter.patch("/leads/:leadId", requirePermission("inbox.manage"), asyncHandler(updateLead));
businessRouter.get("/bookings", requirePermission("inbox.view"), asyncHandler(listBookings));
businessRouter.get("/bookings/:bookingId", requirePermission("inbox.view"), asyncHandler(getBooking));
businessRouter.patch("/bookings/:bookingId", requirePermission("inbox.manage"), asyncHandler(updateBooking));
businessRouter.get("/follow-ups", requirePermission("inbox.view"), asyncHandler(listFollowUps));
businessRouter.post("/follow-ups", requirePermission("inbox.manage"), asyncHandler(createFollowUp));
businessRouter.patch("/follow-ups/:followUpId", requirePermission("inbox.manage"), asyncHandler(updateFollowUp));
businessRouter.get("/handoffs", requirePermission("inbox.view"), asyncHandler(listHandoffs));
businessRouter.patch("/handoffs/:handoffId", requirePermission("inbox.manage"), asyncHandler(updateHandoff));
businessRouter.get("/bot-decision-logs", requirePermission("inbox.view"), asyncHandler(listDecisionLogs));

// Team & Access
businessRouter.get("/team", requirePermission("team.view"), asyncHandler(listTeamMembers));
businessRouter.post("/team", requirePermission("team.create"), asyncHandler(createTeamMember));
businessRouter.patch("/team/:memberId", requirePermission("team.edit"), asyncHandler(updateTeamMember));
businessRouter.post("/team/:memberId/reset-password", requirePermission("team.resetPassword"), asyncHandler(resetMemberPassword));
businessRouter.post("/team/:memberId/revoke", requirePermission("team.revoke"), asyncHandler(revokeMemberAccess));
businessRouter.post("/team/:memberId/enable", requirePermission("team.edit"), asyncHandler(enableMemberAccess));
businessRouter.post("/team/:memberId/disable", requirePermission("team.edit"), asyncHandler(disableMemberAccess));
businessRouter.get("/team/:memberId/sessions", requirePermission("team.view"), asyncHandler(listMemberSessions));
businessRouter.delete("/team/:memberId/sessions/:sessionId", requirePermission("team.revoke"), asyncHandler(revokeMemberSession));

businessRouter.get("/audit-logs", requirePermission("settings.view"), asyncHandler(listAuditLogs));

businessesRouter.use("/:businessId", businessRouter);
apiRouter.use("/businesses", businessesRouter);

export { apiRouter };
