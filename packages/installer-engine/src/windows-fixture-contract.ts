import { z } from 'zod';

export const WINDOWS_FIXTURE_BOUNDARIES = [
  'powershell-stage-zero',
  'package-provider',
  'file',
  'acl',
  'reparse-point',
  'registry',
  'service',
  'reboot',
  'wsl',
  'secret-storage',
] as const;

export const WINDOWS_LIFECYCLE_PHASES = [
  'clean-install',
  'unchanged-reapply',
  'upgrade',
  'interruption-recovery',
  'restart',
  'rollback',
] as const;

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });

export const WindowsFixtureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  fixtureId: identifier,
  isolation: z.literal('disposable-vm'),
  platform: z.literal('win32'),
  architecture: z.enum(['x64', 'arm64']),
  edition: z.string().min(1).max(128),
  build: z.string().regex(/^\d{5,6}(?:\.\d+)?$/),
  powershell: z.strictObject({
    edition: z.enum(['Desktop', 'Core']),
    version: z.string().regex(/^\d+\.\d+(?:\.\d+){0,2}$/),
    executionPolicyObserved: z.enum(['AllSigned', 'Bypass', 'Default', 'RemoteSigned', 'Restricted', 'Undefined', 'Unrestricted']),
  }),
  packageProviders: z.array(z.enum(['winget', 'msi', 'msix', 'chocolatey', 'scoop'])).max(5),
  secretStores: z.array(z.enum(['credential-manager', 'dpapi-user', 'dpapi-machine'])).max(3),
  wsl: z.strictObject({
    available: z.boolean(),
    authoritySeparated: z.boolean(),
  }),
  supportedBoundaries: z.array(z.enum(WINDOWS_FIXTURE_BOUNDARIES)).min(1).max(WINDOWS_FIXTURE_BOUNDARIES.length),
}).superRefine((fixture, context) => {
  if (new Set(fixture.supportedBoundaries).size !== fixture.supportedBoundaries.length) {
    context.addIssue({ code: 'custom', path: ['supportedBoundaries'], message: 'supported boundaries must be unique' });
  }
  if (new Set(fixture.packageProviders).size !== fixture.packageProviders.length) {
    context.addIssue({ code: 'custom', path: ['packageProviders'], message: 'package providers must be unique' });
  }
  if (new Set(fixture.secretStores).size !== fixture.secretStores.length) {
    context.addIssue({ code: 'custom', path: ['secretStores'], message: 'secret stores must be unique' });
  }
  if (fixture.supportedBoundaries.includes('package-provider') && fixture.packageProviders.length === 0) {
    context.addIssue({ code: 'custom', path: ['packageProviders'], message: 'package-provider support requires an observed provider' });
  }
  if (fixture.supportedBoundaries.includes('secret-storage') && fixture.secretStores.length === 0) {
    context.addIssue({ code: 'custom', path: ['secretStores'], message: 'secret-storage support requires an observed store' });
  }
  if (fixture.supportedBoundaries.includes('wsl') && (!fixture.wsl.available || !fixture.wsl.authoritySeparated)) {
    context.addIssue({ code: 'custom', path: ['wsl'], message: 'WSL support requires availability and separate Windows/Linux authority' });
  }
});

export const WindowsFixtureEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceId: identifier,
  source: z.literal('real-windows-host'),
  fixtureId: identifier,
  boundary: z.enum(WINDOWS_FIXTURE_BOUNDARIES),
  releaseDigest: sha256,
  recipeDigest: sha256,
  observedAt: instant,
  expiresAt: instant,
  independentAttestor: identifier,
  phases: z.array(z.enum(WINDOWS_LIFECYCLE_PHASES)).length(WINDOWS_LIFECYCLE_PHASES.length),
  outcome: z.literal('passed'),
}).superRefine((evidence, context) => {
  if (new Set(evidence.phases).size !== WINDOWS_LIFECYCLE_PHASES.length
    || WINDOWS_LIFECYCLE_PHASES.some(phase => !evidence.phases.includes(phase))) {
    context.addIssue({ code: 'custom', path: ['phases'], message: 'evidence must cover every Windows lifecycle phase exactly once' });
  }
  if (Date.parse(evidence.expiresAt) <= Date.parse(evidence.observedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'evidence expiry must follow observation' });
  }
});

export const WindowsMutationPreflightSchema = z.strictObject({
  fixture: WindowsFixtureSchema,
  boundary: z.enum(WINDOWS_FIXTURE_BOUNDARIES),
  releaseDigest: sha256,
  recipeDigest: sha256,
  evidence: z.array(WindowsFixtureEvidenceSchema).max(512),
  verifiedEvidenceIds: z.array(identifier).max(512),
  now: instant,
});

export type WindowsFixtureBoundary = typeof WINDOWS_FIXTURE_BOUNDARIES[number];

export type WindowsMutationPreflightResult = Readonly<{
  decision: 'allow' | 'deny';
  boundary: WindowsFixtureBoundary;
  evidenceId?: string;
  reason: 'verified-real-evidence' | 'unsupported-boundary' | 'no-current-verified-real-evidence';
}>;

/**
 * Pure admission contract. Evidence is not trusted merely because it parses: its identifier must
 * also be supplied by the external signature/attestation verifier in verifiedEvidenceIds.
 */
export function preflightWindowsMutation(input: unknown): WindowsMutationPreflightResult {
  const request = WindowsMutationPreflightSchema.parse(input);
  if (!request.fixture.supportedBoundaries.includes(request.boundary)) {
    return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'unsupported-boundary' });
  }
  const verified = new Set(request.verifiedEvidenceIds);
  const now = Date.parse(request.now);
  const evidence = request.evidence.find(item => item.boundary === request.boundary
    && item.fixtureId === request.fixture.fixtureId
    && item.releaseDigest === request.releaseDigest
    && item.recipeDigest === request.recipeDigest
    && verified.has(item.evidenceId)
    && Date.parse(item.observedAt) <= now
    && now < Date.parse(item.expiresAt));
  if (!evidence) {
    return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'no-current-verified-real-evidence' });
  }
  return Object.freeze({ decision: 'allow', boundary: request.boundary,
    evidenceId: evidence.evidenceId, reason: 'verified-real-evidence' });
}
