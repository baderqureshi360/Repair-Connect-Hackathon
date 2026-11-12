/**
 * Demo account cleanup — DESTRUCTIVE only with dual confirmation.
 *
 * Default mode is dry-run (plan only):
 *   npx tsx src/scripts/cleanupDemoAccounts.ts
 *
 * Execute (staging / explicit maintenance only):
 *   CLEANUP_CONFIRM=DELETE_DEMO_ACCOUNTS npx tsx src/scripts/cleanupDemoAccounts.ts --execute
 *
 * Refuses NODE_ENV=production unless CLEANUP_ALLOW_PRODUCTION=YES is also set.
 * Never run against production without a signed maintenance window.
 */
import { connectDb, disconnectDb } from '../config/db.js';
import { DEMO_ACCOUNT_EMAILS, env } from '../config/env.js';
import {
  Appointment,
  Part,
  RepairRequest,
  RepairShop,
  ShopMembership,
  User
} from '../models/index.js';

const DEMO_EMAIL_RE = /@repairconnect\.local$/i;
const execute = process.argv.includes('--execute');

async function main() {
  if (execute) {
    if (env.isProd && process.env.CLEANUP_ALLOW_PRODUCTION !== 'YES') {
      throw new Error(
        'Refusing destructive cleanup in production without CLEANUP_ALLOW_PRODUCTION=YES'
      );
    }
    if (process.env.CLEANUP_CONFIRM !== 'DELETE_DEMO_ACCOUNTS') {
      throw new Error(
        'Refusing execute: set CLEANUP_CONFIRM=DELETE_DEMO_ACCOUNTS after reviewing the deletion plan'
      );
    }
  }

  await connectDb();

  const users = await User.find({
    $or: [{ email: { $in: [...DEMO_ACCOUNT_EMAILS] } }, { email: DEMO_EMAIL_RE }]
  });
  const shops = await RepairShop.find({
    $or: [
      { email: { $in: ['lhr@repairconnect.local', 'khi@repairconnect.local'] } },
      { email: DEMO_EMAIL_RE },
      { code: { $in: ['LHR01', 'KHI01', 'LHR1', 'KHI1'] } }
    ]
  });

  const plan = {
    mode: execute ? 'EXECUTE' : 'DRY_RUN',
    users: users.map((u) => ({ id: String(u._id), email: u.email, role: u.role })),
    shops: shops.map((s) => ({ id: String(s._id), name: s.name, code: s.code, email: s.email })),
    note: execute
      ? 'Deleting demo users/memberships/shops and related seed repairs/parts/appointments for those shop ids only.'
      : 'No deletions performed. Re-run with --execute and CLEANUP_CONFIRM after approval.'
  };
  console.log(JSON.stringify(plan, null, 2));

  if (!execute) {
    await disconnectDb();
    return;
  }

  const userIds = users.map((u) => u._id);
  const shopIds = shops.map((s) => s._id);

  const deleted = {
    appointments: (await Appointment.deleteMany({ shop: { $in: shopIds } })).deletedCount,
    repairs: (
      await RepairRequest.deleteMany({
        $or: [{ shop: { $in: shopIds } }, { customer: { $in: userIds } }]
      })
    ).deletedCount,
    parts: (await Part.deleteMany({ shop: { $in: shopIds } })).deletedCount,
    memberships: (
      await ShopMembership.deleteMany({
        $or: [{ shop: { $in: shopIds } }, { user: { $in: userIds } }]
      })
    ).deletedCount,
    shops: (await RepairShop.deleteMany({ _id: { $in: shopIds } })).deletedCount,
    users: (await User.deleteMany({ _id: { $in: userIds } })).deletedCount
  };

  console.log(JSON.stringify({ success: true, deleted }, null, 2));
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[cleanup-demo] FAIL', err instanceof Error ? err.message : err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
