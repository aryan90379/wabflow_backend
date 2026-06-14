import mongoose from "mongoose";
import { AutomationFlow } from "./src/models/AutomationFlow.js";

async function run() {
  await mongoose.connect("mongodb://127.0.0.1:27017/wabflow_local"); // Adjust connection string if needed
  const flows = await AutomationFlow.find({ version: 2 }).lean();
  console.log(JSON.stringify(flows, null, 2));
  process.exit(0);
}
run();
