import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export type LoadedEnvInfo = {
  rootDir: string;
  envPath: string | null;
  loaded: boolean;
};

let loadedInfo: LoadedEnvInfo | null = null;

function isMonorepoRoot(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const workspaces = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : pkg.workspaces?.packages || [];
    if (workspaces.includes('server') || workspaces.includes('client')) return true;
  } catch {
    /* ignore */
  }
  return (
    fs.existsSync(path.join(dir, 'server', 'package.json')) &&
    fs.existsSync(path.join(dir, 'client', 'package.json'))
  );
}

/**
 * Resolve monorepo root from this module location, then cwd ancestors.
 * Works for: tsx src/..., compiled dist/..., npm -w server (cwd=server/).
 */
export function resolveMonorepoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (isMonorepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  dir = path.resolve(process.cwd());
  for (let i = 0; i < 10; i++) {
    if (isMonorepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: server/src/config → ../../.. or server/dist/config → ../../..
  return path.resolve(startDir, '../../..');
}

/**
 * Load Hackathon/.env once, regardless of process cwd or entry script.
 * Does not print secrets or connection strings.
 */
export function loadRootEnv(): LoadedEnvInfo {
  if (loadedInfo) return loadedInfo;

  const rootDir = resolveMonorepoRoot();
  const envPath = path.join(rootDir, '.env');
  const exists = fs.existsSync(envPath);

  if (exists) {
    const result = dotenv.config({ path: envPath });
    if (result.error) {
      throw new Error(`[env] Failed to load ${envPath}: ${result.error.message}`);
    }
  }

  // Optional local override file (never committed): Hackathon/.env.local
  const localPath = path.join(rootDir, '.env.local');
  if (fs.existsSync(localPath)) {
    dotenv.config({ path: localPath, override: true });
  }

  loadedInfo = {
    rootDir,
    envPath: exists ? envPath : null,
    loaded: exists
  };

  const uriConfigured = Boolean((process.env.MONGODB_URI || '').trim());
  const memory = process.env.USE_MEMORY_DB === 'true';
  console.log(
    `[env] root=${rootDir} file=${exists ? '.env' : 'MISSING'} uriConfigured=${uriConfigured} USE_MEMORY_DB=${memory}`
  );

  if (!exists) {
    console.warn(
      `[env] No .env found at monorepo root. Copy .env.example to .env and set MONGODB_URI or USE_MEMORY_DB=true.`
    );
  }

  return loadedInfo;
}

export function getLoadedEnvInfo(): LoadedEnvInfo | null {
  return loadedInfo;
}

export function redactMongoUri(uri: string): string {
  if (!uri) return '(empty)';
  try {
    const u = new URL(uri.replace(/^mongodb\+srv/, 'https').replace(/^mongodb/, 'http'));
    return `${uri.startsWith('mongodb+srv') ? 'mongodb+srv' : 'mongodb'}://***@${u.host}${u.pathname}`;
  } catch {
    return '(configured, redacted)';
  }
}
