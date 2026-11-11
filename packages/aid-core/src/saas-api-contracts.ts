import { z } from 'zod';

const VERSION = 1 as const;
const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true }).max(64);
const strict = z.strictObject;
const fieldName = z.string().min(1).max(64).regex(/^[a-z][A-Za-z0-9]*$/);

export const SaasResourceKindSchema = z.enum([
  'profiles', 'machines', 'plans', 'approvals', 'live-runs', 'history', 'catalog', 'drift',
  'secrets-readiness', 'recovery',
]);
export type SaasResourceKind = z.infer<typeof SaasResourceKindSchema>;

const capabilityTruth = strict({
  capabilityId: id,
  status: z.enum(['contract-only', 'implemented-unverified', 'verified-live', 'blocked', 'stale']),
  evidenceRef: z.string().min(1).max(512),
  observedAt: timestamp,
  expiresAt: timestamp.nullable(),
}).superRefine((value, context) => {
  if (value.status === 'verified-live' && value.expiresAt === null) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'verified-live capability truth must expire' });
  }
  if (value.expiresAt !== null && Date.parse(value.expiresAt) <= Date.parse(value.observedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'capability expiry must follow observation' });
  }
});

const tenantRecord = {
  schemaVersion: z.literal(VERSION),
  id,
  tenantId: id,
  capability: capabilityTruth,
  updatedAt: timestamp,
};

const ProfileRecordSchema = strict({ ...tenantRecord, kind: z.literal('profiles'), slug: id,
  revision: id, desiredStateDigest: digest, state: z.enum(['draft', 'ready', 'blocked', 'stale']) });
const MachineRecordSchema = strict({ ...tenantRecord, kind: z.literal('machines'), displayName: z.string().min(1).max(128),
  platform: z.enum(['linux', 'macos', 'windows', 'wsl', 'immutable-linux', 'proxmox', 'qubes']),
  state: z.enum(['enrolling', 'current', 'drifted', 'stale', 'revoked', 'unverified']), lastSeenAt: timestamp.nullable() });
const PlanRecordSchema = strict({ ...tenantRecord, kind: z.literal('plans'), profileId: id, machineId: id, planDigest: digest,
  state: z.enum(['draft', 'validated', 'pending-approval', 'approved', 'expired', 'invalidated', 'blocked']),
  risk: z.enum(['read-only', 'low', 'elevated', 'destructive']) });
const ApprovalRecordSchema = strict({ ...tenantRecord, kind: z.literal('approvals'), planId: id,
  state: z.enum(['pending', 'approved', 'denied', 'expired', 'consumed', 'revoked']), expiresAt: timestamp,
  reauthenticationRequired: z.boolean() });
const LiveRunRecordSchema = strict({ ...tenantRecord, kind: z.literal('live-runs'), planId: id, sessionId: id,
  state: z.enum(['queued', 'running', 'pending-approval', 'blocked', 'failed', 'uncertain', 'cancelled', 'verified']),
  eventCursor: z.number().int().nonnegative(), terminal: z.boolean() });
const HistoryRecordSchema = strict({ ...tenantRecord, kind: z.literal('history'), subjectKind: SaasResourceKindSchema,
  subjectId: id, event: id, outcome: z.enum(['succeeded', 'failed', 'blocked', 'cancelled', 'uncertain', 'informational']),
  occurredAt: timestamp });
const DriftRecordSchema = strict({ ...tenantRecord, kind: z.literal('drift'), machineId: id,
  state: z.enum(['unknown', 'current', 'drifted', 'repair-planned', 'repairing', 'blocked', 'failed']),
  findingCount: z.number().int().nonnegative(), observedAt: timestamp });
const SecretsReadinessRecordSchema = strict({ ...tenantRecord, kind: z.literal('secrets-readiness'), workloadId: id,
  state: z.enum(['unknown', 'ready', 'missing-references', 'authority-unavailable', 'expired', 'blocked']),
  declaredReferenceCount: z.number().int().nonnegative(), missingReferenceIds: z.array(id).max(256) });
const RecoveryRecordSchema = strict({ ...tenantRecord, kind: z.literal('recovery'), workloadId: id,
  state: z.enum(['unknown', 'unprotected', 'stale', 'verification-running', 'failed', 'restorable', 'restored']),
  recoveryPointAt: timestamp.nullable(), lastRestoreVerifiedAt: timestamp.nullable() });

const CatalogRecordSchema = strict({
  schemaVersion: z.literal(VERSION), id, tenantId: z.null(), kind: z.literal('catalog'), capability: capabilityTruth,
  updatedAt: timestamp, packageName: id, lifecycle: z.enum(['active', 'deprecated', 'replaced', 'removed', 'blocked']),
  defaultEligible: z.boolean(), platforms: z.array(z.enum(['linux', 'macos', 'windows'])).min(1).max(3), public: z.literal(true),
});

export const SaasResourceRecordSchema = z.discriminatedUnion('kind', [
  ProfileRecordSchema, MachineRecordSchema, PlanRecordSchema, ApprovalRecordSchema, LiveRunRecordSchema,
  HistoryRecordSchema, CatalogRecordSchema, DriftRecordSchema, SecretsReadinessRecordSchema, RecoveryRecordSchema,
]);
export type SaasResourceRecord = z.infer<typeof SaasResourceRecordSchema>;

export const SaasPrincipalSchema = strict({
  schemaVersion: z.literal(VERSION), principalId: id, tenantId: id,
  readCapabilities: z.array(id).max(128).refine(items => new Set(items).size === items.length, 'read capabilities must be unique'),
});
export type SaasPrincipal = z.infer<typeof SaasPrincipalSchema>;

