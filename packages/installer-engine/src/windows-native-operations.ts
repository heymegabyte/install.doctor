import { createHash } from 'node:crypto';
import { z } from 'zod';

import { WindowsFixtureSchema, type WindowsFixtureBoundary } from './windows-fixture-contract.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const opaqueReference = z.string().min(1).max(512).refine(value => !/[\r\n\0]/u.test(value));
const windowsPath = z.string().min(3).max(1024)
  .regex(/^[A-Za-z]:\\(?:[^<>:"|?*\r\n\0]+\\?)*$/u)
  .refine(value => !value.split('\\').includes('..'), 'parent traversal is forbidden');
const sid = z.string().regex(/^S-1-(?:\d+-){1,14}\d+$/);

export const WINDOWS_NATIVE_OPERATION_KINDS = [
  'stage-zero', 'package', 'file', 'registry', 'service', 'acl', 'reboot', 'secret',
] as const;

const baseOperation = {
  schemaVersion: z.literal(1),
  operationId: identifier,
  dependsOn: z.array(identifier).max(128),
  authority: z.enum(['user', 'machine']),
  timeoutMs: z.number().int().min(1_000).max(3_600_000),
};

const stageZeroOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('stage-zero'),
  releaseDigest: digest,
  envelopeDigest: digest,
  profileOrigin: z.string().url().refine(value => new URL(value).protocol === 'https:'),
  expectedProduct: z.literal('desktop-tools'),
  signerEvidenceId: identifier,
  maxBytes: z.number().int().min(1).max(128 * 1024 * 1024),
});

const packageOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('package'),
  action: z.enum(['install', 'update', 'uninstall']),
  provider: z.enum(['winget', 'msi', 'msix', 'chocolatey', 'scoop']),
  packageId: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._+@/-]*$/),
  version: z.string().min(1).max(128),
  artifactDigest: digest,
  scope: z.enum(['user', 'machine']),
});

const fileOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('file'),
  action: z.enum(['write', 'remove']),
  path: windowsPath,
  contentDigest: digest.optional(),
  ownerSid: sid,
}).superRefine((operation, context) => {
  if (operation.action === 'write' && !operation.contentDigest) {
    context.addIssue({ code: 'custom', path: ['contentDigest'], message: 'write requires an immutable content digest' });
  }
  if (operation.action === 'remove' && operation.contentDigest) {
    context.addIssue({ code: 'custom', path: ['contentDigest'], message: 'remove cannot carry new content' });
  }
});

const registryOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('registry'),
  action: z.enum(['set', 'remove']),
  hive: z.enum(['HKCU', 'HKLM']),
  key: z.string().min(1).max(512).refine(value => !value.split('\\').includes('..')),
  valueName: z.string().min(1).max(256),
  valueType: z.enum(['String', 'ExpandString', 'DWord', 'QWord', 'Binary', 'MultiString']),
  valueDigest: digest.optional(),
}).superRefine((operation, context) => {
  if (operation.action === 'set' && !operation.valueDigest) {
    context.addIssue({ code: 'custom', path: ['valueDigest'], message: 'set requires a value digest' });
  }
});

const serviceOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('service'),
  action: z.enum(['configure', 'start', 'stop', 'restart']),
  serviceName: z.string().min(1).max(256).regex(/^[A-Za-z0-9_.-]+$/),
  startType: z.enum(['Automatic', 'AutomaticDelayedStart', 'Manual', 'Disabled']).optional(),
});

const aclOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('acl'),
  path: windowsPath,
  ownerSid: sid,
  inherit: z.boolean(),
  entries: z.array(z.strictObject({
    principalSid: sid,
    access: z.enum(['allow', 'deny']),
    rights: z.array(z.enum(['read', 'write', 'execute', 'modify', 'full-control'])).min(1).max(5),
  })).min(1).max(64),
});

const rebootOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('reboot'),
  expectedPreBootId: identifier,
  continuationId: identifier,
  deadline: instant,
});

