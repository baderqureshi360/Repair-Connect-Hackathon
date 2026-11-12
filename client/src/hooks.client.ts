import type { HandleClientError } from '@sveltejs/kit';
import { handleErrorWithSentry, init } from '@sentry/sveltekit';

const dsn =
  (typeof import.meta !== 'undefined' &&
    (import.meta.env.PUBLIC_SENTRY_DSN || import.meta.env.VITE_SENTRY_DSN)) ||
  '';

if (dsn) {
  init({
    dsn,
    environment: import.meta.env.PUBLIC_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development',
    tracesSampleRate: Number(import.meta.env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.05),
    beforeSend(event) {
      if (event.request?.headers) {
        const headers = { ...event.request.headers };
        for (const key of Object.keys(headers)) {
          if (/authorization|cookie|x-csrf/i.test(key)) delete headers[key];
        }
        event.request.headers = headers;
      }
      return event;
    }
  });
}

export const handleError: HandleClientError = handleErrorWithSentry();
