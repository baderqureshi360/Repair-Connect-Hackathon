import { z } from 'zod';

/**
 * Accept ISO-8601 datetimes and HTML datetime-local values (`YYYY-MM-DDTHH:mm`).
 * Always output a UTC ISO string suitable for `new Date(...)` / Mongo.
 */
export function parseFlexibleDateTime(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // datetime-local has no timezone; treat as local wall clock (JS Date default).
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Optional datetime that coerces datetime-local → ISO UTC. Empty → undefined. */
export const optionalDateTimeString = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const iso = parseFlexibleDateTime(value);
  return iso ?? value;
}, z.string().datetime().optional());

/** Required datetime with the same flexible input rules. */
export const requiredDateTimeString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const iso = parseFlexibleDateTime(value);
  return iso ?? value;
}, z.string().datetime());

/** Nullable optional datetime (e.g. clearable deadlines). */
export const nullableDateTimeString = z.preprocess((value) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const iso = parseFlexibleDateTime(value);
  return iso ?? value;
}, z.string().datetime().nullable().optional());

/** Empty optional strings from HTML forms → undefined. */
export const optionalFormString = (max: number) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.string().max(max).optional()
  );
