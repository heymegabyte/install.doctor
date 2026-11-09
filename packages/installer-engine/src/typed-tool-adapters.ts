import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildDeprovisionPlan, DeprovisionPolicySchema, DeprovisionResourceSchema } from './deprovision-plan.js';

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const noArguments = z.strictObject({ schemaVersion: z.literal(1) });
const planReference = z.strictObject({ schemaVersion: z.literal(1), planDigest: digest });
const grantReference = z.strictObject({ schemaVersion: z.literal(1), approvalId: identifier });
const runReference = z.strictObject({ schemaVersion: z.literal(1), runId: identifier, planDigest: digest });
const rollbackPlan = z.strictObject({
  schemaVersion: z.literal(1), action: z.literal('plan'), sourceRunId: identifier, sourcePlanDigest: digest,
});
const rollbackApprove = z.strictObject({
  schemaVersion: z.literal(1), action: z.literal('approve'), sourceRunId: identifier,
  sourcePlanDigest: digest, rollbackPlanDigest: digest,
});
const rollbackExecute = z.strictObject({
  schemaVersion: z.literal(1), action: z.enum(['execute', 'resume']), approvalId: identifier,
});
const rollbackStatus = z.strictObject({
  schemaVersion: z.literal(1), action: z.literal('status'), rollbackRunId: identifier, planDigest: digest,
});
const rollbackRequest = z.discriminatedUnion('action', [rollbackPlan, rollbackApprove, rollbackExecute, rollbackStatus]);
const deprovisionPreview = z.strictObject({
  schemaVersion: z.literal(1), sourceRunId: identifier, sourcePlanDigest: digest,
  policy: DeprovisionPolicySchema.optional(), resources: z.array(DeprovisionResourceSchema).max(10_000),
});

export const DESKTOP_TOOLS_TYPED_TOOL_NAMES = Object.freeze([
  'desktop_tools_discover', 'desktop_tools_validate', 'desktop_tools_plan', 'desktop_tools_approve',
  'desktop_tools_apply', 'desktop_tools_verify', 'desktop_tools_status', 'desktop_tools_resume',
  'desktop_tools_rollback_config', 'desktop_tools_deprovision_preview',
] as const);

export type DesktopToolsTypedToolName = typeof DESKTOP_TOOLS_TYPED_TOOL_NAMES[number];

export type EngineInvoker = (invocation: Readonly<Record<string, unknown>>) => Promise<unknown>;
export type ConsentBroker = (request: Readonly<{
  operation: 'apply' | 'rollback-config';
  planDigest: string;
  runId: string;
  sourceRunId?: string;
}>) => Promise<Readonly<{ approved: boolean; actorId: string; approvedAt: string }>>;

export interface DesktopToolsToolAdapterOptions {
  /** Immutable invocation body assembled from the signed profile and engine plan, never model input. */
  readonly operation: Readonly<Record<string, unknown>>;
  readonly runId: string;
  readonly releaseId: string;
  readonly stateRoot: string;
  readonly renderer?: 'plain' | 'json' | 'ndjson' | 'headless' | 'tui';
  readonly invokeEngine: EngineInvoker;
  readonly requestConsent: ConsentBroker;
  readonly createId?: () => string;
  readonly now?: () => string;
}

type ApprovalGrant = Readonly<{
  operation: 'apply' | 'rollback-config'; planDigest: string; runId: string;
  sourceRunId?: string; sourcePlanDigest?: string; used: boolean;
}>;

