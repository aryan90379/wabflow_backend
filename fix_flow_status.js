import mongoose from "mongoose";
import { AutomationFlow } from "./src/models/AutomationFlow.js";
import dotenv from "dotenv";

dotenv.config();

mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/wabflow").then(async () => {
  const result = await AutomationFlow.updateMany(
    { name: "Welcome Assistant", status: "draft" },
    { $set: { status: "published" } }
  );
  console.log("Updated flows:", result.modifiedCount);
  process.exit(0);
});
