import express from 'express';
import { verifyAppleReceipt, verifyGooglePurchase } from '../controllers/subscription.controller.js';
import { generateCheckoutToken } from '../controllers/razorpay.controller.js';
import { requirePermission } from '../middleware/permissionMiddleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router({ mergeParams: true });

// Verify Apple In-App Purchase receipt. Need settings.edit to purchase subscription
router.post('/verify-apple-receipt', requirePermission('settings.edit'), asyncHandler(verifyAppleReceipt));
router.post('/verify-google-purchase', requirePermission('settings.edit'), asyncHandler(verifyGooglePurchase));

// Razorpay: Generate short-lived token for web checkout
router.post('/checkout-session', requirePermission('settings.edit'), asyncHandler(generateCheckoutToken));

export default router;
