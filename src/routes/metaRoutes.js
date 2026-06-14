import express from "express";
import {
  createWhatsappConnectState,
  metaWhatsappCallback,
} from "../controllers/metaWhatsappOAuthController.js";
import { authMiddleware } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/whatsapp/state", authMiddleware, createWhatsappConnectState);
router.get("/whatsapp/callback", metaWhatsappCallback);

export default router;