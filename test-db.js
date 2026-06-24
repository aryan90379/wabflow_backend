import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { AutomationFlow } from './src/models/index.js';

async function run() {
  await mongoose.connect(env.mongoUri);
  const flows = await AutomationFlow.find({}).sort({ updatedAt: -1 }).limit(1);
  if (flows.length) {
    console.log(JSON.stringify(flows[0].steps, null, 2));
  } else {
    console.log("No flows found");
  }
  process.exit(0);
}
run();
