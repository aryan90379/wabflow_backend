import express from 'express';
import { getCampaigns, createCampaign } from '../controllers/campaignController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authMiddleware, getCampaigns);
router.post('/', authMiddleware, createCampaign);

export default router;