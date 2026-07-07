import { GoogleAuth } from 'google-auth-library';
import { Business } from '../models/Business.js';
import { env } from '../config/env.js';

// Apple Receipt Verification config will be initialized inside the handler
// to ensure process.env variables are loaded
const STARTER_PRODUCT_ID = 'com.synqra.wabflow.starter.monthly';
const GOOGLE_PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

const getGooglePlayCredentials = () => {
  if (env.googlePlayServiceAccountJson) {
    try {
      return JSON.parse(env.googlePlayServiceAccountJson);
    } catch (error) {
      throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  }

  if (env.googlePlayClientEmail && env.googlePlayPrivateKey) {
    return {
      client_email: env.googlePlayClientEmail,
      private_key: env.googlePlayPrivateKey.replace(/\\n/g, '\n'),
    };
  }

  throw new Error('Google Play service account credentials are not configured');
};

const getGooglePlayAccessToken = async () => {
  const auth = new GoogleAuth({
    credentials: getGooglePlayCredentials(),
    scopes: [GOOGLE_PLAY_SCOPE],
  });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  return typeof accessToken === 'string' ? accessToken : accessToken?.token;
};

const findGoogleSubscriptionLineItem = (subscriptionData, productId) => {
  const lineItems = Array.isArray(subscriptionData?.lineItems) ? subscriptionData.lineItems : [];
  return lineItems.find((item) => item.productId === productId) || lineItems[0] || null;
};

const isGoogleSubscriptionActive = (subscriptionData, expiryTime) => {
  const activeStates = new Set([
    'SUBSCRIPTION_STATE_ACTIVE',
    'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  ]);
  const stateIsActive = activeStates.has(subscriptionData?.subscriptionState);
  return stateIsActive && expiryTime && expiryTime.getTime() > Date.now();
};

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
        
        if (payload.productId !== STARTER_PRODUCT_ID) {
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

export const verifyGooglePurchase = async (req, res) => {
  try {
    const { purchaseToken, productId = STARTER_PRODUCT_ID } = req.body;

    if (!purchaseToken) {
      return res.status(400).json({ success: false, error: 'Purchase token is required' });
    }

    if (productId !== STARTER_PRODUCT_ID) {
      return res.status(400).json({ success: false, error: 'Unsupported subscription product' });
    }

    const businessId = req.business?._id || req.business?.id;
    if (!businessId) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Business ID not found' });
    }

    const accessToken = await getGooglePlayAccessToken();
    if (!accessToken) {
      return res.status(500).json({ success: false, error: 'Could not authenticate with Google Play' });
    }

    const verifyUrl = new URL(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${env.googlePlayPackageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`
    );

    const googleRes = await fetch(verifyUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const googleData = await googleRes.json().catch(() => ({}));
    if (!googleRes.ok) {
      console.error('Google Play verification failed:', googleRes.status, googleData);
      return res.status(400).json({
        success: false,
        error: googleData?.error?.message || 'Google Play rejected purchase',
      });
    }

    const lineItem = findGoogleSubscriptionLineItem(googleData, productId);
    if (!lineItem || lineItem.productId !== productId) {
      return res.status(400).json({ success: false, error: 'Target product not found in Google purchase' });
    }

    const expiryTime = lineItem.expiryTime ? new Date(lineItem.expiryTime) : null;
    if (!isGoogleSubscriptionActive(googleData, expiryTime)) {
      return res.status(400).json({ success: false, error: 'Google subscription is not active' });
    }

    const updatedBusiness = await Business.findByIdAndUpdate(
      businessId,
      {
        $set: {
          'subscription.plan': 'starter',
          'subscription.validUntil': expiryTime,
          'subscription.googlePurchaseToken': purchaseToken,
          'subscription.googleOrderId': googleData.latestOrderId || '',
        },
      },
      { new: true }
    );

    return res.status(200).json({ success: true, business: updatedBusiness });
  } catch (error) {
    console.error('Error in verifyGooglePurchase:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};
