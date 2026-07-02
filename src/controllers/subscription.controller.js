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

    console.log("--> Received Receipt Data (length):", receiptData.length);

    // Apple's API throws 21002 if there are any line breaks or spaces in the Base64 string!
    const cleanReceiptData = typeof receiptData === 'string' ? receiptData.replace(/\s+/g, '') : receiptData;

    // --- STOREKIT 2 (JWS) SUPPORT ---
    if (typeof cleanReceiptData === 'string' && cleanReceiptData.includes('.')) {
      console.log("--> Detected StoreKit 2 JWS Token!");
      try {
        const payloadBase64 = cleanReceiptData.split('.')[1];
        const payloadString = Buffer.from(payloadBase64, 'base64').toString('utf8');
        const payload = JSON.parse(payloadString);
        
        console.log("--> SK2 Payload Product:", payload.productId);
        
        if (payload.productId !== 'com.synqra.wabflow.starter.monthly') {
          return res.status(400).json({ success: false, error: 'Target product not found in receipt' });
        }
        
        const expirationDate = payload.expiresDate || (Date.now() + 30 * 24 * 60 * 60 * 1000);
        if (expirationDate < Date.now()) {
          return res.status(400).json({ success: false, error: 'Subscription is expired' });
        }

        const updatedBusiness = await Business.findByIdAndUpdate(
          businessId,
          { $set: { 'subscription.plan': 'starter', 'subscription.validUntil': new Date(expirationDate) } },
          { new: true }
        );
        return res.status(200).json({ success: true, business: updatedBusiness });
      } catch (err) {
        console.error("--> Failed to parse JWS:", err);
        return res.status(400).json({ success: false, error: 'Invalid StoreKit 2 receipt format' });
      }
    }

    // --- STOREKIT 1 (BASE64) SUPPORT ---
    console.log("--> Detected StoreKit 1 Base64 Receipt. Validating with Apple...");
    const fetch = (await import('node-fetch')).default;
    const appleRes = await fetch('https://sandbox.itunes.apple.com/verifyReceipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'receipt-data': cleanReceiptData,
        'password': env.appleSharedSecret || "DUMMY_SECRET_FOR_NOW"
      })
    });
    
    const appleData = await appleRes.json();
    console.log("--> APPLE RESPONSE STATUS:", appleData.status);
    
    if (appleData.status !== 0) {
       console.log("--> APPLE REJECTED IT! Error Code:", appleData.status);
       const debugInfo = `Code: ${appleData.status}. Type: ${typeof cleanReceiptData}. Len: ${cleanReceiptData ? cleanReceiptData.length : 0}`;
       return res.status(400).json({ success: false, error: `Apple rejected receipt. ${debugInfo}` });
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
