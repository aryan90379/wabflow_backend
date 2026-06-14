import mongoose from "mongoose";
import { AutomationFlow } from "./src/models/AutomationFlow.js";
import dotenv from "dotenv";

dotenv.config();

mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/wabflow").then(async () => {
  const flows = await AutomationFlow.find({});
  console.log("Flows:", flows.map(f => ({ id: f._id, name: f.name, status: f.status })));
  process.exit(0);
});
