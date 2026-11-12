import type { NextFunction, Request, Response } from 'express';
import { isAppError } from '../utils/errors.js';
import { fail } from '../utils/response.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (isAppError(err)) {
    return fail(res, err.message, err.statusCode, err.code, err.details);
  }

  // express.json() parse failures (malformed body) — not a 500.
  if (
    err instanceof SyntaxError &&
    err &&
    typeof err === 'object' &&
    'status' in err &&
    (err as { status?: number }).status === 400 &&
    'body' in err
  ) {
    return fail(res, 'Invalid JSON body', 400, 'INVALID_JSON');
  }

  if (err && typeof err === 'object' && 'code' in err && (err as { code?: number }).code === 11000) {
    return fail(res, 'Duplicate record', 409, 'DUPLICATE', err);
  }

  // Unexpected errors — report to Sentry when configured (no passwords/tokens logged).
  void import('../observability/sentry.js')
    .then(async ({ initSentry }) => {
      if (await initSentry()) {
        const Sentry = await import('@sentry/node');
        Sentry.captureException(err);
      }
    })
    .catch(() => undefined);

  console.error('[error]', err instanceof Error ? err.message : 'unknown');
  return fail(res, 'Internal server error', 500, 'INTERNAL_ERROR');
}
