import express from "express";
import { verifyWebhook, receiveWebhook } from "../controllers/whatsappBotController.js";

const router = express.Router();

router.get("/webhook", verifyWebhook);
router.post("/webhook", receiveWebhook);

export default router;