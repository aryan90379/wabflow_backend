import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireBusinessAccess } from "../middleware/requireBusinessAccess.js";

import {
  appleAuth,
  checkEmail,
  getMe,
  googleAuth,
} from "../controllers/authController.js";
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
  uploadServiceImage,
} from "../controllers/automationController.js";
import {
  getConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendHumanMessage,
  updateConversationStatus,
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
import { receiveWebhook, verifyWebhook } from "../controllers/webhookController.js";

const apiRouter = Router();

apiRouter.get("/health", (req, res) => {
  res.json({ success: true, service: "wabflow-backend", time: new Date().toISOString() });
});

apiRouter.post("/auth/google", asyncHandler(googleAuth));
apiRouter.post("/auth/apple", asyncHandler(appleAuth));
apiRouter.post("/auth/check-email", asyncHandler(checkEmail));
apiRouter.get("/auth/me", authMiddleware, asyncHandler(getMe));

apiRouter.get("/webhooks/whatsapp", verifyWebhook);
apiRouter.post("/webhooks/whatsapp", receiveWebhook);

const businessesRouter = Router();
businessesRouter.use(authMiddleware);
businessesRouter.post("/", asyncHandler(createBusiness));
businessesRouter.get("/", asyncHandler(listMyBusinesses));

const businessRouter = Router({ mergeParams: true });
businessRouter.use(requireBusinessAccess);

businessRouter.get("/", asyncHandler(getBusiness));
businessRouter.patch("/", asyncHandler(updateBusiness));

businessRouter.post("/whatsapp/connect", asyncHandler(connectWhatsApp));
businessRouter.get("/whatsapp/accounts", asyncHandler(listWhatsappAccounts));
businessRouter.delete("/whatsapp/accounts/:accountId", asyncHandler(disconnectWhatsappAccount));

businessRouter.get("/knowledge", asyncHandler(listKnowledge));
businessRouter.post("/knowledge", asyncHandler(createKnowledge));
businessRouter.patch("/knowledge/:knowledgeId", asyncHandler(updateKnowledge));
businessRouter.delete("/knowledge/:knowledgeId", asyncHandler(deleteKnowledge));

businessRouter.get("/services", asyncHandler(listServices));
businessRouter.post("/services", asyncHandler(createService));
businessRouter.patch("/services/:serviceId", asyncHandler(updateService));
businessRouter.delete("/services/:serviceId", asyncHandler(deleteService));
businessRouter.post("/uploads", asyncHandler(uploadMedia));
businessRouter.post("/services/:serviceId/images", asyncHandler(uploadServiceImage));
businessRouter.delete("/services/:serviceId/images", asyncHandler(removeServiceImage));

businessRouter.get("/automation-rules", asyncHandler(listRules));
businessRouter.post("/automation-rules", asyncHandler(createRule));
businessRouter.patch("/automation-rules/:ruleId", asyncHandler(updateRule));
businessRouter.delete("/automation-rules/:ruleId", asyncHandler(deleteRule));
businessRouter.get("/rules", asyncHandler(listRules));
businessRouter.post("/rules", asyncHandler(createRule));
businessRouter.patch("/rules/:ruleId", asyncHandler(updateRule));
businessRouter.delete("/rules/:ruleId", asyncHandler(deleteRule));

businessRouter.get("/flows", asyncHandler(listFlows));
businessRouter.post("/flows", asyncHandler(createFlow));
businessRouter.get("/flows/:flowId", asyncHandler(getFlow));
businessRouter.put("/flows/:flowId", asyncHandler(updateFlow));
businessRouter.post("/flows/:flowId/publish", asyncHandler(publishFlow));
businessRouter.post("/flows/:flowId/archive", asyncHandler(archiveFlow));

businessRouter.get("/conversations", asyncHandler(listConversations));
businessRouter.get("/conversations/:conversationId", asyncHandler(getConversation));
businessRouter.get("/conversations/:conversationId/messages", asyncHandler(listMessages));
businessRouter.post("/conversations/:conversationId/messages", asyncHandler(sendHumanMessage));
businessRouter.patch("/conversations/:conversationId/read", asyncHandler(markConversationRead));
businessRouter.patch("/conversations/:conversationId/status", asyncHandler(updateConversationStatus));

businessRouter.get("/leads", asyncHandler(listLeads));
businessRouter.get("/leads/:leadId", asyncHandler(getLead));
businessRouter.patch("/leads/:leadId", asyncHandler(updateLead));
businessRouter.get("/bookings", asyncHandler(listBookings));
businessRouter.get("/bookings/:bookingId", asyncHandler(getBooking));
businessRouter.patch("/bookings/:bookingId", asyncHandler(updateBooking));
businessRouter.get("/follow-ups", asyncHandler(listFollowUps));
businessRouter.post("/follow-ups", asyncHandler(createFollowUp));
businessRouter.patch("/follow-ups/:followUpId", asyncHandler(updateFollowUp));
businessRouter.get("/handoffs", asyncHandler(listHandoffs));
businessRouter.patch("/handoffs/:handoffId", asyncHandler(updateHandoff));
businessRouter.get("/bot-decision-logs", asyncHandler(listDecisionLogs));

businessesRouter.use("/:businessId", businessRouter);
apiRouter.use("/businesses", businessesRouter);

export { apiRouter };
