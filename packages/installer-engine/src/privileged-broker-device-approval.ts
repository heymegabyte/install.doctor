import { createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from 'node:crypto';
import { SignedBrokerApproval, brokerApprovalAuditDigest, brokerApprovalSemanticDigest,
  brokerApprovalSigningBytes } from '@install-doctor/aid-core/broker-approval-contracts';
import { PrivilegedBrokerApprovalEvidenceSchema, PrivilegedBrokerGrantSchema, privilegedBrokerDigest } from './privileged-broker-protocol.js';
import type { PrivilegedBrokerApprovalEvidence, PrivilegedBrokerGrant } from './privileged-broker-protocol.js';
import { PrivilegedBrokerExecutionAuthoritySchema, privilegedBrokerDescriptorDigest,
  privilegedBrokerExecutionAuthorityDigest } from './privileged-broker-authority.js';
import type { PrivilegedBrokerExecutionAuthority } from './privileged-broker-authority.js';
import { createPrivilegedBrokerStore } from './privileged-broker-store.js';

const DOMAIN = Buffer.from('desktop-tools:privileged-broker-device-approval:v1\0', 'ascii');

export interface PrivilegedBrokerDeviceApprovalTrust {
  readonly signerKeyId: string;
  readonly publicKey: string;
}

export async function verifyControlPlaneBrokerApproval(input: { readonly grant: unknown; readonly approval: unknown;
  readonly trust: PrivilegedBrokerDeviceApprovalTrust; readonly delegationDigest: string;
  readonly minimumRevocationEpoch: number; readonly maximumApprovalLifetimeSeconds: number;
  readonly now?: Date }): Promise<boolean> {
  const grant = PrivilegedBrokerGrantSchema.parse(input.grant);
  const approval = SignedBrokerApproval.parse(input.approval);
  const expectedGrantDigest = await brokerApprovalSemanticDigest('desktop-tools:privileged-broker:v1', grant);
  const embeddedGrantDigest = await brokerApprovalSemanticDigest('desktop-tools:privileged-broker:v1', approval.grant);
  if (approval.signerKeyId !== input.trust.signerKeyId || approval.grant.grantId !== grant.grantId
    || expectedGrantDigest !== approval.grantDigest || embeddedGrantDigest !== expectedGrantDigest
    || approval.delegationDigest !== input.delegationDigest
    || approval.revocationEpoch < input.minimumRevocationEpoch) return false;
  const now = (input.now ?? new Date()).getTime();
  if (now < Date.parse(approval.approvedAt) || now >= Date.parse(approval.expiresAt)
    || Date.parse(approval.approvedAt) < Date.parse(grant.issuedAt)
    || Date.parse(approval.expiresAt) > Date.parse(grant.expiresAt)
    || Date.parse(approval.expiresAt) - Date.parse(approval.approvedAt) > input.maximumApprovalLifetimeSeconds * 1000) return false;
  const { signature, auditDigest, ...unsigned } = approval;
  if (await brokerApprovalAuditDigest(unsigned) !== auditDigest) return false;
  const signatureBytes = Buffer.from(signature, 'base64url');
  if (signatureBytes.length !== 64 || signatureBytes.toString('base64url') !== signature) return false;
  const key = createPublicKey(input.trust.publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('device approval trust key must be Ed25519');
  return verify(null, brokerApprovalSigningBytes(unsigned), key, signatureBytes);
}

function binding(grant: PrivilegedBrokerGrant) {
  return {
    grantId: grant.grantId, grantDigest: privilegedBrokerDigest(grant), hostId: grant.hostId,
    releaseId: grant.releaseId, runId: grant.runId, planDigest: grant.planDigest, enrolledUid: grant.enrolledUid,
    brokerExecutableDigest: grant.brokerExecutableDigest, runtimeDigest: grant.runtimeDigest,
    workerDigest: grant.workerDigest, descriptorDigest: grant.descriptorDigest,
    closureDigest: grant.closureDigest, consentDigest: grant.consentDigest,
  } as const;
}

function approvalMessage(input: { readonly approvalId: string; readonly grant: PrivilegedBrokerGrant;
  readonly signerKeyId: string; readonly approvedAt: string }): Buffer {
  const digest = privilegedBrokerDigest({ schemaVersion: 1, kind: 'desktop-tools-privileged-broker-device-approval',
    method: 'signed-device', approvalId: input.approvalId, ...binding(input.grant),
    signerKeyId: input.signerKeyId, approvedAt: input.approvedAt });
  return Buffer.concat([DOMAIN, Buffer.from(digest, 'ascii')]);
}

function evidenceDigest(message: Buffer): string { return createHash('sha256').update(message).digest('hex'); }

function assertApprovalTime(grant: PrivilegedBrokerGrant, approvedAt: string): void {
  const approved = Date.parse(approvedAt);
  if (!Number.isFinite(approved) || approved < Date.parse(grant.issuedAt) || approved >= Date.parse(grant.expiresAt)) {
    throw new Error('signed device approval is outside the exact grant lifetime');
  }
}

/** Control-plane signing primitive. The private key must remain outside target hosts. */
export function createSignedDeviceBrokerApproval(input: { readonly grant: unknown; readonly approvalId: string;
  readonly signerKeyId: string; readonly privateKey: string; readonly approvedAt: string }):
  Extract<PrivilegedBrokerApprovalEvidence, { method: 'signed-device' }> {
  const grant = PrivilegedBrokerGrantSchema.parse(input.grant);
  assertApprovalTime(grant, input.approvedAt);
  const key = createPrivateKey(input.privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('device approval signer must be Ed25519');
  const message = approvalMessage({ approvalId: input.approvalId, grant, signerKeyId: input.signerKeyId, approvedAt: input.approvedAt });
  return PrivilegedBrokerApprovalEvidenceSchema.parse({ schemaVersion: 1, approvalId: input.approvalId,
    method: 'signed-device', ...binding(grant), evidenceDigest: evidenceDigest(message), approvedAt: input.approvedAt,
    proof: { signerKeyId: input.signerKeyId, signature: sign(null, message, key).toString('base64url') } }) as
    Extract<PrivilegedBrokerApprovalEvidence, { method: 'signed-device' }>;
}

/** Root-side verifier for an owner-approved, control-plane-signed exact grant. */
export function verifySignedDeviceBrokerApproval(input: { readonly grant: unknown; readonly approval: unknown;
  readonly trust: PrivilegedBrokerDeviceApprovalTrust }): boolean {
  const grant = PrivilegedBrokerGrantSchema.parse(input.grant);
  const approval = PrivilegedBrokerApprovalEvidenceSchema.parse(input.approval);
  if (approval.method !== 'signed-device' || approval.proof.signerKeyId !== input.trust.signerKeyId) return false;
  assertApprovalTime(grant, approval.approvedAt);
  const expected = { ...binding(grant), approvalId: approval.approvalId, approvedAt: approval.approvedAt };
  for (const [key, value] of Object.entries(expected)) {
    if (approval[key as keyof typeof approval] !== value) return false;
  }
  const message = approvalMessage({ approvalId: approval.approvalId, grant,
    signerKeyId: approval.proof.signerKeyId, approvedAt: approval.approvedAt });
  const expectedDigest = evidenceDigest(message);
  if (!timingSafeEqual(Buffer.from(approval.evidenceDigest, 'ascii'), Buffer.from(expectedDigest, 'ascii'))) return false;
  const signature = Buffer.from(approval.proof.signature, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== approval.proof.signature) return false;
  const key = createPublicKey(input.trust.publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('device approval trust key must be Ed25519');
  return verify(null, message, key, signature);
}

/** Publishes only independently verified signed-device authority into the root store. */
export async function publishSignedDeviceBrokerGrant(input: { readonly grant: unknown;
  readonly authority: PrivilegedBrokerExecutionAuthority; readonly approval: unknown;
  readonly trust: PrivilegedBrokerDeviceApprovalTrust; readonly delegationDigest: string;
  readonly minimumRevocationEpoch: number; readonly maximumApprovalLifetimeSeconds: number;
  readonly now?: Date }): Promise<Readonly<{
    grantDigest: string; authorityDigest: string; approvalEvidenceDigest: string;
  }>> {
  const grant = PrivilegedBrokerGrantSchema.parse(input.grant);
  const authority = PrivilegedBrokerExecutionAuthoritySchema.parse(input.authority);
  const approval = SignedBrokerApproval.parse(input.approval);
  if (authority.hostId !== grant.hostId || authority.releaseId !== grant.releaseId
    || authority.runId !== grant.runId || authority.planDigest !== grant.planDigest
    || privilegedBrokerExecutionAuthorityDigest(authority) !== grant.closureDigest
    || privilegedBrokerDescriptorDigest(authority.descriptor) !== grant.descriptorDigest) {
    throw new Error('signed device broker authority differs from the exact grant');
  }
  if (!await verifyControlPlaneBrokerApproval({ grant, approval, trust: input.trust,
    delegationDigest: input.delegationDigest, minimumRevocationEpoch: input.minimumRevocationEpoch,
    maximumApprovalLifetimeSeconds: input.maximumApprovalLifetimeSeconds,
    ...(input.now ? { now: input.now } : {}) })) {
    throw new Error('signed device broker approval was not independently verified');
  }
  const bridge = PrivilegedBrokerApprovalEvidenceSchema.parse({ schemaVersion: 1, approvalId: approval.approvalId,
    method: 'signed-device', ...binding(grant), evidenceDigest: approval.auditDigest, approvedAt: approval.approvedAt,
    proof: { signerKeyId: approval.signerKeyId, signature: approval.signature } });
  const bridgeDigest = privilegedBrokerDigest(bridge);
  const store = await createPrivilegedBrokerStore({ root: '/run/desktop-tools/privileged',
    verifyApproval: async candidate => privilegedBrokerDigest(candidate) === bridgeDigest });
  const publishedGrant = await store.publishGrant(grant, bridge);
  const publishedAuthority = await store.publishAuthority(grant.grantId, authority);
  return Object.freeze({ grantDigest: publishedGrant.digest, authorityDigest: publishedAuthority.digest,
    approvalEvidenceDigest: approval.auditDigest });
}
