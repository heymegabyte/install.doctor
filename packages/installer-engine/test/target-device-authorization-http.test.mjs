import assert from 'node:assert/strict';
import test from 'node:test';
import { createTargetAuthorizationHttpTransport } from '../dist/target-device-authorization-http.js';

const binding = { profileId: 'profile-1', targetPublicKey: 'A'.repeat(43),
  targetKeyFingerprint: 'a'.repeat(64), scopes: ['profile:read'], nonce: 'n'.repeat(32), expiresAt: '2026-11-08T15:10:00.000Z' };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json', ...headers } });

test('uses only fixed HTTPS routes and keeps poll authority out of URLs and bodies', async () => {
  const calls = [];
  const transport = createTargetAuthorizationHttpTransport({ origin: 'https://brian.desktop.tools', fetch: async (url, init) => {
    calls.push({ url, init });
    return json({ request: { exact: true }, approvalUri: 'https://desktop.tools/pair?code=ABCD', pollIntervalMs: 2_000 }, 201);
  } });
  await transport.start({ binding, machineLabel: 'Zen', pollSecret: 'secret-never-serialize' }, new AbortController().signal);
  assert.equal(calls[0].url, 'https://brian.desktop.tools/api/v1/device-authorizations/start');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-never-serialize');
  assert.equal(calls[0].url.includes('secret-never-serialize'), false);
  assert.equal(calls[0].init.body.includes('secret-never-serialize'), false);
  assert.deepEqual(JSON.parse(calls[0].init.body), { binding, machineLabel: 'Zen' });
});

test('normalizes bounded polling status and never follows caller-controlled routes', async () => {
  const responses = [
    new Response('', { status: 429, headers: { 'retry-after': '120' } }),
    json({ status: 'approved', credential: 'c'.repeat(32), credentialId: 'credential-1', expiresAt: '2026-11-08T16:00:00.000Z' }),
    new Response('', { status: 404 }), new Response('', { status: 410 }), new Response(null, { status: 204 }),
  ];
  const calls = [];
  const transport = createTargetAuthorizationHttpTransport({ origin: 'https://desktop.tools', fetch: async (url, init) => {
    calls.push({ url, init }); return responses.shift();
  } });
  const signal = new AbortController().signal;
  assert.deepEqual(await transport.poll('request-1', 'poll-secret', signal), { status: 'pending', retryAfterMs: 30_000 });
  assert.equal((await transport.poll('request-1', 'poll-secret', signal)).status, 'approved');
  assert.deepEqual(await transport.poll('request-1', 'poll-secret', signal), { status: 'denied', reason: 'policy-denied' });
  assert.deepEqual(await transport.poll('request-1', 'poll-secret', signal), { status: 'denied', reason: 'expired' });
  await transport.cancel('request-1', 'poll-secret', signal);
  assert.equal(calls.every(call => call.url.startsWith('https://desktop.tools/api/v1/device-authorizations/request-1/')), true);
});

test('rejects insecure origins, redirects, oversized bodies, malformed JSON, and unknown fields', async () => {
  assert.throws(() => createTargetAuthorizationHttpTransport({ origin: 'http://desktop.tools' }), /canonical HTTPS/);
  assert.throws(() => createTargetAuthorizationHttpTransport({ origin: 'https://desktop.tools/path' }), /canonical HTTPS/);
  const signal = new AbortController().signal;
  for (const response of [
    new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } }),
    json({ request: {}, approvalUri: 'https://desktop.tools/pair', pollIntervalMs: 2_000 }, 201, { 'content-length': '65537' }),
    new Response(`{"padding":"${'x'.repeat(65_537)}"}`, { status: 201, headers: { 'content-type': 'application/json' } }),
    new Response('{', { status: 201, headers: { 'content-type': 'application/json' } }),
    json({ request: {}, approvalUri: 'https://desktop.tools/pair', pollIntervalMs: 2_000, extra: true }, 201),
  ]) {
    const transport = createTargetAuthorizationHttpTransport({ origin: 'https://desktop.tools', fetch: async (_url, init) => {
      if (response.status === 302 && init.redirect === 'error') throw new TypeError('redirect blocked');
      return response;
    } });
    await assert.rejects(transport.start({ binding, machineLabel: 'Zen', pollSecret: 'poll-secret' }, signal));
  }
});
