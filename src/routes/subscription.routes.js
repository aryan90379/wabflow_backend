import express from 'express';
import { verifyAppleReceipt, verifyGooglePurchase } from '../controllers/subscription.controller.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router({ mergeParams: true });

// Verify Apple In-App Purchase receipt. Need settings.edit to purchase subscription
router.post('/verify-apple-receipt', requirePermission('settings.edit'), asyncHandler(verifyAppleReceipt));
router.post('/verify-google-purchase', requirePermission('settings.edit'), asyncHandler(verifyGooglePurchase));

export default router;