const secretOperation = z.strictObject({
  ...baseOperation,
  kind: z.literal('secret'),
  action: z.enum(['materialize', 'remove']),
  store: z.enum(['credential-manager', 'dpapi-user', 'dpapi-machine']),
  secretReference: opaqueReference.regex(/^infisical:\/\/[a-z0-9][a-z0-9._/-]*$/),
  targetName: z.string().min(1).max(256).refine(value => !/[\r\n\0]/u.test(value)),
  consumerSid: sid,
  valueDigest: digest.optional(),
}).superRefine((operation, context) => {
  if (operation.action === 'materialize' && !operation.valueDigest) {
    context.addIssue({ code: 'custom', path: ['valueDigest'], message: 'materialization requires an in-memory value digest' });
  }
});

export const WindowsNativeOperationSchema = z.discriminatedUnion('kind', [
  stageZeroOperation, packageOperation, fileOperation, registryOperation,
  serviceOperation, aclOperation, rebootOperation, secretOperation,
]);

export const WindowsNativePlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  planId: identifier,
  fixture: WindowsFixtureSchema,
  authorization: z.strictObject({
    fixtureId: identifier,
    purpose: z.literal('disposable-windows-qualification'),
    authorizedBy: identifier,
    evidenceId: identifier,
    expiresAt: instant,
  }),
  verifiedEvidenceIds: z.array(identifier).min(1).max(512),
  target: z.strictObject({
    platform: z.literal('win32'),
    architecture: z.enum(['x64', 'arm64']),
    machineSid: sid,
    userSid: sid,
    bootId: identifier,
  }),
  releaseDigest: digest,
  operations: z.array(WindowsNativeOperationSchema).min(1).max(512),
}).superRefine((plan, context) => {
  if (plan.fixture.fixtureId !== plan.authorization.fixtureId) {
    context.addIssue({ code: 'custom', path: ['authorization', 'fixtureId'], message: 'authorization must bind the fixture' });
  }
  const verifiedEvidence = new Set(plan.verifiedEvidenceIds);
  if (!verifiedEvidence.has(plan.authorization.evidenceId)) {
    context.addIssue({ code: 'custom', path: ['verifiedEvidenceIds'], message: 'fixture authorization must be externally verified' });
  }
  if (plan.fixture.architecture !== plan.target.architecture) {
    context.addIssue({ code: 'custom', path: ['target', 'architecture'], message: 'target architecture must match fixture evidence' });
  }
  const ids = new Set(plan.operations.map(operation => operation.operationId));
  if (ids.size !== plan.operations.length) {
    context.addIssue({ code: 'custom', path: ['operations'], message: 'operation identifiers must be unique' });
  }
  const boundaryForKind: Record<typeof WINDOWS_NATIVE_OPERATION_KINDS[number], WindowsFixtureBoundary> = {
    'stage-zero': 'powershell-stage-zero', package: 'package-provider', file: 'file', registry: 'registry',
    service: 'service', acl: 'acl', reboot: 'reboot', secret: 'secret-storage',
  };
  const seen = new Set<string>();
  for (const [index, operation] of plan.operations.entries()) {
    if (!plan.fixture.supportedBoundaries.includes(boundaryForKind[operation.kind])) {
      context.addIssue({ code: 'custom', path: ['operations', index], message: `${operation.kind} boundary is not supported by this fixture` });
    }
    for (const dependency of operation.dependsOn) {
      if (!ids.has(dependency) || dependency === operation.operationId) {
        context.addIssue({ code: 'custom', path: ['operations', index, 'dependsOn'], message: 'dependencies must name other operations in this plan' });
      } else if (!seen.has(dependency)) {
        context.addIssue({ code: 'custom', path: ['operations', index, 'dependsOn'], message: 'operations must be in dependency order' });
      }
    }
    if (operation.kind === 'stage-zero' && operation.releaseDigest !== plan.releaseDigest) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'releaseDigest'], message: 'stage zero must bind the plan release' });
    }
    if (operation.kind === 'stage-zero' && !verifiedEvidence.has(operation.signerEvidenceId)) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'signerEvidenceId'], message: 'stage-zero signer evidence must be externally verified' });
    }
    if (operation.kind === 'registry' && operation.hive === 'HKLM' && !plan.fixture.secretStores.includes('dpapi-machine')) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'hive'], message: 'machine mutation requires machine-scoped fixture capability' });
    }
    if (operation.kind === 'package' && !plan.fixture.packageProviders.includes(operation.provider)) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'provider'], message: 'package provider was not observed on the fixture' });
    }
    if (operation.kind === 'package' && operation.scope !== operation.authority) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'authority'], message: 'package authority must match its installation scope' });
    }
    if ((operation.kind === 'service' || operation.kind === 'reboot') && operation.authority !== 'machine') {
      context.addIssue({ code: 'custom', path: ['operations', index, 'authority'], message: `${operation.kind} requires machine authority` });
    }
    if (operation.kind === 'secret' && !plan.fixture.secretStores.includes(operation.store)) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'store'], message: 'secret store was not observed on the fixture' });
    }
    if (operation.kind === 'secret') {
      const expectedAuthority = operation.store === 'dpapi-machine' ? 'machine' : 'user';
      const expectedConsumer = expectedAuthority === 'machine' ? plan.target.machineSid : plan.target.userSid;
      if (operation.authority !== expectedAuthority || operation.consumerSid !== expectedConsumer) {
        context.addIssue({ code: 'custom', path: ['operations', index, 'consumerSid'], message: 'secret consumer and authority must match the native store scope' });
      }
    }
    if (operation.kind === 'registry'
      && ((operation.hive === 'HKLM' && operation.authority !== 'machine')
        || (operation.hive === 'HKCU' && operation.authority !== 'user'))) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'authority'], message: 'registry authority must match its hive' });
    }
    if (operation.kind === 'reboot' && operation.expectedPreBootId !== plan.target.bootId) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'expectedPreBootId'], message: 'reboot must bind the observed boot identity' });
    }
    seen.add(operation.operationId);
  }
});

