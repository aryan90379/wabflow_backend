import express from "express";
import { registerPushToken, handleMissedCall, getMissedCallStatus } from "../controllers/deviceController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/push-token", authMiddleware, registerPushToken);
router.post("/register-token", authMiddleware, registerPushToken);
router.post("/missed-call", authMiddleware, handleMissedCall);
router.get("/missed-call/status", authMiddleware, getMissedCallStatus);

export default router;
