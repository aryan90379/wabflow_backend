import mongoose from "mongoose";
import { BroadcastRecipient } from "./src/models/BroadcastRecipient.js";
import { env } from "./src/config/env.js";

async function run() {
  await mongoose.connect(env.mongoUri);
  const recipients = await BroadcastRecipient.find({ phone: "919057843367" }).sort({ createdAt: -1 }).limit(5);
  console.log(JSON.stringify(recipients, null, 2));
  process.exit(0);
}
run();
