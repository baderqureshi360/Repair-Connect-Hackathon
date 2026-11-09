import path from 'node:path';
import { loadRootEnv, getLoadedEnvInfo, redactMongoUri } from './loadEnv.js';

// Must run before any process.env reads used for DB mode.
const loaded = loadRootEnv();

const nodeEnv = process.env.NODE_ENV || 'development';
const mongodbUri = (process.env.MONGODB_URI || '').trim();
const useMemoryDbFlag = process.env.USE_MEMORY_DB === 'true';
const useMemoryDbExplicitFalse =
  process.env.USE_MEMORY_DB === 'false' || process.env.USE_MEMORY_DB === '0';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

/**
 * In-memory DB is never allowed in production, and never used silently.
 * A configured MONGODB_URI always wins over USE_MEMORY_DB=true.
 * USE_MEMORY_DB=false never falls back to memory — missing URI is fatal.
 */
function resolveUseMemoryDb(): boolean {
  if (isProd) return false;
  if (useMemoryDbExplicitFalse) return false;
  if (mongodbUri) return false;
  if (isTest) return true;
  return useMemoryDbFlag;
}

function envFileHint(): string {
  const info = getLoadedEnvInfo();
  if (info?.envPath) return info.envPath;
  if (info?.rootDir) return path.join(info.rootDir, '.env');
  return 'monorepo root .env';
}

function assertConfig(useMemoryDb: boolean): void {
  const hint = envFileHint();

  if (isProd) {
    if (!mongodbUri) {
      throw new Error(
        `[config] FATAL: MONGODB_URI is required in production. In-memory MongoDB is disabled. Checked: ${hint}`
      );
    }
    if (useMemoryDbFlag) {
      throw new Error('[config] FATAL: USE_MEMORY_DB=true is not allowed in production.');
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error(
        '[config] FATAL: JWT_SECRET must be set to a strong value (min 32 chars) in production.'
      );
    }
    if (process.env.SEED_ON_START === 'true') {
      throw new Error('[config] FATAL: SEED_ON_START is not allowed in production.');
    }
    if (process.env.ALLOW_DEMO_LOGIN === 'true') {
      throw new Error('[config] FATAL: ALLOW_DEMO_LOGIN is not allowed in production.');
    }
    if (process.env.COOKIE_SAME_SITE === 'none' && process.env.COOKIE_SECURE === 'false') {
      throw new Error('[config] FATAL: COOKIE_SAME_SITE=none requires Secure cookies.');
    }
    if (!(process.env.CLIENT_URL || '').trim()) {
      throw new Error(
        '[config] FATAL: CLIENT_URL is required in production (CORS + credentialed cookies).'
      );
    }
    if ((process.env.PROVISIONING_API_KEY || '').trim().length > 0 &&
      (process.env.PROVISIONING_API_KEY || '').trim().length < 16) {
      throw new Error('[config] FATAL: PROVISIONING_API_KEY must be at least 16 characters when set.');
    }
  }

  // Atlas / remote mode selected — URI must be present and look like MongoDB
  if (!useMemoryDb) {
    if (!mongodbUri) {
      throw new Error(
        `[config] FATAL: Atlas/remote mode requires MONGODB_URI, but it is missing or empty. ` +
          `Set MONGODB_URI in ${hint} and USE_MEMORY_DB=false. ` +
          `For local tests only, set USE_MEMORY_DB=true.`
      );
    }
    if (!/^mongodb(\+srv)?:\/\//i.test(mongodbUri)) {
      throw new Error(
        `[config] FATAL: MONGODB_URI must start with mongodb:// or mongodb+srv:// (loaded from ${hint}).`
      );
    }
  }

  if (!isProd && !isTest && !mongodbUri && !useMemoryDbFlag) {
    throw new Error(
      `[config] FATAL: Set MONGODB_URI (Atlas) or explicitly set USE_MEMORY_DB=true. ` +
        `Silent in-memory fallback is disabled. Checked: ${hint}`
    );
  }
}

const useMemoryDb = resolveUseMemoryDb();
assertConfig(useMemoryDb);

const sameSiteRaw = (process.env.COOKIE_SAME_SITE || (isProd ? 'lax' : 'lax')).toLowerCase();
const cookieSameSite =
  sameSiteRaw === 'none' || sameSiteRaw === 'strict' || sameSiteRaw === 'lax'
    ? (sameSiteRaw as 'none' | 'strict' | 'lax')
    : 'lax';

export const DEMO_ACCOUNT_EMAILS = [
  'customer@repairconnect.local',
  'mechanic@repairconnect.local',
  'parts@repairconnect.local',
  'admin@repairconnect.local'
] as const;

export const env = {
  nodeEnv,
  isProd,
  isTest,
  port: Number(process.env.PORT || 5000),
  mongodbUri,
  jwtSecret:
    process.env.JWT_SECRET ||
    (isProd ? '' : 'repairconnect-dev-secret-change-me-min-32-chars!!'),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  useMemoryDb,
  seedOnStart: !isProd && !isTest && process.env.SEED_ON_START === 'true',
  allowAutoSeedMemory: !isProd && !isTest && useMemoryDb,
  /** Demo seed logins are always blocked in production. */
  allowDemoLogin: !isProd && process.env.ALLOW_DEMO_LOGIN !== 'false',
  cookieSameSite,
  cookieDomain: (process.env.COOKIE_DOMAIN || '').trim() || undefined,
  accessTokenTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC || 60 * 60 * 2),
  refreshTokenTtlSec: Number(process.env.REFRESH_TOKEN_TTL_SEC || 60 * 60 * 24 * 7),
  /**
   * Shared secret for MVP shop-application provisioning (approve/reject/claim).
   * Not a platform super-admin role — only unlocks the provisioning API/CLI.
   */
  provisioningApiKey: (process.env.PROVISIONING_API_KEY || '').trim(),
  envFile: loaded.envPath,
  rootDir: loaded.rootDir
};

if (!env.useMemoryDb) {
  console.log(`[env] DB target=atlas/remote host=${redactMongoUri(env.mongodbUri)}`);
} else {
  console.log('[env] DB target=memory (explicit test/dev only)');
}
