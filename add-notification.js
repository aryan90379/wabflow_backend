import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Notification } from './src/models/Notification.js'; // Ensure path matches your structure

dotenv.config();

// 🔥 EDIT THESE DETAILS
const TARGET_EMAIL = "songrimleader@gmail.com"; // The influencer's email
const NOTIFICATION_DATA = {
    title: "hey bro! 🎉",
    message: "You have been selected for the 'Summer Glow' campaign. Check your dashboard to start.",
    type: "campaign", // Options: 'payment', 'campaign', 'system', 'action_required'
    image: "https://cdn-icons-png.flaticon.com/512/1162/1162951.png", // Optional Icon
    actionLink: "CampaignDetails", // Where clicking takes them
    metaData: { campaignId: "12345" } // Optional extra data
};

const run = async () => {
  try {
    // 1. Connect
    if (!process.env.MONGO_URI) throw new Error("❌ MONGO_URI missing in .env");
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to DB');

    // 2. Create
    const newNotif = await Notification.create({
        recipient: TARGET_EMAIL,
        ...NOTIFICATION_DATA,
        isRead: false,
        createdAt: new Date()
    });

    console.log("------------------------------------------------");
    console.log("✅ Notification Sent Successfully!");
    console.log("🆔 ID:", newNotif._id);
    console.log("📧 To:", newNotif.recipient);
    console.log("------------------------------------------------");

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

run();