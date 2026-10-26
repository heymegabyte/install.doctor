/**
 * Tests for the GTM loader (analytics.ts). node:test over tsc-compiled CJS with
 * a minimal document/window shim. NOTE: analytics.ts has a module-global
 * `loaded` flag (GTM must inject once), so these tests run in a deliberate order
 * within this file — invalid-id and valid-inject before the idempotency check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGtm, gtmNoscriptHtml, initAnalytics } from '../src/analytics.js';

interface Win {
  dataLayer?: unknown[];
}
interface FakeScript {
  async: boolean;
  src: string;
}
type DomShim = {
  window?: Win;
  localStorage?: unknown;
  document?: {
    createElement(tag: string): FakeScript;
    head: { appendChild(node: FakeScript): void };
  };
};

function setupDom(): { scripts: FakeScript[] } {
  const scripts: FakeScript[] = [];
  const store = new Map<string, string>();
  const g = globalThis as unknown as DomShim;
  g.window = { dataLayer: [] };
  g.localStorage = {
    getItem: (k: string): string | null => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string): void => {
      store.set(k, v);
    },
  };
  g.document = {
    createElement: (): FakeScript => ({ async: false, src: '' }),
    head: {
      appendChild: (node: FakeScript): void => {
        scripts.push(node);
      },
    },
  };
  return { scripts };
}

function layer(): unknown[] {
  return (globalThis as unknown as DomShim).window?.dataLayer ?? [];
}

test('gtmNoscriptHtml returns the ns.html iframe for the container', () => {
  const html = gtmNoscriptHtml('GTM-ABC123');
  assert.match(html, /googletagmanager\.com\/ns\.html\?id=GTM-ABC123/);
  assert.match(html, /display:none/);
});

test('loadGtm validates the id, injects once, and is idempotent', () => {
  const { scripts } = setupDom();

  // invalid id → no injection, no dataLayer push
  loadGtm('not-a-gtm-id');
  assert.equal(scripts.length, 0);
  assert.equal(layer().length, 0);

  // valid id → exactly one async script + a gtm.js dataLayer entry
  loadGtm('GTM-ABC123');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].async, true);
  assert.match(scripts[0].src, /gtm\.js\?id=GTM-ABC123/);
  assert.equal((layer()[0] as Record<string, unknown>).event, 'gtm.js');

  // second call → idempotent (module-global loaded flag) — still one script
  loadGtm('GTM-XYZ789');
  assert.equal(scripts.length, 1);
});

test('initAnalytics pushes a Consent Mode default + a GA4 config', () => {
  setupDom();
  initAnalytics({
    domain: 'example.com',
    gtm_container_id: 'GTM-ABC123',
    ga4_measurement_id: 'G-TEST',
  });
  const entries = layer();
  const isArr = (e: unknown): e is unknown[] => Array.isArray(e);
  const consentDefault = entries.find(
    (e) => isArr(e) && e[0] === 'consent' && e[1] === 'default',
  );
  assert.ok(consentDefault, 'expected a consent default push');
  const config = entries.find(
    (e) => isArr(e) && e[0] === 'config' && e[1] === 'G-TEST',
  );
  assert.ok(config, 'expected a gtag config push');
});
