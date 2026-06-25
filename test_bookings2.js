import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Booking = mongoose.connection.collection('bookings');
  const bookings = await Booking.find({}).sort({createdAt: -1}).limit(2).toArray();
  console.log(JSON.stringify(bookings.map(b => ({ id: b._id, customerName: b.customerName, customFields: b.customFields, notes: b.notes })), null, 2));
  process.exit();
}).catch(console.error);
