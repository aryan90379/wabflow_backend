import express from 'express';
import { verifyAppleReceipt } from '../controllers/subscription.controller.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router({ mergeParams: true });

// Verify Apple In-App Purchase receipt. Need settings.edit to purchase subscription
router.post('/verify-apple-receipt', requirePermission('settings.edit'), asyncHandler(verifyAppleReceipt));

export default router;
