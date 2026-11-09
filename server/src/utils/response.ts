import type { Response } from 'express';

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function fail(res: Response, message: string, status = 400, code = 'ERROR', details?: unknown) {
  return res.status(status).json({ success: false, error: { message, code, details } });
}

export function paginated<T>(
  res: Response,
  items: T[],
  meta: { page: number; limit: number; total: number }
) {
  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      ...meta,
      totalPages: Math.ceil(meta.total / meta.limit) || 1
    }
  });
}
