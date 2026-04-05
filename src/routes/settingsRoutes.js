import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController.js';
import { authMiddleware } from '../middleware/auth.js';
import { connectWhatsApp } from '../controllers/whatsappController.js';

const router = express.Router();

router.get('/', authMiddleware, getSettings);
router.put('/', authMiddleware, updateSettings);
router.post('/whatsapp/connect', authMiddleware, connectWhatsApp);
export default router;
// Make sure to register this in your main Express app: app.use('/api/settings', settingsRoutes);