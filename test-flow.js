import mongoose from 'mongoose';
import { AutomationFlow } from './src/models/index.js';
mongoose.connect('mongodb://localhost:27017/wabflow').then(async () => {
  const flows = await AutomationFlow.find({});
  for (const flow of flows) {
    if (JSON.stringify(flow).includes('What specific booking do you need')) {
      console.log('FOUND IN FLOW:', flow._id);
      console.log(JSON.stringify(flow.steps.find(s => JSON.stringify(s).includes('What specific booking do you need')), null, 2));
    }
  }
  process.exit();
});
