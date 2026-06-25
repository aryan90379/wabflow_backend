import mongoose from 'mongoose';
import { Booking } from './src/models/Booking.js';

mongoose.connect('mongodb://localhost:27017/wabflow').then(async () => {
  const booking = new Booking({
    businessId: new mongoose.Types.ObjectId(),
    contactId: new mongoose.Types.ObjectId(),
    conversationId: new mongoose.Types.ObjectId(),
    status: "requested",
  });
  await booking.save();
  
  const fetchedBooking = await Booking.findById(booking._id);
  fetchedBooking.customFields = [{ name: 'custom_0', question: 'Test Q', value: 'Test A' }];
  await fetchedBooking.save();

  const verifyBooking = await Booking.findById(booking._id).lean();
  console.log("Custom Fields:", verifyBooking.customFields);
  process.exit(0);
});
