import express from 'express';
import { googleAuth, checkEmail, appleAuth } from '../controllers/authController.js';
const router = express.Router();

router.post('/google', googleAuth);
router.post('/apple', appleAuth); // 🍎 Added Apple Route
router.post('/check-email', checkEmail);

export default router;