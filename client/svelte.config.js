import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const apiConnect = process.env.VITE_API_URL || process.env.PUBLIC_API_URL || '';
const isProdBuild = process.env.NODE_ENV === 'production';

/**
 * Hosting selection:
 * - On Vercel (`VERCEL` is set by the platform) → always adapter-vercel
 * - Explicit `ADAPTER=vercel` → adapter-vercel (local Linux CI / smoke)
 * - Explicit `ADAPTER=node` or default → adapter-node (VPS + nginx)
 *
 * `ADAPTER=node` cannot override Vercel (`VERCEL` present) so CI never ships adapter-node.
 * Express API is never deployed via this adapter.
 */
const adapterOverride = String(process.env.ADAPTER || '').toLowerCase();
const onVercel = Boolean(process.env.VERCEL);
const useVercel = onVercel || adapterOverride === 'vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: useVercel
      ? adapterVercel({
          // Pin to a currently supported Vercel Function runtime (Node 20 is discontinued).
          // Keep in sync with client/package.json engines.node.
          runtime: 'nodejs26.x'
        })
      : adapterNode({ out: 'build' }),
    ...(isProdBuild
      ? {
          csp: {
            mode: 'auto',
            directives: {
              'default-src': ['self'],
              'script-src': ['self'],
              'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
              'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
              'img-src': ['self', 'data:', 'blob:'],
              // Allow Sentry ingest when PUBLIC_SENTRY_DSN / monitoring is enabled.
              'connect-src': [
                'self',
                apiConnect,
                'https://*.ingest.sentry.io',
                'https://*.ingest.us.sentry.io'
              ].filter(Boolean),
              'object-src': ['none'],
              'base-uri': ['self'],
              'frame-ancestors': ['none'],
              'form-action': ['self'],
              'upgrade-insecure-requests': true
            }
          }
        }
      : {})
  }
};

export default config;
