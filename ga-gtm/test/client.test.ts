/**
 * Tests for the client modules (consent.ts + events.ts). node:test over
 * tsc-compiled CJS; node has no DOM so we install minimal window/localStorage
 * shims per test. See package.json `test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gtag,
  setDefaultConsent,
  grantAll,
  denyAll,
  type ConsentChoice,
} from '../src/consent.js';
import { pushEvent, track } from '../src/events.js';

interface Win {
  dataLayer?: unknown[];
}
type GlobalShim = { window?: Win; localStorage?: unknown };

/** Fresh window.dataLayer + a Map-backed localStorage for one test. */
function setupDom(): { store: Map<string, string> } {
  const store = new Map<string, string>();
  (globalThis as unknown as GlobalShim).window = { dataLayer: [] };
  (globalThis as unknown as GlobalShim).localStorage = {
    getItem: (k: string): string | null => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string): void => {
      store.set(k, v);
    },
    removeItem: (k: string): void => {
      store.delete(k);
    },
    clear: (): void => store.clear(),
  };
  return { store };
}

function layer(): unknown[] {
  return (globalThis as unknown as GlobalShim).window?.dataLayer ?? [];
}

const GRANTED: ConsentChoice = {
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
  analytics_storage: 'granted',
};

test('gtag pushes an array-form entry onto dataLayer', () => {
  setupDom();
  gtag('consent', 'default', { analytics_storage: 'denied' });
  assert.equal(layer().length, 1);
  assert.deepEqual(layer()[0], ['consent', 'default', { analytics_storage: 'denied' }]);
});

test('setDefaultConsent defaults everything to denied (EEA-safe)', () => {
  setupDom();
  setDefaultConsent();
  const first = layer()[0] as unknown[];
  assert.equal(first[0], 'consent');
  assert.equal(first[1], 'default');
  const params = first[2] as Record<string, unknown>;
  assert.equal(params.ad_storage, 'denied');
  assert.equal(params.analytics_storage, 'denied');
  assert.equal(params.wait_for_update, 500);
});

test('setDefaultConsent honors a stored choice with an immediate update', () => {
  const { store } = setupDom();
  store.set('mb-consent-v2', JSON.stringify(GRANTED));
  setDefaultConsent();
  assert.equal(layer().length, 2); // default (from stored) + update
  assert.equal((layer()[1] as unknown[])[1], 'update');
});

test('grantAll pushes update + persists to localStorage', () => {
  const { store } = setupDom();
  grantAll();
  const entry = layer()[0] as unknown[];
  assert.equal(entry[1], 'update');
  assert.equal((entry[2] as ConsentChoice).analytics_storage, 'granted');
  assert.ok(store.get('mb-consent-v2')?.includes('granted'));
});

test('denyAll persists all-denied', () => {
  const { store } = setupDom();
  denyAll();
  const saved = JSON.parse(store.get('mb-consent-v2') ?? '{}') as ConsentChoice;
  assert.equal(saved.ad_storage, 'denied');
  assert.equal(saved.analytics_storage, 'denied');
});

test('pushEvent pushes an object-form event onto dataLayer', () => {
  setupDom();
  pushEvent('custom_event', { foo: 1 });
  assert.deepEqual(layer()[0], { event: 'custom_event', foo: 1 });
});

test('track.signUp emits sign_up with method', () => {
  setupDom();
  track.signUp('google');
  assert.deepEqual(layer()[0], { event: 'sign_up', method: 'google' });
});

test('track.purchase emits an item-scoped purchase with USD default', () => {
  setupDom();
  track.purchase('ord_1', [{ item_id: 's', item_name: 'Pro', price: 29 }], 29);
  const e = layer()[0] as Record<string, unknown>;
  assert.equal(e.event, 'purchase');
  assert.equal(e.transaction_id, 'ord_1');
  assert.equal(e.currency, 'USD');
  assert.equal((e.items as unknown[]).length, 1);
});

test('track.search includes term + results count', () => {
  setupDom();
  track.search('shoes', 42);
  assert.deepEqual(layer()[0], {
    event: 'search',
    search_term: 'shoes',
    results_count: 42,
  });
});

test('pushEvent is SSR-safe (no window => no throw, no push)', () => {
  (globalThis as unknown as GlobalShim).window = undefined;
  assert.doesNotThrow(() => pushEvent('x'));
});
