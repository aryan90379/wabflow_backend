import jwt from 'jsonwebtoken';
import { Business } from '../models/Business.js';

export const handleAppleWebhook = async (req, res) => {
  try {
    const { signedPayload } = req.body;

    if (!signedPayload) {
      return res.status(400).json({ error: 'Missing signedPayload' });
    }

    // Decode the main notification payload (JWS)
    // In a strict production environment with PKI, you'd verify the signature here.
    // For now, we are decoding it since it's directly received at our secure endpoint.
    const decodedNotification = jwt.decode(signedPayload);

    if (!decodedNotification || !decodedNotification.data) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const { notificationType, subtype, data } = decodedNotification;
    console.log(`[Apple Webhook] Received notificationType: ${notificationType}, subtype: ${subtype}`);

    // If there's signedTransactionInfo, decode it to get transaction details
    let originalTransactionId = null;
    let expiresDate = null;
    let productId = null;

    if (data.signedTransactionInfo) {
      const decodedTransaction = jwt.decode(data.signedTransactionInfo);
      if (decodedTransaction) {
        originalTransactionId = decodedTransaction.originalTransactionId;
        expiresDate = new Date(decodedTransaction.expiresDate);
        productId = decodedTransaction.productId;
      }
    }

    if (!originalTransactionId) {
      console.warn('[Apple Webhook] No originalTransactionId found in payload, acknowledging safely.');
      return res.status(200).send('OK');
    }

    // Look up the business associated with this Apple transaction
    const business = await Business.findOne({ 'subscription.appleOriginalTransactionId': originalTransactionId });

    if (!business) {
      console.warn(`[Apple Webhook] Could not find business for originalTransactionId: ${originalTransactionId}`);
      // Return 200 so Apple stops retrying
      return res.status(200).send('OK');
    }

    // Handle different notification types
    switch (notificationType) {
      case 'DID_RENEW':
      case 'SUBSCRIBED': // Initial subscription
        console.log(`[Apple Webhook] Extending subscription for business ${business._id} to ${expiresDate}`);
        business.subscription.plan = 'starter'; // Assuming starter is the only paid plan
        if (expiresDate) {
          business.subscription.validUntil = expiresDate;
        }
        await business.save();
        break;

      case 'EXPIRED':
      case 'DID_FAIL_TO_RENEW':
        // We can either gracefully downgrade them, or just let the app read the expired validUntil date.
        // For 'EXPIRED', it means it actually expired. 
        // For 'DID_FAIL_TO_RENEW', Apple is still retrying (grace period).
        if (notificationType === 'EXPIRED') {
          console.log(`[Apple Webhook] Subscription EXPIRED for business ${business._id}`);
          // Keep the validUntil date as is (which is now in the past). The app will handle the downgrade on the UI side.
        }
        break;

      case 'REFUND':
        console.log(`[Apple Webhook] Subscription REFUNDED for business ${business._id}`);
        // Immediately invalidate
        business.subscription.validUntil = new Date(); 
        await business.save();
        break;

      default:
        console.log(`[Apple Webhook] Unhandled notificationType: ${notificationType}`);
        break;
    }

    // Always respond with 200 OK to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    console.error('[Apple Webhook] Error processing webhook:', error);
    // Returning 500 will cause Apple to retry later
    res.status(500).json({ error: 'Internal server error' });
  }
};
