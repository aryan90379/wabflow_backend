import express from 'express';
import { getCalendarAuthUrl, handleCalendarCallback } from '../controllers/calendarController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Protected route to generate URL (needs frontend token)
router.get('/auth-url', authMiddleware, getCalendarAuthUrl);

// Public route for Google to redirect to (validates using the 'state' parameter)
router.get('/callback', handleCalendarCallback);

export default router;