const keyboardAction = strict({
  id, key: z.string().min(1).max(32), label: z.string().min(1).max(128),
  requiresSelection: z.boolean(),
});
const accessibilityResource = strict({
  kind: SaasResourceKindSchema,
  landmarkLabel: z.string().min(1).max(128), heading: z.string().min(1).max(128),
  itemLabelField: fieldName, statusField: fieldName,
  emptyMessage: z.string().min(1).max(256), loadingAnnouncement: z.string().min(1).max(256),
  errorAnnouncement: z.string().min(1).max(256), liveRegion: z.enum(['off', 'polite', 'assertive']),
  keyboardActions: z.array(keyboardAction).max(16),
});

export const SaasAccessibilityContractSchema = strict({
  schemaVersion: z.literal(VERSION),
  resources: z.array(accessibilityResource).length(SaasResourceKindSchema.options.length),
}).superRefine((value, context) => {
  const kinds = value.resources.map(resource => resource.kind);
  if (new Set(kinds).size !== SaasResourceKindSchema.options.length
    || SaasResourceKindSchema.options.some(kind => !kinds.includes(kind))) {
    context.addIssue({ code: 'custom', path: ['resources'], message: 'accessibility contract must cover every SaaS resource exactly once' });
  }
  for (const [index, resource] of value.resources.entries()) {
    const actions = resource.keyboardActions.map(action => action.id);
    if (new Set(actions).size !== actions.length) context.addIssue({ code: 'custom', path: ['resources', index, 'keyboardActions'], message: 'keyboard action ids must be unique' });
  }
});

const label = (kind: SaasResourceKind, heading: string, itemLabelField: string, statusField: string) => ({
  kind, landmarkLabel: `${heading} workspace`, heading, itemLabelField, statusField,
  emptyMessage: `No ${heading.toLocaleLowerCase('en-US')} are available.`,
  loadingAnnouncement: `Loading ${heading.toLocaleLowerCase('en-US')}.`,
  errorAnnouncement: `${heading} could not be loaded.`, liveRegion: 'polite' as const,
  keyboardActions: [
    { id: 'refresh', key: 'r', label: `Refresh ${heading.toLocaleLowerCase('en-US')}`, requiresSelection: false },
    { id: 'open-details', key: 'Enter', label: 'Open selected details', requiresSelection: true },
  ],
});

/** Nonvisual semantics shared by future browser, assistive-technology, and terminal renderers. */
export const SAAS_ACCESSIBILITY_CONTRACT = SaasAccessibilityContractSchema.parse({ schemaVersion: VERSION, resources: [
  label('profiles', 'Profiles', 'slug', 'state'), label('machines', 'Machines', 'displayName', 'state'),
  label('plans', 'Plans', 'id', 'state'), label('approvals', 'Approvals', 'id', 'state'),
  label('live-runs', 'Live runs', 'sessionId', 'state'), label('history', 'History', 'event', 'outcome'),
  label('catalog', 'Catalog', 'packageName', 'lifecycle'), label('drift', 'Drift', 'machineId', 'state'),
  label('secrets-readiness', 'Secrets readiness', 'workloadId', 'state'), label('recovery', 'Recovery', 'workloadId', 'state'),
] });

const requestSchema = strict({
  schemaVersion: z.literal(VERSION), kinds: z.array(SaasResourceKindSchema).min(1).max(SaasResourceKindSchema.options.length),
}).superRefine((value, context) => {
  if (new Set(value.kinds).size !== value.kinds.length) context.addIssue({ code: 'custom', path: ['kinds'], message: 'requested resource kinds must be unique' });
});

export type SaasReadRequest = z.infer<typeof requestSchema>;

/**
 * Validate and project an already-authorized data-source result. Rejection, rather than filtering,
 * makes a buggy or over-broad backing query observable and prevents accidental cross-tenant or
 * capability over-disclosure from becoming a partially successful response.
 */
export function projectSaasRead(
  principalInput: unknown,
  requestInput: unknown,
  recordsInput: readonly unknown[],
  nowInput: string,
): Readonly<{ schemaVersion: 1; tenantId: string; generatedAt: string; accessibilityVersion: 1; items: SaasResourceRecord[] }> {
  const principal = SaasPrincipalSchema.parse(principalInput);
  const request = requestSchema.parse(requestInput);
  const records = z.array(SaasResourceRecordSchema).max(100_000).parse(recordsInput);
  const now = timestamp.parse(nowInput);
  const requested = new Set(request.kinds);
  const capabilities = new Set(principal.readCapabilities);

  for (const record of records) {
    if (!requested.has(record.kind)) throw new Error(`Unrequested SaaS resource returned by authority: ${record.kind}`);
    if (record.tenantId !== null && record.tenantId !== principal.tenantId) throw new Error('Cross-tenant SaaS resource denied');
    if (record.kind === 'catalog' && (!record.public || record.tenantId !== null)) throw new Error('Catalog resource is not public');
    if (!capabilities.has(record.capability.capabilityId)) throw new Error(`Missing read capability: ${record.capability.capabilityId}`);
    if (record.capability.expiresAt !== null && Date.parse(record.capability.expiresAt) <= Date.parse(now)
      && record.capability.status !== 'stale') {
      throw new Error(`Expired capability truth must be reported stale: ${record.capability.capabilityId}`);
    }
  }

  return Object.freeze({
    schemaVersion: VERSION, tenantId: principal.tenantId, generatedAt: now, accessibilityVersion: VERSION,
    items: structuredClone(records),
  });
}

export function validateSaasAccessibilityContract(input: unknown): z.infer<typeof SaasAccessibilityContractSchema> {
  return SaasAccessibilityContractSchema.parse(input);
}
