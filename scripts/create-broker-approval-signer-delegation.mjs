#!/usr/bin/env node
import { createHash, createPublicKey } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BrokerApprovalSignerDelegation } from '../packages/aid-core/src/broker-approval-contracts.ts';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)])) : value;
const digest = (domain, value) => createHash('sha256')
  .update(`${domain}\0${JSON.stringify(canonical(value))}`).digest('hex');
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);

async function main() {
  const [policyInput, releaseId, createdInput, expiresInput, keyId, publicKeySpki, outputInput] = process.argv.slice(2);
  if (!outputInput || !id(releaseId) || !id(keyId)) throw new Error('usage: POLICY RELEASE_ID CREATED_AT EXPIRES_AT KEY_ID PUBLIC_KEY_SPKI OUTPUT');
  const policyPath = resolve(policyInput);
  const info = await lstat(policyPath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 2 || info.size > 65_536) throw new Error('policy is unsafe');
  const policyBytes = await readFile(policyPath);
  const policy = JSON.parse(policyBytes.toString('utf8'));
  const expectedPolicyKeys = ['channel', 'maximumApprovalLifetimeSeconds', 'minimumRevocationEpoch', 'product', 'schemaVersion'];
  if (JSON.stringify(Object.keys(policy).sort()) !== JSON.stringify(expectedPolicyKeys)
    || !policyBytes.equals(Buffer.from(`${JSON.stringify(canonical(policy), null, 2)}\n`))
    || policy.schemaVersion !== 1 || policy.product !== 'desktop-tools' || policy.channel !== 'stable'
    || !Number.isSafeInteger(policy.minimumRevocationEpoch) || policy.minimumRevocationEpoch < 0
    || !Number.isSafeInteger(policy.maximumApprovalLifetimeSeconds)
    || policy.maximumApprovalLifetimeSeconds < 1 || policy.maximumApprovalLifetimeSeconds > 1800) throw new Error('policy is invalid');
  const createdAt = Number(createdInput); const expiresAt = Number(expiresInput);
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt) || createdAt >= expiresAt
    || expiresAt - createdAt > 604_800) throw new Error('release validity window is invalid');
  const key = createPublicKey({ key: Buffer.from(publicKeySpki, 'base64url'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519'
    || key.export({ format: 'der', type: 'spki' }).toString('base64url') !== publicKeySpki) throw new Error('public SPKI is not canonical Ed25519');
  const projection = { schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation', keyId,
    algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1', product: 'desktop-tools', releaseId,
    channel: policy.channel, publicKeySpki, notBefore: new Date(createdAt * 1000).toISOString(),
    notAfter: new Date(expiresAt * 1000).toISOString(), maximumApprovalLifetimeSeconds: policy.maximumApprovalLifetimeSeconds,
    revocationEpoch: policy.minimumRevocationEpoch };
  const delegation = BrokerApprovalSignerDelegation.parse({ ...projection, delegationDigest: digest(
    'desktop-tools:broker-approval-signer-delegation:v1', projection) });
  await writeFile(resolve(outputInput), `${JSON.stringify(canonical(delegation))}\n`, { mode: 0o600, flag: 'wx' });
}

main().catch(error => { process.stderr.write(`create-broker-approval-signer-delegation: ${error.message}\n`); process.exitCode = 1; });
