import { connectDatabase } from "./src/config/db.js";
import { BusinessMember } from "./src/models/BusinessMember.js";

async function run() {
  await connectDatabase();
  console.log("Connected to MongoDB");

  const members = await BusinessMember.find({ memberType: "staff" });
  for (const m of members) {
    if (m.role === "admin") {
      m.permissions.flows = { view: true, create: true, edit: true };
    } else if (m.role === "agent" || m.role === "viewer") {
      m.permissions.flows = { view: true, create: false, edit: false };
    }
    m.markModified("permissions"); // Since it's a mixed schema or nested, markModified might be needed
    await m.save();
  }
  console.log("Updated", members.length, "members");
  process.exit(0);
}
run().catch(console.error);
