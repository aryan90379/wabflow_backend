/**
 * Migration: Add `flows` permissions to existing BusinessMember documents
 * that were created before the `flows` permission was added to the schema.
 *
 * Run: node migrate_flows_permission.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wabflow';

const permissionsSchema = new mongoose.Schema(
  {
    inbox: {
      view: { type: Boolean, default: false },
      reply: { type: Boolean, default: false },
      manage: { type: Boolean, default: false },
    },
    team: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      revoke: { type: Boolean, default: false },
      resetPassword: { type: Boolean, default: false },
    },
    settings: {
      view: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
    },
    flows: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
    },
  },
  { _id: false }
);

const businessMemberSchema = new mongoose.Schema(
  {
    memberType: { type: String },
    role: { type: String },
    permissions: { type: permissionsSchema, default: () => ({}) },
  },
  { timestamps: true, strict: false }
);

const BusinessMember = mongoose.models.BusinessMember || mongoose.model('BusinessMember', businessMemberSchema);

async function migrate() {
  console.log('🔗 Connecting to MongoDB:', MONGODB_URI.replace(/\/\/.*@/, '//***@'));
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected');

  // Find all members where 'permissions.flows' is missing or null
  const membersToFix = await BusinessMember.find({
    $or: [
      { 'permissions.flows': { $exists: false } },
      { 'permissions.flows': null },
    ]
  }).lean();

  console.log(`\n📋 Found ${membersToFix.length} members without flows permission`);

  if (membersToFix.length === 0) {
    console.log('✅ Nothing to migrate. All members already have flows permission.');
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const member of membersToFix) {
    try {
      // Determine flows permission based on role
      // admin/owner → full access; agent/viewer → view only; others → no access
      const role = member.role || 'agent';
      let flowsPermission = { view: false, create: false, edit: false };

      if (role === 'owner' || role === 'admin') {
        flowsPermission = { view: true, create: true, edit: true };
      } else if (role === 'agent' || role === 'viewer' || role === 'manager') {
        flowsPermission = { view: true, create: false, edit: false };
      }

      await BusinessMember.updateOne(
        { _id: member._id },
        { $set: { 'permissions.flows': flowsPermission } }
      );

      console.log(`  ✅ Updated ${member.name || member._id} (${role}) → flows: view=${flowsPermission.view}, create=${flowsPermission.create}, edit=${flowsPermission.edit}`);
      updated++;
    } catch (err) {
      console.error(`  ❌ Failed to update ${member._id}:`, err.message);
      errors++;
    }
  }

  console.log(`\n🎉 Migration complete: ${updated} updated, ${errors} errors`);
  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB');
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
