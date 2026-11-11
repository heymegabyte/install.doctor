import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  QubesFixtureSchema,
  QubesFixtureEvidenceSchema,
  digestQubesFixture,
  preflightQubesMutation,
} from './qubes-fixture-contract.js';

const VERSION = z.literal(1);
const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });

export const QUBES_NATIVE_OPERATION_KINDS = [
  'dom0-policy',
  'template-package',
  'app-config',
  'disposable-run',
  'disposable-destroy',
  'whonix-gateway-config',
  'whonix-workstation-config',
] as const;

const operationContracts = {
  'dom0-policy': { targetKind: 'dom0', service: 'desktop.ToolsDom0Policy', authority: 'dom0.policy' },
  'template-package': { targetKind: 'template-vm', service: 'desktop.ToolsTemplatePackage', authority: 'template.package' },
  'app-config': { targetKind: 'app-vm', service: 'desktop.ToolsAppConfig', authority: 'app.configure' },
  'disposable-run': { targetKind: 'disposable-vm', service: 'desktop.ToolsDisposableRun', authority: 'disposable.run' },
  'disposable-destroy': { targetKind: 'disposable-vm', service: 'desktop.ToolsDisposableDestroy', authority: 'disposable.destroy' },
  'whonix-gateway-config': { targetKind: 'whonix-gateway', service: 'desktop.ToolsWhonixGateway', authority: 'whonix.gateway.configure' },
  'whonix-workstation-config': { targetKind: 'whonix-workstation', service: 'desktop.ToolsWhonixWorkstation', authority: 'whonix.workstation.configure' },
} as const;

const operationKind = z.enum(QUBES_NATIVE_OPERATION_KINDS);
const QubesNativeOperationSchema = z.strictObject({
  operationId: identifier,
  kind: operationKind,
  dependsOn: z.array(identifier).max(64),
  sourceId: identifier,
  targetId: identifier,
  argument: identifier.nullable(),
  payloadDigest: digest,
  artifactDigest: digest.optional(),
  offlineSafe: z.literal(true),
  timeoutMs: z.number().int().min(1_000).max(900_000),
});

export const QubesNativePlanSchema = z.strictObject({
  schemaVersion: VERSION,
  planId: identifier,
  fixture: QubesFixtureSchema,
  releaseDigest: digest,
  recipeDigest: digest,
  networkPolicy: z.literal('deny'),
  offline: z.literal(true),
  operations: z.array(QubesNativeOperationSchema).min(QUBES_NATIVE_OPERATION_KINDS.length).max(512),
  evidence: z.array(QubesFixtureEvidenceSchema).min(1).max(512),
  verifiedEvidenceIds: z.array(identifier).min(1).max(512),
  expiresAt: instant,
}).superRefine((plan, context) => {
  const ids = new Set<string>();
  const byId = new Map(plan.fixture.compartments.map(item => [item.id, item]));
  const kinds = new Set<string>();
  for (const [index, operation] of plan.operations.entries()) {
    if (ids.has(operation.operationId)) context.addIssue({ code: 'custom', path: ['operations', index, 'operationId'], message: 'operation ids must be unique' });
    ids.add(operation.operationId);
    kinds.add(operation.kind);
    if (new Set(operation.dependsOn).size !== operation.dependsOn.length) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'dependsOn'], message: 'dependencies must be unique' });
    }
    const contract = operationContracts[operation.kind];
    const target = byId.get(operation.targetId);
    if (!target || target.kind !== contract.targetKind) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'targetId'], message: `${operation.kind} requires exact ${contract.targetKind} target` });
    }
    const route = plan.fixture.qrexecRules.find(rule => rule.sourceId === operation.sourceId
      && rule.targetId === operation.targetId && rule.service === contract.service && rule.argument === operation.argument);
    if (!route || !route.authorities.includes(contract.authority)) {
      context.addIssue({ code: 'custom', path: ['operations', index], message: `${operation.kind} requires an exact least-privilege qrexec route` });
    }
    if (operation.kind === 'template-package' && !operation.artifactDigest) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'artifactDigest'], message: 'offline template package requires an embedded artifact digest' });
    }
    if (operation.kind !== 'template-package' && operation.artifactDigest) {
      context.addIssue({ code: 'custom', path: ['operations', index, 'artifactDigest'], message: 'artifact digest is permitted only for template packages' });
    }
  }
  for (const required of QUBES_NATIVE_OPERATION_KINDS) if (!kinds.has(required)) {
    context.addIssue({ code: 'custom', path: ['operations'], message: `strict lifecycle fixture requires ${required}` });
  }
  for (const [index, operation] of plan.operations.entries()) for (const dependency of operation.dependsOn) {
    if (!ids.has(dependency)) context.addIssue({ code: 'custom', path: ['operations', index, 'dependsOn'], message: 'dependency must name an operation in this plan' });
    if (dependency === operation.operationId) context.addIssue({ code: 'custom', path: ['operations', index, 'dependsOn'], message: 'operation cannot depend on itself' });
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const dependencies = new Map(plan.operations.map(item => [item.operationId, item.dependsOn]));
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) if (!walk(dependency)) return false;
    visiting.delete(id); visited.add(id); return true;
  };
  if (plan.operations.some(item => !walk(item.operationId))) context.addIssue({ code: 'custom', path: ['operations'], message: 'operation dependency graph must be acyclic' });
  for (const run of plan.operations.filter(item => item.kind === 'disposable-run')) {
    const destroy = plan.operations.find(item => item.kind === 'disposable-destroy' && item.targetId === run.targetId
      && item.dependsOn.includes(run.operationId));
    if (!destroy) context.addIssue({ code: 'custom', path: ['operations'], message: 'every disposable run requires a dependent teardown for the same DisposableVM' });
  }
});

