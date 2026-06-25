import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { User } from './src/models/User.js';
import { Business } from './src/models/Business.js';

async function check() {
  await mongoose.connect(env.mongoUrl);
  const user = await User.findOne({ email: 'expired@wabflow.com' });
  console.log("User:", user?.email);
  if (user) {
    const business = await Business.findOne({ ownerId: user._id });
    console.log("Business trialEndsAt:", business?.trialEndsAt);
    console.log("Now:", new Date());
    console.log("Days diff:", Math.ceil((business?.trialEndsAt - new Date()) / (1000 * 60 * 60 * 24)));
  }
  process.exit(0);
}
check();
