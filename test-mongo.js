import mongoose from "mongoose";
import { QrShortLink } from "./src/models/QrShortLink.js";
import { Business } from "./src/models/Business.js";

async function run() {
  await mongoose.connect("mongodb://localhost:27017/wabflow");
  const business = await Business.findOne({ name: "Premium Spa & Salon" });
  if (!business) {
    console.log("No business found");
    process.exit(0);
  }
  const links = await QrShortLink.find({ businessId: business._id });
  console.log(JSON.stringify(links, null, 2));
  process.exit(0);
}
run();