export type QubesDisposableState = {
  values: Map<string, string>;
  activeDisposables: Set<string>;
  networkAttempts: number;
};

export type QubesNativeLifecycleReceipt = Readonly<{
  schemaVersion: 1;
  planId: string;
  fixtureId: string;
  fixtureDigest: string;
  outcome: 'verified';
  offline: true;
  networkPolicy: 'deny';
  networkAttempts: 0;
  operationReceipts: ReadonlyArray<Readonly<{
    operationId: string;
    kind: typeof QUBES_NATIVE_OPERATION_KINDS[number];
    sourceId: string;
    targetId: string;
    ruleId: string;
    outcome: 'applied' | 'unchanged' | 'destroyed';
    evidenceDigest: string;
  }>>;
  compartmentsVerified: ReadonlyArray<string>;
  destroyedDisposables: ReadonlyArray<string>;
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/**
 * Executes only the strict in-memory disposable Qubes fixture. A real adapter must translate the
 * admitted service tuple to qrexec; this contract intentionally exposes no shell or command field.
 */
export function executeDisposableQubesLifecycle(input: unknown, state: QubesDisposableState, now: string): QubesNativeLifecycleReceipt {
  const plan = QubesNativePlanSchema.parse(input);
  const observedAt = instant.parse(now);
  if (Date.parse(plan.expiresAt) <= Date.parse(observedAt)) throw new Error('Qubes lifecycle plan is expired');
  if (state.networkAttempts !== 0) throw new Error('offline Qubes lifecycle observed a network attempt before execution');

  const pending = new Map(plan.operations.map(item => [item.operationId, item]));
  const completed = new Set<string>();
  const receipts: Array<QubesNativeLifecycleReceipt['operationReceipts'][number]> = [];
  const destroyed = new Set<string>();
  while (pending.size > 0) {
    const ready = [...pending.values()].filter(item => item.dependsOn.every(dependency => completed.has(dependency)))
      .sort((left, right) => left.operationId.localeCompare(right.operationId));
    if (ready.length === 0) throw new Error('Qubes lifecycle has no topologically ready operation');
    for (const operation of ready) {
      const contract = operationContracts[operation.kind];
      const admission = preflightQubesMutation({
        fixture: plan.fixture,
        boundary: 'qrexec',
        qrexec: { sourceId: operation.sourceId, targetId: operation.targetId, service: contract.service,
          argument: operation.argument, authority: contract.authority },
        releaseDigest: plan.releaseDigest,
        recipeDigest: plan.recipeDigest,
        evidence: plan.evidence,
        verifiedEvidenceIds: plan.verifiedEvidenceIds,
        now: observedAt,
      });
      if (admission.decision !== 'allow' || !admission.ruleId) throw new Error(`qrexec admission denied for ${operation.operationId}: ${admission.reason}`);

      const key = `${operation.kind}:${operation.targetId}:${operation.argument ?? ''}`;
      let outcome: 'applied' | 'unchanged' | 'destroyed';
      if (operation.kind === 'disposable-destroy') {
        if (!state.activeDisposables.delete(operation.targetId)) throw new Error(`DisposableVM ${operation.targetId} is not active`);
        for (const stateKey of state.values.keys()) {
          if (stateKey.startsWith(`disposable-run:${operation.targetId}:`)) state.values.delete(stateKey);
        }
        destroyed.add(operation.targetId);
        outcome = 'destroyed';
      } else {
        if (operation.kind === 'disposable-run') state.activeDisposables.add(operation.targetId);
        const desired = sha256({ payloadDigest: operation.payloadDigest, artifactDigest: operation.artifactDigest ?? null });
        outcome = state.values.get(key) === desired ? 'unchanged' : 'applied';
        state.values.set(key, desired);
      }
      receipts.push(Object.freeze({ operationId: operation.operationId, kind: operation.kind,
        sourceId: operation.sourceId, targetId: operation.targetId, ruleId: admission.ruleId, outcome,
        evidenceDigest: sha256({ operationId: operation.operationId, ruleId: admission.ruleId, outcome,
          payloadDigest: operation.payloadDigest, offline: true, networkPolicy: 'deny' }) }));
      pending.delete(operation.operationId); completed.add(operation.operationId);
    }
  }
  if (state.networkAttempts !== 0) throw new Error('offline Qubes lifecycle attempted network access');
  if (state.activeDisposables.size !== 0) throw new Error('Qubes lifecycle leaked an active DisposableVM');
  const compartmentsVerified = [...new Set(receipts.map(item => item.targetId))].sort();
  return Object.freeze({ schemaVersion: 1, planId: plan.planId, fixtureId: plan.fixture.fixtureId,
    fixtureDigest: digestQubesFixture(plan.fixture), outcome: 'verified', offline: true, networkPolicy: 'deny',
    networkAttempts: 0, operationReceipts: Object.freeze(receipts),
    compartmentsVerified: Object.freeze(compartmentsVerified), destroyedDisposables: Object.freeze([...destroyed].sort()) });
}
