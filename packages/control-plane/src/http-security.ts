import type { MiddlewareHandler } from 'hono';

const MAX_REQUEST_BYTES = 1_048_576;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const requestIds = new WeakMap<Request, string>();
const localRateWindows = new Map<string, { startedAt: number; count: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 120;

type RateLimitBinding = Readonly<{
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}>;

function isRateLimitBinding(value: unknown): value is RateLimitBinding {
  return typeof value === 'object' && value !== null && 'limit' in value && typeof value.limit === 'function';
}

async function principalKey(headers: Headers): Promise<string> {
  const credential = headers.get('authorization') ?? headers.get('cf-connecting-ip') ?? 'anonymous';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function localRateLimit(key: string, now: number): boolean {
  const current = localRateWindows.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    localRateWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (localRateWindows.size > 10_000) {
    for (const [candidate, window] of localRateWindows) {
      if (now - window.startedAt >= RATE_WINDOW_MS) localRateWindows.delete(candidate);
    }
  }
  return current.count <= RATE_LIMIT;
}

export type ErrorEnvelope = Readonly<{
  error: string;
  requestId: string;
}>;

export function requestIdFrom(headers: Headers): string {
  const candidate = headers.get('x-request-id')?.trim() ?? '';
  return REQUEST_ID.test(candidate) ? candidate : crypto.randomUUID();
}

export function requestIdFor(request: Request): string {
  return requestIds.get(request) ?? requestIdFrom(request.headers);
}

export function errorEnvelope(error: string, requestId: string): ErrorEnvelope {
  return { error, requestId };
}

/**
 * Security/observability floor shared by every route. Content-Length is rejected before a body is
 * parsed. Route-specific parsers still enforce their own smaller schema/field limits.
 */
export const requestSecurity: MiddlewareHandler = async (c, next) => {
  const startedAt = Date.now();
  const requestId = requestIdFrom(c.req.raw.headers);
  requestIds.set(c.req.raw, requestId);
  const declaredLength = Number(c.req.header('content-length') ?? '0');

  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    const response = c.json(errorEnvelope('request_too_large', requestId), 413);
    response.headers.set('x-request-id', requestId);
    return response;
  }

  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    const key = await principalKey(c.req.raw.headers);
    const bindings = (c.env ?? {}) as Record<string, unknown>;
    const limiter = bindings.AID_RATE_LIMITER;
    const allowed = isRateLimitBinding(limiter)
      ? (await limiter.limit({ key })).success
      : localRateLimit(key, startedAt);
    if (!allowed) {
      const response = c.json(errorEnvelope('rate_limited', requestId), 429);
      response.headers.set('retry-after', '60');
      response.headers.set('x-request-id', requestId);
      return response;
    }
  }

  await next();
  c.res.headers.set('x-request-id', requestId);
  c.res.headers.set('server-timing', `app;dur=${Math.max(0, Date.now() - startedAt)}`);

  console.log(
    JSON.stringify({
      level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
      ts: Date.now(),
      msg: 'http_request',
      traceId: requestId,
      requestId,
      workerId: 'aid-control-plane',
      env: 'production',
      durationMs: Math.max(0, Date.now() - startedAt),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
    }),
  );
};
