import mongoose from 'mongoose';
import { AutomationFlow } from './src/models/AutomationFlow.js';

mongoose.connect('mongodb://localhost:27017/wabflow').then(async () => {
  const flow = await AutomationFlow.findOne({ isDefault: true }).lean();
  console.log("Default Flow:", JSON.stringify(flow?.steps || flow?.nodes, null, 2));
  process.exit(0);
});