export type WindowsNativePlan = z.infer<typeof WindowsNativePlanSchema>;
export type WindowsNativeOperation = z.infer<typeof WindowsNativeOperationSchema>;

export type DisposableWindowsState = {
  bootId: string;
  packages: Map<string, string>;
  files: Map<string, string>;
  registry: Map<string, string>;
  services: Map<string, string>;
  acls: Map<string, string>;
  secrets: Map<string, string>;
};

export type WindowsNativeReceipt = Readonly<{
  schemaVersion: 1;
  planId: string;
  fixtureId: string;
  outcome: 'verified' | 'pending-reboot';
  operationReceipts: readonly Readonly<{
    operationId: string;
    kind: typeof WINDOWS_NATIVE_OPERATION_KINDS[number];
    outcome: 'applied' | 'unchanged' | 'pending-reboot';
    evidenceDigest: string;
  }>[];
  continuation?: Readonly<{ continuationId: string; preBootId: string }>;
}>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableDigest(value: unknown): string {
  return sha256(JSON.stringify(value, Object.keys(value as object).sort()));
}

/**
 * Deterministic executor for an authorized disposable Windows fixture. It deliberately performs
 * no host I/O; the same typed plan must later be driven by a Windows-native adapter and independently
 * attested before a support cell can be promoted.
 */
