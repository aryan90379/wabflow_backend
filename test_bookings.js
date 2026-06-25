import mongoose from 'mongoose';
import { Booking } from './src/models/Booking.js';
import { Conversation } from './src/models/Conversation.js';

mongoose.connect('mongodb://localhost:27017/wabflow').then(async () => {
  const latestBooking = await Booking.findOne().sort({ createdAt: -1 }).lean();
  console.log("Latest Booking:", JSON.stringify(latestBooking, null, 2));

  if (latestBooking) {
    const convo = await Conversation.findById(latestBooking.conversationId).lean();
    console.log("Conversation variables:", convo?.botState?.variables);
  }
  process.exit(0);
});
