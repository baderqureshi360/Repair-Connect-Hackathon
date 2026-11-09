import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function runEnvProbe(env: Record<string, string>) {
  const script = `
    try {
      process.env.NODE_ENV = ${JSON.stringify(env.NODE_ENV)};
      process.env.MONGODB_URI = ${JSON.stringify(env.MONGODB_URI ?? '')};
      process.env.USE_MEMORY_DB = ${JSON.stringify(env.USE_MEMORY_DB ?? '')};
      process.env.JWT_SECRET = ${JSON.stringify(env.JWT_SECRET ?? '')};
      process.env.SEED_ON_START = ${JSON.stringify(env.SEED_ON_START ?? '')};
      process.env.ALLOW_DEMO_LOGIN = ${JSON.stringify(env.ALLOW_DEMO_LOGIN ?? '')};
      await import('./src/config/env.ts');
      console.log('OK');
    } catch (e) {
      console.error(String(e && e.message ? e.message : e));
      process.exit(1);
    }
  `;
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '-e', script],
    {
      cwd: path.join(root, 'server'),
      encoding: 'utf8',
      env: { ...process.env, ...env }
    }
  );
}

describe('Production config guards', () => {
  it('fails production without MONGODB_URI', () => {
    const result = runEnvProbe({
      NODE_ENV: 'production',
      MONGODB_URI: '',
      USE_MEMORY_DB: '',
      JWT_SECRET: 'production-secret-that-is-long-enough-32',
      SEED_ON_START: ''
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/MONGODB_URI is required in production/i);
  });

  it('fails production when USE_MEMORY_DB=true', () => {
    const result = runEnvProbe({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net',
      USE_MEMORY_DB: 'true',
      JWT_SECRET: 'production-secret-that-is-long-enough-32',
      SEED_ON_START: ''
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/USE_MEMORY_DB=true is not allowed/i);
  });

  it('fails production when SEED_ON_START=true', () => {
    const result = runEnvProbe({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net',
      USE_MEMORY_DB: '',
      JWT_SECRET: 'production-secret-that-is-long-enough-32',
      SEED_ON_START: 'true'
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/SEED_ON_START is not allowed/i);
  });

  it('fails production when ALLOW_DEMO_LOGIN=true', () => {
    const result = runEnvProbe({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net',
      USE_MEMORY_DB: '',
      JWT_SECRET: 'production-secret-that-is-long-enough-32',
      SEED_ON_START: '',
      ALLOW_DEMO_LOGIN: 'true'
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/ALLOW_DEMO_LOGIN is not allowed/i);
  });

  it('fails development without URI and without explicit USE_MEMORY_DB', () => {
    const result = runEnvProbe({
      NODE_ENV: 'development',
      MONGODB_URI: '',
      USE_MEMORY_DB: '',
      JWT_SECRET: 'dev-secret-repairconnect-min-32-chars!!',
      SEED_ON_START: ''
    });
    expect(result.status).not.toBe(0);
    const out = result.stderr + result.stdout;
    expect(out).toMatch(
      /Atlas\/remote mode requires MONGODB_URI|Silent in-memory fallback is disabled|Set MONGODB_URI \(Atlas\) or explicitly set USE_MEMORY_DB=true/i
    );
  });
});

