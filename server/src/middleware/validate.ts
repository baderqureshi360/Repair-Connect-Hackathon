import type { NextFunction, Request, Response } from 'express';
import type { ZodError, ZodSchema } from 'zod';
import { fail } from '../utils/response.js';

type Source = 'body' | 'query' | 'params';

const FIELD_LABELS: Record<string, string> = {
  shopId: 'Shop',
  deviceType: 'Device type',
  brand: 'Brand',
  model: 'Model',
  serialNumber: 'Serial number',
  accessories: 'Accessories',
  problemDescription: 'Problem description',
  appointmentAt: 'Appointment time',
  startsAt: 'Appointment start',
  photos: 'Photos',
  idempotencyKey: 'Idempotency key',
  email: 'Email',
  password: 'Password',
  name: 'Name',
  deadline: 'Deadline',
  expectedArrivalDate: 'Expected arrival'
};

function labelFor(path: string): string {
  const key = path.split('.')[0] || path;
  return FIELD_LABELS[key] || key;
}

/** Build a readable top-level message from Zod issues (keeps details for clients). */
export function formatZodValidationMessage(error: ZodError): string {
  const parts: string[] = [];
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.') || '(form)';
    const label = labelFor(path);
    let msg = issue.message;
    if (msg === 'Invalid datetime' || msg === 'Required') {
      msg =
        msg === 'Invalid datetime'
          ? 'must be a valid date and time'
          : 'is required';
    } else if (msg.toLowerCase().startsWith('string must contain')) {
      // keep zod wording but prefix with field
    }
    // Avoid "Brand: Brand is required" duplication when message already names the field.
    if (msg.toLowerCase().startsWith(label.toLowerCase())) {
      parts.push(msg);
    } else {
      parts.push(`${label}: ${msg}`);
    }
  }
  const unique = [...new Set(parts.filter(Boolean))];
  if (!unique.length) return 'Validation failed';
  return unique.slice(0, 5).join('; ');
}

export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return fail(
        res,
        formatZodValidationMessage(result.error),
        400,
        'VALIDATION_ERROR',
        result.error.flatten()
      );
    }
    if (source === 'body') req.body = result.data;
    if (source === 'query') (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    if (source === 'params') req.params = result.data as typeof req.params;
    next();
  };
}
