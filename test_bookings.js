import mongoose from 'mongoose';
import { Booking } from './src/models/Booking.js';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const bookings = await Booking.find({}).sort({createdAt: -1}).limit(5);
  console.log(JSON.stringify(bookings.map(b => ({ id: b._id, customerName: b.customerName, customFields: b.customFields })), null, 2));
  process.exit();
});
