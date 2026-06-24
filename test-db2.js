import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { AutomationFlow } from './src/models/index.js';

async function run() {
  await mongoose.connect(env.mongoUri);
  const flows = await AutomationFlow.find({});
  for (const flow of flows) {
    console.log("Flow:", flow._id);
    console.log(JSON.stringify(flow.steps[0], null, 2));
  }
  process.exit(0);
}
run();