export function executeDisposableWindowsPlan(
  input: unknown,
  state: DisposableWindowsState,
  now: string,
): WindowsNativeReceipt {
  const plan = WindowsNativePlanSchema.parse(input);
  const timestamp = instant.parse(now);
  if (Date.parse(plan.authorization.expiresAt) <= Date.parse(timestamp)) {
    throw new Error('disposable Windows fixture authorization is expired');
  }
  if (state.bootId !== plan.target.bootId) throw new Error('Windows boot identity changed before apply');

  const receipts: Array<WindowsNativeReceipt['operationReceipts'][number]> = [];
  const outcomes = new Map<string, string>();
  for (const operation of plan.operations) {
    if (operation.dependsOn.some(dependency => !outcomes.has(dependency))) {
      throw new Error(`operation ${operation.operationId} is not topologically ready`);
    }
    let outcome: 'applied' | 'unchanged' | 'pending-reboot' = 'applied';
    const key = operation.operationId;
    if (operation.kind === 'stage-zero') {
      outcome = outcomes.get(`stage-zero:${operation.releaseDigest}`) === operation.envelopeDigest ? 'unchanged' : 'applied';
      outcomes.set(`stage-zero:${operation.releaseDigest}`, operation.envelopeDigest);
    } else if (operation.kind === 'package') {
      const packageKey = `${operation.provider}:${operation.scope}:${operation.packageId}`;
      const current = state.packages.get(packageKey);
      if (operation.action === 'uninstall') {
        outcome = current === undefined ? 'unchanged' : 'applied'; state.packages.delete(packageKey);
      } else {
        outcome = current === operation.version ? 'unchanged' : 'applied'; state.packages.set(packageKey, operation.version);
      }
    } else if (operation.kind === 'file') {
      const current = state.files.get(operation.path);
      if (operation.action === 'remove') { outcome = current === undefined ? 'unchanged' : 'applied'; state.files.delete(operation.path); }
      else { outcome = current === operation.contentDigest ? 'unchanged' : 'applied'; state.files.set(operation.path, operation.contentDigest!); }
    } else if (operation.kind === 'registry') {
      const registryKey = `${operation.hive}\\${operation.key}::${operation.valueName}`;
      const current = state.registry.get(registryKey);
      if (operation.action === 'remove') { outcome = current === undefined ? 'unchanged' : 'applied'; state.registry.delete(registryKey); }
      else { outcome = current === operation.valueDigest ? 'unchanged' : 'applied'; state.registry.set(registryKey, operation.valueDigest!); }
    } else if (operation.kind === 'service') {
      const desired = `${operation.action}:${operation.startType ?? 'preserve'}`;
      outcome = state.services.get(operation.serviceName) === desired ? 'unchanged' : 'applied';
      state.services.set(operation.serviceName, desired);
    } else if (operation.kind === 'acl') {
      const desired = stableDigest({ ownerSid: operation.ownerSid, inherit: operation.inherit, entries: operation.entries });
      outcome = state.acls.get(operation.path) === desired ? 'unchanged' : 'applied'; state.acls.set(operation.path, desired);
    } else if (operation.kind === 'secret') {
      const secretKey = `${operation.store}:${operation.targetName}:${operation.consumerSid}`;
      const current = state.secrets.get(secretKey);
      if (operation.action === 'remove') { outcome = current === undefined ? 'unchanged' : 'applied'; state.secrets.delete(secretKey); }
      else { outcome = current === operation.valueDigest ? 'unchanged' : 'applied'; state.secrets.set(secretKey, operation.valueDigest!); }
    } else {
      if (Date.parse(operation.deadline) <= Date.parse(timestamp)) throw new Error('reboot continuation deadline elapsed');
      outcome = 'pending-reboot';
      receipts.push(Object.freeze({ operationId: key, kind: operation.kind, outcome,
        evidenceDigest: stableDigest({ operationId: key, preBootId: state.bootId, continuationId: operation.continuationId }) }));
      return Object.freeze({ schemaVersion: 1, planId: plan.planId, fixtureId: plan.fixture.fixtureId,
        outcome: 'pending-reboot', operationReceipts: Object.freeze(receipts),
        continuation: Object.freeze({ continuationId: operation.continuationId, preBootId: state.bootId }) });
    }
    outcomes.set(key, outcome);
    receipts.push(Object.freeze({ operationId: key, kind: operation.kind, outcome,
      evidenceDigest: stableDigest({ operationId: key, kind: operation.kind, outcome }) }));
  }
  return Object.freeze({ schemaVersion: 1, planId: plan.planId, fixtureId: plan.fixture.fixtureId,
    outcome: 'verified', operationReceipts: Object.freeze(receipts) });
}

export function resumeDisposableWindowsReboot(
  receipt: WindowsNativeReceipt,
  state: DisposableWindowsState,
  newBootId: string,
): Readonly<{ outcome: 'verified'; continuationId: string; postBootId: string }> {
  if (receipt.outcome !== 'pending-reboot' || !receipt.continuation) throw new Error('receipt has no pending reboot');
  identifier.parse(newBootId);
  if (newBootId === receipt.continuation.preBootId) throw new Error('reboot did not produce a fresh boot identity');
  state.bootId = newBootId;
  return Object.freeze({ outcome: 'verified', continuationId: receipt.continuation.continuationId, postBootId: newBootId });
}
