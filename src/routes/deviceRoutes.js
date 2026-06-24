import express from "express";
import { registerPushToken, handleMissedCall } from "../controllers/deviceController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/push-token", authMiddleware, registerPushToken);
router.post("/register-token", authMiddleware, registerPushToken);
router.post("/missed-call", authMiddleware, handleMissedCall);

export default router;
