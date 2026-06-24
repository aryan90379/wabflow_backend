import mongoose from "mongoose";
import { generateDummyData } from "./src/services/dummyDataService.js";
import { User } from "./src/models/User.js";

async function run() {
  await mongoose.connect("mongodb://localhost:27017/wabflow");
  const user = await User.findOne({ email: "demo@wabflow.com" });
  if (!user) {
    console.log("Demo user not found");
    process.exit(0);
  }
  await generateDummyData(user);
  console.log("Done");
  process.exit(0);
}
run();
