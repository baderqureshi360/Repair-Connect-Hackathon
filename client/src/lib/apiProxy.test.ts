import { describe, expect, it } from 'vitest';
import {
  buildProxyResponseHeaders,
  buildUpstreamApiUrl,
  filterRequestHeaders,
  normalizeUpstreamBase
} from './apiProxy';

describe('apiProxy helpers', () => {
  it('normalizes trailing slashes on upstream base', () => {
    expect(normalizeUpstreamBase('https://api.example.com/')).toBe('https://api.example.com');
    expect(normalizeUpstreamBase('  https://api.example.com  ')).toBe('https://api.example.com');
    expect(normalizeUpstreamBase('')).toBe('');
  });

  it('builds upstream API URLs without double slashes', () => {
    expect(buildUpstreamApiUrl('https://api.example.com', 'v1/auth/me')).toBe(
      'https://api.example.com/api/v1/auth/me'
    );
    expect(buildUpstreamApiUrl('https://api.example.com', '/v1/auth/login', '?x=1')).toBe(
      'https://api.example.com/api/v1/auth/login?x=1'
    );
  });

  it('strips hop-by-hop headers and forwards client identity', () => {
    const source = new Headers({
      host: 'spa.example.com',
      'content-type': 'application/json',
      connection: 'keep-alive',
      'x-csrf-token': 'abc'
    });
    const out = filterRequestHeaders(source, {
      forwardedFor: '1.2.3.4',
      forwardedHost: 'spa.example.com',
      forwardedProto: 'https'
    });
    expect(out.get('host')).toBeNull();
    expect(out.get('connection')).toBeNull();
    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('x-csrf-token')).toBe('abc');
    expect(out.get('x-forwarded-for')).toBe('1.2.3.4');
    expect(out.get('x-forwarded-host')).toBe('spa.example.com');
    expect(out.get('x-forwarded-proto')).toBe('https');
  });

  it('forwards multiple Set-Cookie values via getSetCookie', () => {
    const upstream = new Headers();
    // Headers#append preserves multiple set-cookie entries for getSetCookie().
    upstream.append('set-cookie', 'rc_access=a; Path=/; Secure; SameSite=None; Partitioned');
    upstream.append('set-cookie', 'rc_refresh=b; Path=/; Secure; SameSite=None; Partitioned');
    upstream.set('content-type', 'application/json');
    upstream.set('content-encoding', 'gzip');

    const out = buildProxyResponseHeaders(upstream);
    expect(out.get('content-type')).toBe('application/json');
    expect(out.get('content-encoding')).toBeNull();
    const cookies =
      typeof out.getSetCookie === 'function' ? out.getSetCookie() : [out.get('set-cookie')];
    expect(cookies?.some((c) => c?.includes('rc_access='))).toBe(true);
    expect(cookies?.some((c) => c?.includes('rc_refresh='))).toBe(true);
  });
});