function objectResult(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} returned a non-object result`);
  return value as Readonly<Record<string, unknown>>;
}

/**
 * Produces the only model-facing provisioning capabilities. The fixed operation
 * closure is injected by the trusted supervisor. Model input can select no
 * executable, argv, task, path, state root, renderer, plan body, or journal.
 */
export function createDesktopToolsToolAdapters(options: DesktopToolsToolAdapterOptions): Readonly<
  Record<DesktopToolsTypedToolName, (input: unknown) => Promise<unknown>>
> {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());
  const renderer = options.renderer ?? 'headless';
  const plans = new Map<string, Readonly<Record<string, unknown>>>();
  const rollbackPlans = new Map<string, Readonly<{ sourceRunId: string; sourcePlanDigest: string }>>();
  const grants = new Map<string, ApprovalGrant>();
  const common = Object.freeze({
    ...options.operation, schemaVersion: 1, runId: options.runId, releaseId: options.releaseId,
  });
  const invoke = (command: string, additions: Readonly<Record<string, unknown>> = {}) =>
    options.invokeEngine(Object.freeze({ ...common, ...additions, command }));

  const tools: Record<DesktopToolsTypedToolName, (input: unknown) => Promise<unknown>> = {
    async desktop_tools_discover(input) {
      noArguments.parse(input);
      return invoke('discover');
    },
    async desktop_tools_validate(input) {
      noArguments.parse(input);
      return invoke('validate');
    },
    async desktop_tools_plan(input) {
      noArguments.parse(input);
      const result = objectResult(await invoke('plan'), 'plan');
      const planDigest = digest.parse(result.digest);
      plans.set(planDigest, result);
      return result;
    },
    async desktop_tools_approve(input) {
      const request = planReference.parse(input);
      if (!plans.has(request.planDigest)) throw new Error('approval requires a plan produced by this adapter session');
      const consent = await options.requestConsent({ operation: 'apply', planDigest: request.planDigest, runId: options.runId });
      if (!consent.approved) throw new Error('operator denied the plan');
      identifier.parse(consent.actorId);
      z.string().datetime({ offset: true }).parse(consent.approvedAt);
      const approvalId = identifier.parse(`approval-${createId()}`);
      grants.set(approvalId, Object.freeze({ operation: 'apply', planDigest: request.planDigest, runId: options.runId, used: false }));
      return Object.freeze({ schemaVersion: 1, approvalId, planDigest: request.planDigest, actorId: consent.actorId, approvedAt: consent.approvedAt });
    },
    async desktop_tools_apply(input) {
      const { approvalId } = grantReference.parse(input);
      const grant = grants.get(approvalId);
      if (!grant || grant.operation !== 'apply' || grant.used) throw new Error('apply requires an unused adapter-issued approval');
      grants.set(approvalId, Object.freeze({ ...grant, used: true }));
      return invoke('run', { approvedPlanDigest: grant.planDigest, renderer, stateRoot: options.stateRoot });
    },
    async desktop_tools_verify(input) {
      const request = runReference.parse(input);
      if (request.runId !== options.runId || !plans.has(request.planDigest)) throw new Error('verification is outside this adapter session');
      return options.invokeEngine(Object.freeze({ schemaVersion: 1, command: 'evidence-verify', runId: request.runId,
        planDigest: request.planDigest, stateRoot: options.stateRoot }));
    },
    async desktop_tools_status(input) {
      const request = runReference.parse(input);
      const plan = plans.get(request.planDigest);
      if (request.runId !== options.runId || !plan) throw new Error('status is outside this adapter session');
      return options.invokeEngine(Object.freeze({ schemaVersion: 1, command: 'status', runId: request.runId,
        renderer, plan, approvedPlanDigest: request.planDigest, operations: options.operation.operations }));
    },
    async desktop_tools_resume(input) {
      const { approvalId } = grantReference.parse(input);
      const grant = grants.get(approvalId);
      if (!grant || grant.operation !== 'apply' || !grant.used) {
        throw new Error('resume requires an adapter-issued approval whose execution has started');
      }
      return invoke('resume', { planDigest: grant.planDigest, renderer, stateRoot: options.stateRoot });
    },
    async desktop_tools_rollback_config(input) {
      const request = rollbackRequest.parse(input);
      if (request.action === 'plan') {
        const result = objectResult(await options.invokeEngine(Object.freeze({ schemaVersion: 1, command: 'rollback-config-plan',
          stateRoot: options.stateRoot, sourceRunId: request.sourceRunId, sourcePlanDigest: request.sourcePlanDigest })), 'rollback plan');
        const rollbackPlanDigest = digest.parse(result.digest);
        rollbackPlans.set(rollbackPlanDigest, Object.freeze({ sourceRunId: request.sourceRunId, sourcePlanDigest: request.sourcePlanDigest }));
        return result;
      }
      if (request.action === 'approve') {
        const source = rollbackPlans.get(request.rollbackPlanDigest);
        if (!source || source.sourceRunId !== request.sourceRunId || source.sourcePlanDigest !== request.sourcePlanDigest) {
          throw new Error('rollback approval requires the exact plan produced by this adapter session');
        }
        const rollbackRunId = identifier.parse(`rollback-${createId()}`);
        const consent = await options.requestConsent({ operation: 'rollback-config', planDigest: request.rollbackPlanDigest,
          runId: rollbackRunId, sourceRunId: request.sourceRunId });
        if (!consent.approved) throw new Error('operator denied configuration rollback');
        const approvalId = identifier.parse(`approval-${createId()}`);
        grants.set(approvalId, Object.freeze({ operation: 'rollback-config', planDigest: request.rollbackPlanDigest,
          runId: rollbackRunId, sourceRunId: request.sourceRunId,
          sourcePlanDigest: request.sourcePlanDigest, used: false }));
        return Object.freeze({ schemaVersion: 1, approvalId, rollbackRunId, planDigest: request.rollbackPlanDigest,
          actorId: identifier.parse(consent.actorId), approvedAt: z.string().datetime({ offset: true }).parse(consent.approvedAt) });
      }
      if (request.action === 'status') {
        return options.invokeEngine(Object.freeze({ schemaVersion: 1, command: 'rollback-config-status',
          rollbackRunId: request.rollbackRunId, planDigest: request.planDigest, stateRoot: options.stateRoot }));
      }
      const grant = grants.get(request.approvalId);
      if (!grant || grant.operation !== 'rollback-config' || !grant.sourceRunId || !grant.sourcePlanDigest
        || (request.action === 'execute' ? grant.used : !grant.used)) {
        throw new Error(`${request.action} requires an adapter-issued rollback approval in the correct execution state`);
      }
      if (request.action === 'execute') grants.set(request.approvalId, Object.freeze({ ...grant, used: true }));
      return options.invokeEngine(Object.freeze({ schemaVersion: 1,
        command: request.action === 'execute' ? 'rollback-config-execute' : 'rollback-config-resume',
        stateRoot: options.stateRoot, sourceRunId: grant.sourceRunId,
        sourcePlanDigest: grant.sourcePlanDigest, rollbackRunId: grant.runId, approvedPlanDigest: grant.planDigest }));
    },
    async desktop_tools_deprovision_preview(input) {
      const request = deprovisionPreview.parse(input);
      return buildDeprovisionPlan(request, now);
    },
  };
  return Object.freeze(tools);
}
