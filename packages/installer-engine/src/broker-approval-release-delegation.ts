import { createHash, createPublicKey } from 'node:crypto';
import { BrokerApprovalSignerDelegation } from '@install-doctor/aid-core/broker-approval-contracts';
import type { PrivilegedBrokerGrant } from './privileged-broker-protocol.js';
import type { PrivilegedBrokerDeviceApprovalTrust } from './privileged-broker-device-approval.js';

const DOMAIN = 'desktop-tools:broker-approval-signer-delegation:v1';
const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)])) : value;

export function deriveReleaseBrokerApprovalTrust(input: {
  readonly bytes: Buffer;
  readonly expectedDigest: string;
  readonly minimumRevocationEpoch: number;
  readonly grant: PrivilegedBrokerGrant;
}): PrivilegedBrokerDeviceApprovalTrust & { readonly maximumApprovalLifetimeSeconds: number;
  readonly delegationDigest: string; readonly revocationEpoch: number } {
  if (digest(input.bytes) !== input.expectedDigest) throw new Error('broker approval delegation differs from signed release authority');
  const value = BrokerApprovalSignerDelegation.parse(JSON.parse(input.bytes.toString('utf8')) as unknown);
  if (!input.bytes.equals(Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8'))) {
    throw new Error('broker approval delegation is not canonical JSON');
  }
  const { delegationDigest, ...projection } = value;
  if (digest(`${DOMAIN}\0${JSON.stringify(canonical(projection))}`) !== delegationDigest) {
    throw new Error('broker approval delegation semantic digest is invalid');
  }
  if (value.product !== 'desktop-tools' || value.channel !== 'stable' || value.releaseId !== input.grant.releaseId
    || value.signatureDomain !== 'desktop-tools-broker-approval-v1') {
    throw new Error('broker approval delegation scope differs from the exact grant');
  }
  if (value.revocationEpoch < input.minimumRevocationEpoch) throw new Error('broker approval delegation is revoked');
  if (Date.parse(value.notBefore) > Date.parse(input.grant.issuedAt)
    || Date.parse(value.notAfter) < Date.parse(input.grant.expiresAt)) {
    throw new Error('broker approval delegation does not cover the exact grant lifetime');
  }
  const der = Buffer.from(value.publicKeySpki, 'base64url');
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519'
    || key.export({ format: 'der', type: 'spki' }).toString('base64url') !== value.publicKeySpki) {
    throw new Error('broker approval delegation key is not canonical Ed25519');
  }
  return Object.freeze({ signerKeyId: value.keyId,
    publicKey: key.export({ format: 'pem', type: 'spki' }).toString(),
    maximumApprovalLifetimeSeconds: value.maximumApprovalLifetimeSeconds,
    delegationDigest: value.delegationDigest, revocationEpoch: value.revocationEpoch });
}
