/**
 * Protected CLI for shop-owner application provisioning (MVP).
 *
 * Usage:
 *   npx tsx src/scripts/provisionShopApplication.ts approve --id SA-xxxx [--remarks "..."]
 *   npx tsx src/scripts/provisionShopApplication.ts reject --id SA-xxxx --reason "..."
 *   npx tsx src/scripts/provisionShopApplication.ts claim --id SA-xxxx --email owner@example.com
 *
 * Requires PROVISIONING_API_KEY in the monorepo root .env (min 16 chars).
 * Does not create a platform super-admin role.
 */
import { env } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import {
  approveShopApplication,
  claimShopApplication,
  rejectShopApplication
} from '../services/shopApplications.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main() {
  if (!env.provisioningApiKey || env.provisioningApiKey.length < 16) {
    throw new Error(
      'Set PROVISIONING_API_KEY (min 16 chars) in the monorepo root .env before provisioning.'
    );
  }

  const action = process.argv[2];
  const publicId = arg('--id');
  if (!action || !publicId) {
    console.log(`Usage:
  approve --id SA-... [--remarks "..."]
  reject  --id SA-... --reason "..."
  claim   --id SA-... --email owner@example.com`);
    process.exit(1);
  }

  await connectDb();

  if (action === 'approve') {
    const result = await approveShopApplication({
      publicId,
      remarks: arg('--remarks') || '',
      actorLabel: 'provisioning-cli'
    });
    console.log('APPROVED', result);
  } else if (action === 'reject') {
    const reason = arg('--reason');
    if (!reason) throw new Error('--reason is required');
    const result = await rejectShopApplication({
      publicId,
      reason,
      actorLabel: 'provisioning-cli'
    });
    console.log('REJECTED', result);
  } else if (action === 'claim') {
    const ownerEmail = arg('--email');
    if (!ownerEmail) throw new Error('--email is required');
    const result = await claimShopApplication({
      publicId,
      ownerEmail,
      actorLabel: 'provisioning-cli'
    });
    console.log('CLAIMED', result);
  } else {
    throw new Error(`Unknown action: ${action}`);
  }

  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
