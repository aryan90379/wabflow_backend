import mongoose from 'mongoose';
import { Booking } from './src/models/Booking.js';

mongoose.connect('mongodb://localhost:27017/wabflow').then(async () => {
  const bookings = await Booking.find().sort({createdAt: -1}).limit(3);
  console.log(JSON.stringify(bookings.map(b => ({
    id: b._id,
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    notes: b.notes,
    customFields: b.customFields
  })), null, 2));
  process.exit();
}).catch(console.error);
