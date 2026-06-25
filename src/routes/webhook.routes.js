import { Router } from 'express';
import { handleAppleWebhook } from '../controllers/webhook.controller.js';

const router = Router();

// Endpoint for Apple App Store Server Notifications V2
router.post('/apple', handleAppleWebhook);

export default router;
