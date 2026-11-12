import type { RequestHandler } from './$types';
import { env as privateEnv } from '$env/dynamic/private';
import {
  buildProxyResponseHeaders,
  buildUpstreamApiUrl,
  filterRequestHeaders,
  normalizeUpstreamBase,
  proxyMisconfiguredResponse,
  proxyUnreachableResponse
} from '$lib/apiProxy';

function resolveUpstream(): string {
  // Server-only. Never bake the API host into the client bundle for cookie auth.
  return normalizeUpstreamBase(
    privateEnv.API_PROXY_TARGET || privateEnv.API_UPSTREAM_URL || process.env.API_PROXY_TARGET
  );
}

const proxy: RequestHandler = async (event) => {
  const base = resolveUpstream();
  if (!base) return proxyMisconfiguredResponse();

  const suffix = event.params.path || '';
  const target = buildUpstreamApiUrl(base, suffix, event.url.search);
  const method = event.request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const headers = filterRequestHeaders(event.request.headers, {
    forwardedFor: event.request.headers.get('x-forwarded-for') || event.getClientAddress(),
    forwardedHost: event.url.host,
    forwardedProto: event.url.protocol.replace(':', '')
  });

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? await event.request.arrayBuffer() : undefined,
      redirect: 'manual'
    });
  } catch {
    return proxyUnreachableResponse();
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildProxyResponseHeaders(upstream.headers)
  });
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
