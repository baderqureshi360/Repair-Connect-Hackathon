import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { handleErrorWithSentry, init, sentryHandle } from '@sentry/sveltekit';

const dsn = process.env.SENTRY_DSN || process.env.PUBLIC_SENTRY_DSN || '';

if (dsn) {
  init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05)
  });
}

/** Extra security headers; CSP is configured via svelte.config.js kit.csp. */
const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  return response;
};

export const handle: Handle = dsn ? sequence(sentryHandle(), securityHeaders) : securityHeaders;

export const handleError: HandleServerError = handleErrorWithSentry();
