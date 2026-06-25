import appleReceiptVerify from 'apple-receipt-verify';
import { Business } from '../models/Business.js';
import crypto from 'crypto';

// Initialize the Apple Receipt Verification configuration
appleReceiptVerify.config({
  secret: process.env.APPLE_SHARED_SECRET || "DUMMY_SECRET_FOR_NOW", // User will need to set this
  environment: ['sandbox', 'production'], 
  excludeOldTransactions: true,
});

export const verifyAppleReceipt = async (req, res) => {
  try {
    const { receiptData } = req.body;
    
    if (!receiptData) {
      return res.status(400).json({ success: false, error: 'Receipt data is required' });
    }

    const businessId = req.business?._id || req.business?.id;
    if (!businessId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Business ID not found' });
    }

    // Verify receipt with Apple
    let products;
    try {
      products = await appleReceiptVerify.validate({ receipt: receiptData });
    } catch (err) {
      console.error('Apple receipt validation failed:', err);
      return res.status(400).json({ success: false, error: 'Invalid receipt' });
    }
    
    if (!products || products.length === 0) {
       return res.status(400).json({ success: false, error: 'No active subscriptions found in receipt' });
    }

    // Find the latest active subscription (usually sorted by expirationDate)
    const activeSubscription = products.find(p => p.productId === 'com.synqra.wabflow.starter.monthly');
    
    if (!activeSubscription) {
      return res.status(400).json({ success: false, error: 'Target product not found in receipt' });
    }

    // Check if it's expired
    const expirationDate = new Date(activeSubscription.expirationDate);
    const now = new Date();
    
    if (expirationDate < now) {
      return res.status(400).json({ success: false, error: 'Subscription is expired' });
    }

    // Update the business in the database
    const updatedBusiness = await Business.findByIdAndUpdate(
      businessId,
      {
        $set: {
          'subscription.plan': 'starter',
          'subscription.validUntil': expirationDate
        }
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Subscription verified successfully',
      business: updatedBusiness
    });

  } catch (error) {
    console.error('Error in verifyAppleReceipt:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
