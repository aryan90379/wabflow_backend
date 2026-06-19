import express from "express";
import { registerPushToken } from "../controllers/deviceController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/push-token", authMiddleware, registerPushToken);

export default router;
