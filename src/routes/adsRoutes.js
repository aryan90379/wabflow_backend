import express from 'express';
import { authMiddleware } from '../middleware/auth.js'; 
import { getAdsAuthUrl, handleAdsCallback } from '../controllers/ads/auth.controller.js';
import { getAdvancedMetrics } from '../controllers/ads/metrics.controller.js';
import { launchAutomatedCampaign } from '../controllers/ads/campaign.controller.js';

const router = express.Router();

router.get('/auth-url', authMiddleware, getAdsAuthUrl);
router.get('/callback', handleAdsCallback); 
router.get('/metrics', authMiddleware, getAdvancedMetrics);
router.post('/launch', authMiddleware, launchAutomatedCampaign);

export default router;