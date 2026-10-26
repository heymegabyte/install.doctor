/**
 * GA4 Measurement Protocol — SERVER-side event sending (ideas #13, #15, pairs
 * with #14 sGTM). Runs in a Worker / Node, NEVER the browser (the api_secret is
 * secret). Dep-light: the CALLING route validates input with its own Zod at the
 * boundary (estate "Zod at boundaries"); this module ships types + a runtime
 * guard so it typechecks standalone and is safe without a Zod dependency.
 */

export interface MpEvent {
  name: string;
  params?: Record<string, unknown>;
}

export interface MpPayload {
  /** GA4 client_id (from the browser `_ga` cookie) OR user_id for server-only events. */
  client_id?: string;
  user_id?: string;
  events: MpEvent[];
  /** micros since epoch, for backdating; omit for "now". */
  timestamp_micros?: number;
  consent?: {
    ad_user_data?: 'GRANTED' | 'DENIED';
    ad_personalization?: 'GRANTED' | 'DENIED';
  };
}

export interface MpConfig {
  /** G-XXXXXXX */
  measurementId: string;
  /** GA4 Admin → Data Streams → Measurement Protocol API secret (a Worker secret). */
  apiSecret: string;
  /** Hit the validation endpoint (returns messages) instead of prod. */
  debug?: boolean;
  /** Inject a fetch (tests); defaults to the global. */
  fetchImpl?: typeof fetch;
}

export class MeasurementProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeasurementProtocolError';
  }
}

const PROD_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';
const EVENT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** Runtime guard — the caller SHOULD also Zod-validate at its route boundary. */
export function assertPayload(payload: MpPayload): void {
  if (!payload.client_id && !payload.user_id) {
    throw new MeasurementProtocolError('client_id or user_id is required');
  }
  if (!Array.isArray(payload.events) || payload.events.length === 0) {
    throw new MeasurementProtocolError('at least one event is required');
  }
  if (payload.events.length > 25) {
    throw new MeasurementProtocolError('GA4 MP allows at most 25 events per request');
  }
  for (const event of payload.events) {
    if (!event.name || !EVENT_NAME_RE.test(event.name)) {
      throw new MeasurementProtocolError(`invalid event name: ${String(event.name)}`);
    }
  }
}

/**
 * POST events to GA4 Measurement Protocol. Prod is fire-and-forget (2xx, no
 * body); debug returns validation messages. Fail-soft: the caller decides
 * whether a non-2xx matters (analytics should never break the user's request).
 */
export async function sendMeasurementProtocol(
  config: MpConfig,
  payload: MpPayload,
): Promise<{ ok: boolean; status: number; debug?: unknown }> {
  assertPayload(payload);
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.debug ? DEBUG_ENDPOINT : PROD_ENDPOINT;
  const url = `${base}?measurement_id=${encodeURIComponent(config.measurementId)}&api_secret=${encodeURIComponent(config.apiSecret)}`;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const debug = config.debug ? await res.json().catch(() => undefined) : undefined;
  return { ok: res.ok, status: res.status, debug };
}

/**
 * Build a server-confirmed `purchase` event, deduped against the client-side
 * event via the SAME `transaction_id` (idea #13 — Stripe webhook → GA4). Pass
 * the `client_id` you captured at checkout (from the browser `_ga` cookie) so
 * the server hit joins the same session/user.
 */
export function serverPurchaseEvent(args: {
  transactionId: string;
  value: number;
  currency?: string;
  items: { item_id: string; item_name: string; price?: number; quantity?: number }[];
  tax?: number;
  shipping?: number;
}): MpEvent {
  return {
    name: 'purchase',
    params: {
      transaction_id: args.transactionId,
      value: args.value,
      currency: args.currency ?? 'USD',
      tax: args.tax,
      shipping: args.shipping,
      items: args.items,
    },
  };
}

/** Extract the GA4 `client_id` from a `_ga` cookie value (`GA1.1.X.Y` → `X.Y`). */
export function clientIdFromGaCookie(gaCookie: string | null | undefined): string | null {
  if (!gaCookie) return null;
  const parts = gaCookie.split('.');
  return parts.length >= 4 ? `${parts[2]}.${parts[3]}` : null;
}
