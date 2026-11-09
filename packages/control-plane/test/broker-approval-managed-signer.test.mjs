import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import test from 'node:test';
import { createBrokerApprovalManagedSigner } from '../src/broker-approval-managed-signer.ts';

test('managed signer adapter admits only exact bounded Ed25519 service responses', async () => {
  const pair = generateKeyPairSync('ed25519');
  const calls = [];
  const signer = createBrokerApprovalManagedSigner({ keyId: 'approval-key-1', service: {
    async fetch(url, init) {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      const signature = sign(null, Buffer.from(body.message, 'base64url'), pair.privateKey).toString('base64url');
      return Response.json({ schemaVersion: 1, keyId: body.keyId, algorithm: 'Ed25519', signature });
    },
  } });
  const message = new TextEncoder().encode('x'.repeat(32));
  const signature = await signer.sign(message);
  assert.equal(verify(null, message, pair.publicKey, signature), true);
  assert.equal(calls[0].url, 'https://broker-approval-signer.internal/v1/sign');
  assert.equal(JSON.stringify(calls[0]).includes('PRIVATE'), false);
});

test('managed signer adapter fails closed on identity, shape, size, and service failure', async () => {
  const signature = 'A'.repeat(86);
  for (const response of [
    Response.json({ schemaVersion: 1, keyId: 'wrong-key', algorithm: 'Ed25519', signature }),
    Response.json({ schemaVersion: 1, keyId: 'approval-key-1', algorithm: 'RSA', signature }),
    new Response('x'.repeat(2_049), { status: 200 }),
    new Response('', { status: 503 }),
  ]) {
    const signer = createBrokerApprovalManagedSigner({ keyId: 'approval-key-1', service: { fetch: async () => response } });
    await assert.rejects(signer.sign(new Uint8Array(32)));
  }
  assert.throws(() => createBrokerApprovalManagedSigner({ keyId: 'approval-key-1', service: { fetch: async () => new Response() }, timeoutMs: 20 }));
});
