import dotenv from "dotenv";
import axios from "axios";
import { User } from '../models/User.js'; // 👉 Make sure this path is correct for your app!

dotenv.config();
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Quick deduplication to prevent spam if Meta retries
const processedMessageIds = new Set();

// 1️⃣ META WEBHOOK VERIFICATION (Untouched)
export const verifyWebhook = (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
};

// 2️⃣ RECEIVE & REPLY (The absolute basics)
export const receiveWebhook = async (req, res) => {
  // 🔥 ALWAYS return 200 immediately so Meta knows you got it
  res.sendStatus(200);

  try {
    // Dig into Meta's nested JSON payload
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    
    // If there's no message, ignore it (could be a status update like "delivered")
    if (!message) return;

    // Deduplication check
    if (processedMessageIds.has(message.id)) return;
    processedMessageIds.add(message.id);

    // Get sender and receiver details
    const senderPhone = message.from; 
    const receiverPhoneNumberId = change?.metadata?.phone_number_id; 

    console.log(`\n📬 Webhook hit! Message from ${senderPhone} to ${receiverPhoneNumberId}`);

    // 🔥 SAAS MAGIC: Look up which doctor this number belongs to
    const doctor = await User.findOne({ 'whatsappApiDetails.phoneNumberId': receiverPhoneNumberId });
    
    if (!doctor || !doctor.whatsappApiDetails?.accessToken) {
      console.log("❌ Webhook Error: Could not find doctor in DB for this phone number.");
      return;
    }

    const accessToken = doctor.whatsappApiDetails.accessToken;

    // 🚀 SEND THE "HI" REPLY
    console.log("✅ Doctor found! Sending 'Hi' reply...");
    
    await axios.post(
      `https://graph.facebook.com/v19.0/${receiverPhoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: senderPhone,
        type: "text",
        text: { body: "Hi from DentFlow! 👋" },
      },
      { 
        headers: { 
          Authorization: `Bearer ${accessToken}`, 
          "Content-Type": "application/json" 
        } 
      }
    );

    console.log("✅ Reply sent successfully!");

  } catch (err) {
    console.error("❌ Webhook crash:", err.response?.data || err.message);
  }
};