/**
 * Tests for the GA4 Measurement Protocol server module. Runner: node's built-in
 * `node:test` (dep-free) over tsc-compiled CommonJS — see package.json `test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPayload,
  serverPurchaseEvent,
  clientIdFromGaCookie,
  sendMeasurementProtocol,
  MeasurementProtocolError,
  type MpPayload,
} from '../src/server.js';

test('assertPayload requires client_id or user_id', () => {
  assert.throws(
    () => assertPayload({ events: [{ name: 'login' }] }),
    MeasurementProtocolError,
  );
});

test('assertPayload requires at least one event', () => {
  assert.throws(
    () => assertPayload({ client_id: 'c', events: [] }),
    MeasurementProtocolError,
  );
});

test('assertPayload caps at 25 events', () => {
  const events = Array.from({ length: 26 }, () => ({ name: 'select_content' }));
  assert.throws(
    () => assertPayload({ client_id: 'c', events }),
    MeasurementProtocolError,
  );
});

test('assertPayload rejects invalid event names', () => {
  assert.throws(
    () => assertPayload({ client_id: 'c', events: [{ name: '1 bad name' }] }),
    MeasurementProtocolError,
  );
});

test('assertPayload accepts a valid payload', () => {
  assert.doesNotThrow(() =>
    assertPayload({ client_id: 'c', events: [{ name: 'purchase' }] }),
  );
});

test('serverPurchaseEvent builds a purchase with USD default', () => {
  const e = serverPurchaseEvent({
    transactionId: 't1',
    value: 29,
    items: [{ item_id: 's', item_name: 'Pro' }],
  });
  assert.equal(e.name, 'purchase');
  assert.equal(e.params?.transaction_id, 't1');
  assert.equal(e.params?.currency, 'USD');
  assert.equal(e.params?.value, 29);
});

test('clientIdFromGaCookie parses GA1.1.X.Y -> X.Y', () => {
  assert.equal(
    clientIdFromGaCookie('GA1.1.1234567890.1680000000'),
    '1234567890.1680000000',
  );
});

test('clientIdFromGaCookie returns null on missing/short values', () => {
  assert.equal(clientIdFromGaCookie(undefined), null);
  assert.equal(clientIdFromGaCookie(null), null);
  assert.equal(clientIdFromGaCookie('GA1.1'), null);
});

test('sendMeasurementProtocol posts to prod with the injected fetch', async () => {
  let capturedUrl = '';
  let capturedBody = '';
  const fakeFetch = (async (url: string, init?: { body?: unknown }) => {
    capturedUrl = String(url);
    capturedBody = String(init?.body ?? '');
    return { ok: true, status: 204, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;

  const res = await sendMeasurementProtocol(
    { measurementId: 'G-TEST', apiSecret: 'sek', fetchImpl: fakeFetch },
    {
      client_id: 'c',
      events: [serverPurchaseEvent({ transactionId: 't', value: 1, items: [] })],
    },
  );

  assert.equal(res.ok, true);
  assert.equal(res.status, 204);
  assert.match(capturedUrl, /\/mp\/collect\?measurement_id=G-TEST&api_secret=sek/);
  assert.match(capturedBody, /"transaction_id":"t"/);
});

test('sendMeasurementProtocol debug mode hits the debug endpoint + parses json', async () => {
  let capturedUrl = '';
  const fakeFetch = (async (url: string) => {
    capturedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ validationMessages: [] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const res = await sendMeasurementProtocol(
    { measurementId: 'G-X', apiSecret: 's', debug: true, fetchImpl: fakeFetch },
    { user_id: 'u', events: [{ name: 'login' }] },
  );

  assert.equal(res.status, 200);
  assert.match(capturedUrl, /\/debug\/mp\/collect/);
  assert.deepEqual(res.debug, { validationMessages: [] });
});

// Narrow type-only use so the import isn't elided and intent is explicit.
const _typecheck: MpPayload = { client_id: 'c', events: [{ name: 'login' }] };
void _typecheck;
