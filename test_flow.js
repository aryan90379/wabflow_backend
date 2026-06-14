import mongoose from "mongoose";
import { AutomationFlow } from "./src/models/index.js";
import { env } from "./src/config/env.js";

async function run() {
  await mongoose.connect(env.mongoUri);
  const flow = await AutomationFlow.findOne({ status: "published" }).sort({ createdAt: -1 });
  if (!flow) {
    console.log("No published flow found");
    return;
  }
  console.log("Flow version:", flow.version);
  console.log("Entry step:", flow.entryStepId);
  const entry = flow.steps.find(s => s.id === flow.entryStepId);
  console.log("Entry step config:", JSON.stringify(entry.config, null, 2));
  console.log("All steps IDs:", flow.steps.map(s => s.id));
  process.exit(0);
}
run();
