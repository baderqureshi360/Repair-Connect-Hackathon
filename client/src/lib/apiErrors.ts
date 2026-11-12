export type ApiErrorBody = {
  success?: boolean;
  error?: { message?: string; code?: string; details?: unknown };
  data?: { csrfToken?: string } & Record<string, unknown>;
};

type ZodFlattenDetails = {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
};

/** Turn Zod flatten() details into a short user-facing sentence when the API message is generic. */
export function formatValidationDetails(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const flat = details as ZodFlattenDetails;
  const parts: string[] = [];
  for (const msg of flat.formErrors || []) {
    if (msg?.trim()) parts.push(msg.trim());
  }
  for (const [field, msgs] of Object.entries(flat.fieldErrors || {})) {
    for (const msg of msgs || []) {
      if (!msg?.trim()) continue;
      parts.push(`${field}: ${msg.trim()}`);
    }
  }
  if (!parts.length) return null;
  return parts.slice(0, 5).join('; ');
}

/** Prefer API error message; surface proxy/unreachable cases instead of generic "Request failed". */
export function messageFromFailedResponse(res: { status: number; statusText?: string }, body: ApiErrorBody): string {
  const apiMsg = body?.error?.message;
  const detailMsg = formatValidationDetails(body?.error?.details);
  if (typeof apiMsg === 'string' && apiMsg.trim()) {
    // Older servers only said "Validation failed" — append field details when present.
    if (detailMsg && /^validation failed$/i.test(apiMsg.trim())) {
      return detailMsg;
    }
    return apiMsg;
  }
  if (detailMsg) return detailMsg;

  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return 'API server unreachable. Start the backend (npm run dev:server) on port 5000.';
  }
  if (res.status >= 500) {
    return 'Server error. If this persists, confirm the API is running and reachable.';
  }
  if (res.status === 429) return 'Too many attempts. Please wait and try again.';
  if (res.statusText) return `Request failed (${res.status} ${res.statusText})`;
  return `Request failed (${res.status || 'network'})`;
}

export function statusToErrorCode(status: number): string {
  if (status === 502 || status === 503 || status === 504) return 'API_UNREACHABLE';
  if (status >= 500) return 'SERVER_ERROR';
  if (status === 429) return 'RATE_LIMIT';
  return 'ERROR';
}
