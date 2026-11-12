/**
 * Same-origin reverse proxy helpers for the Vercel frontend project.
 * Browser talks to /api/* on the SPA host; the server forwards to the Express API.
 * That makes auth cookies first-party (avoids *.vercel.app public-suffix / third-party blocking).
 */

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
]);

export function normalizeUpstreamBase(raw: string | undefined | null): string {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '');
}

export function buildUpstreamApiUrl(base: string, pathSuffix: string, search = ''): string {
  const suffix = String(pathSuffix || '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const q = search && search.startsWith('?') ? search : search ? `?${search}` : '';
  return `${base}/api/${suffix}${q}`;
}

export function filterRequestHeaders(
  source: Headers,
  extras?: { forwardedFor?: string; forwardedHost?: string; forwardedProto?: string }
): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  if (extras?.forwardedFor) headers.set('x-forwarded-for', extras.forwardedFor);
  if (extras?.forwardedHost) headers.set('x-forwarded-host', extras.forwardedHost);
  if (extras?.forwardedProto) headers.set('x-forwarded-proto', extras.forwardedProto);
  return headers;
}

export function buildProxyResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie') return;
    if (HOP_BY_HOP.has(k)) return;
    // fetch() decompresses; forwarding these breaks the body length.
    if (k === 'content-encoding' || k === 'content-length') return;
    out.set(key, value);
  });

  const cookies =
    typeof upstream.getSetCookie === 'function' ? upstream.getSetCookie() : [];
  for (const cookie of cookies) {
    out.append('set-cookie', cookie);
  }
  return out;
}

export function proxyMisconfiguredResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: { message: 'API proxy is not configured (set API_PROXY_TARGET)', code: 'PROXY_MISCONFIGURED' }
    }),
    { status: 502, headers: { 'content-type': 'application/json' } }
  );
}

export function proxyUnreachableResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: { message: 'API server unreachable', code: 'API_UNREACHABLE' }
    }),
    { status: 502, headers: { 'content-type': 'application/json' } }
  );
}
