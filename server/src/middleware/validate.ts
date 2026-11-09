import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { fail } from '../utils/response.js';

type Source = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return fail(res, 'Validation failed', 400, 'VALIDATION_ERROR', result.error.flatten());
    }
    if (source === 'body') req.body = result.data;
    if (source === 'query') (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    if (source === 'params') req.params = result.data as typeof req.params;
    next();
  };
}
