import type { NextFunction, Request, Response } from 'express';
import { isAppError } from '../utils/errors.js';
import { fail } from '../utils/response.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (isAppError(err)) {
    return fail(res, err.message, err.statusCode, err.code, err.details);
  }

  if (err && typeof err === 'object' && 'code' in err && (err as { code?: number }).code === 11000) {
    return fail(res, 'Duplicate record', 409, 'DUPLICATE', err);
  }

  console.error('[error]', err);
  return fail(res, 'Internal server error', 500, 'INTERNAL_ERROR');
}
