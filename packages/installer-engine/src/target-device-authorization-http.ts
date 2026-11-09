import { z } from 'zod';
import type {
  AuthorizationPollResponse, AuthorizationStartRequest, AuthorizationStartResponse, TargetAuthorizationTransport,
} from './target-device-authorization.js';

const MAX_RESPONSE_BYTES = 65_536;
const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const startResponse = z.strictObject({
  request: z.unknown(), approvalUri: z.string().url().refine(value => new URL(value).protocol === 'https:'),
  pollIntervalMs: z.number().int().min(1_000).max(30_000),
});
const pollResponse = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('pending'), retryAfterMs: z.number().int().min(1_000).max(30_000).optional() }),
  z.strictObject({ status: z.literal('approved'), credential: z.string().min(32).max(4096), credentialId: identifier, expiresAt: timestamp }),
  z.strictObject({ status: z.literal('denied'), reason: z.enum(['owner-denied', 'policy-denied', 'expired', 'cancelled']) }),
]);

export interface TargetAuthorizationHttpOptions {
  readonly origin: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

function canonicalOrigin(raw: string): string {
  const value = new URL(raw);
  if (value.protocol !== 'https:' || value.username || value.password || value.search || value.hash
    || (value.pathname !== '/' && value.pathname !== '')) throw new Error('authorization origin must be a canonical HTTPS origin');
  return value.origin;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('authorization response exceeds its byte limit');
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw new Error('authorization response is not JSON');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('authorization response body is missing');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel('authorization response exceeds its byte limit');
        throw new Error('authorization response exceeds its byte limit');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function linkedSignal(caller: AbortSignal, timeoutMs: number): { signal: AbortSignal; close(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort(caller.reason ?? new Error('authorization cancelled'));
  caller.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('authorization transport timeout')), timeoutMs);
  if (caller.aborted) abort();
  return { signal: controller.signal, close() { clearTimeout(timer); caller.removeEventListener('abort', abort); } };
}

export function createTargetAuthorizationHttpTransport(options: TargetAuthorizationHttpOptions): TargetAuthorizationTransport {
  const origin = canonicalOrigin(options.origin);
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new Error('authorization timeout is out of bounds');

  const request = async (path: string, pollSecret: string, body: unknown, signal: AbortSignal): Promise<Response> => {
    const linked = linkedSignal(signal, timeoutMs);
    try {
      return await fetcher(`${origin}${path}`, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: linked.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${pollSecret}` },
        body: JSON.stringify(body),
      });
    } finally { linked.close(); }
  };

  return Object.freeze({
    async start(input: AuthorizationStartRequest, signal: AbortSignal): Promise<AuthorizationStartResponse> {
      const response = await request('/api/v1/device-authorizations/start', input.pollSecret,
        { binding: input.binding, machineLabel: input.machineLabel }, signal);
      if (response.status !== 201) throw new Error(`authorization start unavailable (${response.status})`);
      return startResponse.parse(await boundedJson(response));
    },
    async poll(requestId: string, pollSecret: string, signal: AbortSignal): Promise<AuthorizationPollResponse> {
      const id = identifier.parse(requestId);
      const response = await request(`/api/v1/device-authorizations/${encodeURIComponent(id)}/poll`, pollSecret, {}, signal);
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after') ?? '1');
        return { status: 'pending', retryAfterMs: Math.max(1_000, Math.min(30_000, Number.isFinite(seconds) ? Math.ceil(seconds * 1_000) : 1_000)) };
      }
      if (response.status === 404) return { status: 'denied', reason: 'policy-denied' };
      if (response.status === 410) return { status: 'denied', reason: 'expired' };
      if (response.status !== 200) throw new Error(`authorization poll unavailable (${response.status})`);
      const result = pollResponse.parse(await boundedJson(response));
      if (result.status === 'pending') {
        return result.retryAfterMs === undefined ? { status: 'pending' } : { status: 'pending', retryAfterMs: result.retryAfterMs };
      }
      return result;
    },
    async cancel(requestId: string, pollSecret: string, signal: AbortSignal): Promise<void> {
      const id = identifier.parse(requestId);
      const response = await request(`/api/v1/device-authorizations/${encodeURIComponent(id)}/cancel`, pollSecret, {}, signal);
      if (![200, 204, 404, 410].includes(response.status)) throw new Error(`authorization cancellation unavailable (${response.status})`);
    },
  });
}
