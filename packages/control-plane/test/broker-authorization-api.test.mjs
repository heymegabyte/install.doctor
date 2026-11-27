import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrokerAuthorizationApi } from '../src/broker-authorization-api.ts';
import { BrokerAuthorizationServiceError } from '../src/broker-authorization-service.ts';

const principal = { deviceCredentialId: 'device-1', deviceFingerprint: 'a'.repeat(64), tenantId: 'tenant-1', permissions: ['authorize-privileged-run'] };

/** @typedef {Parameters<typeof createBrokerAuthorizationApi>[0]} ApiOptions */
/**
 * @param {{
 *   device?: Awaited<ReturnType<ApiOptions['resolveDevice']>>,
 *   owner?: Awaited<ReturnType<ApiOptions['resolveFreshOwner']>>,
 * }} [options]
 */
function fixture({ device = principal, owner = null } = {}) {
  /** @type {[string, unknown, unknown][]} */
  const calls = [];
  /** @satisfies {ApiOptions['service']} */
  const service = {
    requestAuthorization(value, identity) { calls.push(['request', value, identity]); return Promise.resolve({ created: true }); },
    reviewAuthorization(id, identity) { calls.push(['review', id, identity]); return Promise.resolve({ id }); },
    decideAuthorization(value, identity) { calls.push(['decide', value, identity]); return Promise.resolve({ created: true }); },
    claimApprovedAuthorization(value, identity) { calls.push(['claim', value, identity]); return Promise.resolve({ approval: true }); },
    authorizationStatus(value, identity) { calls.push(['status', value, identity]); return Promise.resolve({ schemaVersion: 1, status: 'pending' }); },
  };
  return { app: createBrokerAuthorizationApi({ service, resolveDevice: () => Promise.resolve(device), resolveFreshOwner: () => Promise.resolve(owner) }), service, calls };
}

void test('device routes require explicit authentication before invoking the service', async () => {
  const { app, calls } = fixture({ device: null });
  for (const path of ['/api/devices/broker-authorizations', '/api/devices/broker-approvals/claim',
    '/api/devices/broker-authorizations/status']) {
    const response = await app.request(path, { method: 'POST', body: '{}' });
    assert.equal(response.status, 401);
  }
  assert.deepEqual(calls, []);
});

void test('routes pass authenticated principals and owner sessions to the bounded service', async () => {
  const owner = { actor: 'owner@example.com', authenticatedAt: '2026-11-09T12:00:00.000Z' };
  const { app, calls } = fixture({ owner });
  assert.equal((await app.request('/api/devices/broker-authorizations', { method: 'POST', body: '{"a":1}' })).status, 201);
  assert.equal((await app.request('/api/owner/broker-authorizations/intent-1')).status, 200);
  assert.equal((await app.request('/api/owner/broker-authorizations/decisions', { method: 'POST', body: '{"a":1}' })).status, 201);
  assert.equal((await app.request('/api/devices/broker-approvals/claim', { method: 'POST', body: '{"a":1}' })).status, 200);
  assert.equal((await app.request('/api/devices/broker-authorizations/status', { method: 'POST', body: '{"a":1}' })).status, 200);
  assert.deepEqual(calls.map(value => value[0]), ['request', 'review', 'decide', 'claim', 'status']);
  assert.equal(calls[0]?.[2], principal);
  assert.equal(calls[1]?.[2], owner);
});

void test('adapter bounds bodies and maps validation, policy, and unknown failures without details', async () => {
  const invalid = fixture();
  invalid.service.requestAuthorization = () => { return Promise.reject(new SyntaxError('secret parse detail')); };
  let response = await invalid.app.request('/api/devices/broker-authorizations', { method: 'POST', body: '{}' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_request' });

  invalid.service.requestAuthorization = () => { return Promise.reject(new BrokerAuthorizationServiceError('insufficient_scope', 403)); };
  response = await invalid.app.request('/api/devices/broker-authorizations', { method: 'POST', body: '{}' });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'insufficient_scope' });

  invalid.service.requestAuthorization = () => { return Promise.reject(new Error('database internals')); };
  response = await invalid.app.request('/api/devices/broker-authorizations', { method: 'POST', body: '{}' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'broker_authorization_unavailable' });

  response = await invalid.app.request('/api/devices/broker-authorizations', {
    method: 'POST', headers: { 'content-length': String(64 * 1024 + 1) }, body: '{}',
  });
  assert.equal(response.status, 413);

  response = await invalid.app.request('/api/devices/broker-authorizations', {
    method: 'POST', body: JSON.stringify({ value: 'x'.repeat(64 * 1024) }),
  });
  assert.equal(response.status, 413);
});
