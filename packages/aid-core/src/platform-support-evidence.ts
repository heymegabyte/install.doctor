import { z } from 'zod';

const VERSION = 1 as const;
const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const strict = z.strictObject;

export const PlatformCellTupleSchema = strict({
  os: z.enum(['linux', 'darwin', 'win32']), version: z.string().min(1).max(64), arch: z.enum(['x64', 'arm64']),
  environment: z.enum(['native', 'wsl', 'proxmox', 'qubes', 'container']), role: id, capability: id,
});

export const PlatformEvidenceBindingsSchema = strict({
  code: strict({ componentId: id, digest }),
  policy: strict({ policyId: id, digest }),
  recipe: strict({ recipeId: id, digest }),
  release: strict({ channel: id, releaseId: id, manifestDigest: digest }),
});

const signature = (namespace: string) => strict({
  keyId: id, algorithm: z.literal('sshsig-ed25519'), namespace: z.literal(namespace), detached: z.literal(true),
  signedDigest: digest,
});
const receiptBase = {
  schemaVersion: z.literal(VERSION), receiptId: id, cellId: id, supportCellDigest: digest,
  bindings: PlatformEvidenceBindingsSchema, recordedAt: timestamp, expiresAt: timestamp, evidenceDigest: digest, statementDigest: digest,
};
const validity = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => schema.superRefine((value, context) => {
  const candidate = value as { recordedAt: string; expiresAt: string; statementDigest: string; signature: { signedDigest: string } };
  if (Date.parse(candidate.expiresAt) <= Date.parse(candidate.recordedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'evidence expiry must follow recording' });
  }
  if (candidate.signature.signedDigest !== candidate.statementDigest) {
    context.addIssue({ code: 'custom', path: ['signature', 'signedDigest'], message: 'signature must bind the exact statement digest' });
  }
});

export const SignedSupportCellSchema = strict({
  schemaVersion: z.literal(VERSION), cellId: id, tuple: PlatformCellTupleSchema, bindings: PlatformEvidenceBindingsSchema,
  qualificationReceiptDigest: digest, qualifiedAt: timestamp, evidenceExpiresAt: timestamp,
  statementDigest: digest,
  signature: signature('desktop.tools.support-cell'),
}).superRefine((value, context) => {
  if (Date.parse(value.evidenceExpiresAt) <= Date.parse(value.qualifiedAt)) {
    context.addIssue({ code: 'custom', path: ['evidenceExpiresAt'], message: 'support-cell evidence expiry must follow qualification' });
  }
  if (value.signature.signedDigest !== value.statementDigest) {
    context.addIssue({ code: 'custom', path: ['signature', 'signedDigest'], message: 'signature must bind the exact statement digest' });
  }
});

export const PlatformFixtureReceiptSchema = validity(strict({
  ...receiptBase, evidenceClass: z.literal('platform-fixture'), result: z.literal('passed'),
  fixture: strict({ kind: z.enum(['vm', 'container', 'hardware', 'platform-lab']), imageDigest: digest, configurationDigest: digest, disposable: z.boolean() }),
  observedTuple: PlatformCellTupleSchema, signature: signature('desktop.tools.platform-fixture'),
}));

export const PlatformCanaryReceiptSchema = validity(strict({
  ...receiptBase, evidenceClass: z.literal('platform-canary'), result: z.literal('passed'), hostEvidenceDigest: digest,
  lifecycle: strict({ freshInstall: z.literal('passed'), unchangedReapply: z.literal('passed'), upgrade: z.literal('passed'),
    interruptionResume: z.literal('passed'), restart: z.literal('passed'), rollback: z.enum(['passed', 'inapplicable']) }),
  signature: signature('desktop.tools.platform-canary'),
}));

export const PlatformBenchmarkReceiptSchema = validity(strict({
  ...receiptBase, evidenceClass: z.literal('platform-benchmark'), result: z.literal('passed'), benchmarkSuiteId: id,
  measurements: z.array(strict({ metric: id, unit: z.enum(['milliseconds', 'bytes', 'percent', 'count']),
    value: z.number().finite().nonnegative(), budget: z.number().finite().nonnegative(), comparison: z.enum(['at-most', 'at-least']) })).min(1).max(128),
  safetyInvariantsPassed: z.literal(true), signature: signature('desktop.tools.platform-benchmark'),
}));

export const PlatformQualificationReceiptSchema = validity(strict({
  ...receiptBase, evidenceClass: z.literal('platform-qualification'), result: z.literal('qualified'),
  fixtureReceiptDigest: digest, canaryReceiptDigest: digest, benchmarkReceiptDigest: digest,
  independentVerifier: id, signature: signature('desktop.tools.platform-qualification'),
}));

export type SignedSupportCell = z.infer<typeof SignedSupportCellSchema>;
export type PlatformEvidenceBindings = z.infer<typeof PlatformEvidenceBindingsSchema>;

export type PlatformEvidenceAuthority = {
  codeDigests: Readonly<Record<string, string>>;
  policyDigests: Readonly<Record<string, string>>;
  recipeDigests: Readonly<Record<string, string>>;
  releases: Readonly<Record<string, { releaseId: string; manifestDigest: string }>>;
  now: string;
};

export function evaluateSupportCellValidity(cellsInput: readonly unknown[], authority: PlatformEvidenceAuthority): Array<{
  cellId: string; valid: boolean; reasons: Array<'code-changed' | 'policy-changed' | 'recipe-changed' | 'release-changed' | 'evidence-expired'>;
}> {
  const cells = z.array(SignedSupportCellSchema).max(10_000).parse(cellsInput);
  const now = timestamp.parse(authority.now);
  return cells.map(cell => {
    const reasons: Array<'code-changed' | 'policy-changed' | 'recipe-changed' | 'release-changed' | 'evidence-expired'> = [];
    if (authority.codeDigests[cell.bindings.code.componentId] !== cell.bindings.code.digest) reasons.push('code-changed');
    if (authority.policyDigests[cell.bindings.policy.policyId] !== cell.bindings.policy.digest) reasons.push('policy-changed');
    if (authority.recipeDigests[cell.bindings.recipe.recipeId] !== cell.bindings.recipe.digest) reasons.push('recipe-changed');
    const release = authority.releases[cell.bindings.release.channel];
    if (!release || release.releaseId !== cell.bindings.release.releaseId
      || release.manifestDigest !== cell.bindings.release.manifestDigest) reasons.push('release-changed');
    if (Date.parse(cell.evidenceExpiresAt) <= Date.parse(now)) reasons.push('evidence-expired');
    return { cellId: cell.cellId, valid: reasons.length === 0, reasons };
  });
}
