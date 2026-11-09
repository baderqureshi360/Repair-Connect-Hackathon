/**
 * Secure bootstrap for the initial platform onboarding operator.
 *
 * Does NOT create a default account. Requires:
 *   - PROVISIONING_API_KEY in root .env (min 16 chars)
 *   - Matching --confirm-key argument (proves operator holds the secret)
 *   - Explicit email, name, and password (never hardcoded)
 *
 * Usage:
 *   npm run platform:create-operator -w server -- \
 *     --email ops@yourdomain.com \
 *     --name "Platform Ops" \
 *     --password 'YourStrongPass1' \
 *     --confirm-key "$PROVISIONING_API_KEY"
 *
 * Or pipe password:
 *   echo 'YourStrongPass1' | npm run platform:create-operator -w server -- \
 *     --email ops@yourdomain.com --name "Platform Ops" --password-stdin \
 *     --confirm-key "$PROVISIONING_API_KEY"
 */
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';
import { User } from '../models/User.js';
import { strongPasswordSchema } from '../validators/password.js';
import { writeAudit } from '../services/audit.js';

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function readPassword(): Promise<string> {
  if (hasFlag('--password-stdin')) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  const fromArg = argValue('--password');
  if (fromArg) return fromArg;
  throw new Error('Provide --password or --password-stdin');
}

async function main() {
  const email = String(argValue('--email') || '')
    .trim()
    .toLowerCase();
  const name = String(argValue('--name') || '').trim();
  const confirmKey = String(argValue('--confirm-key') || '');

  if (!email || !name) {
    throw new Error('Required: --email and --name');
  }
  if (!env.provisioningApiKey || env.provisioningApiKey.length < 16) {
    throw new Error(
      'PROVISIONING_API_KEY must be set in the monorepo root .env (min 16 characters) before creating a platform operator.'
    );
  }
  if (confirmKey !== env.provisioningApiKey) {
    throw new Error(
      'Invalid --confirm-key. Pass the same value as PROVISIONING_API_KEY to authorize bootstrap.'
    );
  }

  const password = await readPassword();
  const parsed = strongPasswordSchema.safeParse(password);
  if (!parsed.success) {
    throw new Error(
      'Password does not meet policy (min 8 chars with at least one letter and one number).'
    );
  }

  await connectDb();
  console.log(`[platform-operator] dbMode=${getDbMode()}`);

  const existing = await User.findOne({ email });
  if (existing) {
    throw new Error(`User already exists for ${email} (refusing to overwrite).`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    email,
    passwordHash,
    name,
    role: 'platform_operator',
    accountStatus: 'active',
    isActive: true,
    preferredLanguage: 'en'
  });

  await writeAudit({
    actor: user._id,
    action: 'platform_operator.create',
    entityType: 'User',
    entityId: user._id,
    details: { email: user.email, bootstrap: true }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: String(user._id),
        email: user.email,
        role: user.role,
        loginPath: '/login?portal=shop',
        homePath: '/app/platform/shop-applications'
      },
      null,
      2
    )
  );

  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
