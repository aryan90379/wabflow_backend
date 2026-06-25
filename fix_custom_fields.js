import mongoose from 'mongoose';
import { Booking } from './src/models/Booking.js';
import { Message } from './src/models/Message.js';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

function parseFlowReplyResponse(message = {}) {
  if (message.media?.responseJson) return message.media.responseJson;
  return message.rawPayload?.interactive?.nfm_reply?.response_json ? JSON.parse(message.rawPayload.interactive.nfm_reply.response_json) : null;
}

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const bookings = await Booking.find({});
  let fixed = 0;
  for (const booking of bookings) {
    if (!booking.customFields || booking.customFields.length === 0) {
      const msg = await Message.findOne({
        conversationId: booking.conversationId,
        type: 'flow_reply'
      }).sort({ createdAt: -1 });

      if (msg) {
        const responseJson = parseFlowReplyResponse(msg);
        if (responseJson) {
          const customFields = [];
          Object.keys(responseJson).forEach(key => {
            if (key.startsWith('custom_')) {
              customFields.push({
                name: key,
                question: `Custom Field ${parseInt(key.replace('custom_', '')) + 1}`,
                value: String(responseJson[key])
              });
            }
          });
          if (customFields.length > 0) {
            booking.customFields = customFields;
            await booking.save();
            fixed++;
          }
        }
      }
    }
  }
  console.log(`Fixed ${fixed} bookings.`);
  process.exit();
}).catch(console.error);
