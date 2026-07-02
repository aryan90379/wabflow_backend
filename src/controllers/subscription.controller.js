import * as appleReceiptVerify from 'apple-receipt-verify';
import { Business } from '../models/Business.js';
import { env } from '../config/env.js';
import crypto from 'crypto';

// Apple Receipt Verification config will be initialized inside the handler
// to ensure process.env variables are loaded

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

    console.log("--> Sending receipt to Apple Sandbox...");
    console.log("--> Using Secret:", env.appleSharedSecret ? "LOADED" : "MISSING");
    
    const fetch = (await import('node-fetch')).default;
    const appleRes = await fetch('https://sandbox.itunes.apple.com/verifyReceipt', {
      method: 'POST',
      body: JSON.stringify({
        'receipt-data': receiptData,
        'password': env.appleSharedSecret || "DUMMY_SECRET_FOR_NOW"
      })
    });
    
    const appleData = await appleRes.json();
    console.log("--> APPLE RESPONSE STATUS:", appleData.status);
    
    if (appleData.status !== 0) {
       console.log("--> APPLE REJECTED IT! Error Code:", appleData.status);
       return res.status(400).json({ success: false, error: `Apple rejected receipt. Code: ${appleData.status}` });
    }

    if (!appleData.receipt || !appleData.receipt.in_app || appleData.receipt.in_app.length === 0) {
      return res.status(400).json({ success: false, error: 'No active subscriptions found in receipt' });
    }

    // Update the business in the database if successful
    const updatedBusiness = await Business.findByIdAndUpdate(
      businessId,
      {
        $set: {
          'subscription.plan': 'starter',
          'subscription.validUntil': new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days fallback
        }
      },
      { new: true }
    );

    res.status(200).json({ success: true, business: updatedBusiness });

  } catch (error) {
    console.error('Error in verifyAppleReceipt:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
