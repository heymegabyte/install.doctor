import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);

const HardwareProofSchema = z.strictObject({
  proofId: id,
  provider: z.enum(['tpm2', 'secure-enclave', 'windows-hello']),
  keyId: id,
  publicKeyDigest: digest,
  hardwareInventoryDigest: digest,
  challengeDigest: digest,
  observedAt: timestamp,
  expiresAt: timestamp,
  nonExportable: z.literal(true),
  userPresence: z.boolean(),
}).superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.observedAt)) context.addIssue({ code: 'custom', message: 'hardware proof expiry must follow observation' });
});

export const DevicePostureRequestSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: id, hostId: id,
  platform: z.enum(['linux', 'darwin', 'windows']),
  hardwareInventoryDigest: digest, challengeDigest: digest,
  requiredUserPresence: z.boolean(), now: timestamp,
  supportedProviders: z.array(z.enum(['tpm2', 'secure-enclave', 'windows-hello'])).max(3),
  proofs: z.array(HardwareProofSchema).max(8), verifiedProofIds: z.array(id).max(8),
}).superRefine((value, context) => {
  if (new Set(value.supportedProviders).size !== value.supportedProviders.length) context.addIssue({ code: 'custom', message: 'supported providers must be unique' });
  if (new Set(value.verifiedProofIds).size !== value.verifiedProofIds.length) context.addIssue({ code: 'custom', message: 'verified proof ids must be unique' });
  const compatible = value.platform === 'linux' ? ['tpm2'] : value.platform === 'darwin' ? ['secure-enclave'] : ['tpm2', 'windows-hello'];
  if (value.supportedProviders.some(provider => !compatible.includes(provider))) context.addIssue({ code: 'custom', message: 'provider is not compatible with the declared platform' });
});

export const DevicePostureResultSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: id, hostId: id,
  assurance: z.enum(['hardware-backed', 'degraded']),
  provider: z.enum(['tpm2', 'secure-enclave', 'windows-hello']).nullable(),
  keyId: id.nullable(), publicKeyDigest: digest.nullable(), proofId: id.nullable(),
  reasons: z.array(z.enum(['verified-nonexportable-key', 'hardware-provider-unsupported', 'verified-proof-missing', 'proof-binding-mismatch', 'proof-expired', 'user-presence-missing'])).min(1).max(8),
  resultDigest: digest,
});

export function evaluateDevicePosture(input: unknown): z.infer<typeof DevicePostureResultSchema> {
  const request = DevicePostureRequestSchema.parse(input);
  const verified = new Set(request.verifiedProofIds); const now = Date.parse(request.now);
  let chosen: z.infer<typeof HardwareProofSchema> | undefined;
  const reasons: z.infer<typeof DevicePostureResultSchema>['reasons'] = [];
  if (request.supportedProviders.length === 0) reasons.push('hardware-provider-unsupported');
  for (const proof of request.proofs) {
    if (!request.supportedProviders.includes(proof.provider)) continue;
    if (!verified.has(proof.proofId)) { reasons.push('verified-proof-missing'); continue; }
    if (proof.hardwareInventoryDigest !== request.hardwareInventoryDigest || proof.challengeDigest !== request.challengeDigest) { reasons.push('proof-binding-mismatch'); continue; }
    if (Date.parse(proof.observedAt) > now || now >= Date.parse(proof.expiresAt)) { reasons.push('proof-expired'); continue; }
    if (request.requiredUserPresence && !proof.userPresence) { reasons.push('user-presence-missing'); continue; }
    chosen = proof; break;
  }
  if (!chosen && request.supportedProviders.length > 0 && reasons.length === 0) reasons.push('verified-proof-missing');
  if (chosen) reasons.splice(0, reasons.length, 'verified-nonexportable-key');
  const body = { schemaVersion: 1 as const, requestId: request.requestId, hostId: request.hostId,
    assurance: chosen ? 'hardware-backed' as const : 'degraded' as const, provider: chosen?.provider ?? null,
    keyId: chosen?.keyId ?? null, publicKeyDigest: chosen?.publicKeyDigest ?? null, proofId: chosen?.proofId ?? null,
    reasons: [...new Set(reasons)].sort() };
  return DevicePostureResultSchema.parse({ ...body, resultDigest: createHash('sha256').update(JSON.stringify(body)).digest('hex') });
}

