/**
 * Monorepo helper: after `npm run build -w client` with adapter-vercel,
 * promote client/.vercel/output → .vercel/output so a root-level Vercel
 * project (no Root Directory) can consume the Build Output API.
 *
 * When the Vercel project Root Directory is `client`, this script is unused
 * (client/vercel.json is enough).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'client', '.vercel', 'output');
const dest = path.join(root, '.vercel', 'output');

if (!fs.existsSync(src)) {
  console.error(`[promote-vercel-output] Missing ${src}`);
  console.error('Build the client with ADAPTER=vercel (or VERCEL=1) first.');
  process.exit(1);
}

fs.rmSync(path.join(root, '.vercel', 'output'), { recursive: true, force: true });
fs.mkdirSync(path.join(root, '.vercel'), { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`[promote-vercel-output] Copied ${src} → ${dest}`);
