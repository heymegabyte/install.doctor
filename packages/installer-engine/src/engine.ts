import { z } from 'zod';
import { redactSecrets } from '@install-doctor/aid-core/redaction';
import {
  DesiredStateInputSchema,
  ExecutionPolicySchema,
  HostFactsSchema,
  InstallerEventSchema,
  NormalizedPlanSchema,
  TaskNodeSchema,
  TerminalReceiptSchema,
} from './contracts.js';
import type {
  DesiredStateInput,
  HostFacts,
  InstallerEvent,
  NormalizedPlan,
  TaskNode,
  TerminalReceipt,
} from './contracts.js';
import type { JournalClaim, JournalEntry, JournalStore } from './journal.js';
import type { ConfigurationCompensationPersistence } from './config-transaction.js';
import type { NativeDpkgTransactionPersistence } from './native-dpkg-transaction-record.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const RunRequestSchema = z.strictObject({
  runId: identifier,
  releaseId: identifier,
  desiredState: DesiredStateInputSchema,
  approvedPlanDigest: digest.nullable(),
  resume: z.boolean().default(false),
});
const StatusRequestSchema = z.strictObject({
  runId: identifier, plan: NormalizedPlanSchema, approvedPlanDigest: digest,
});
const PlanDraftSchema = z.strictObject({
  tasks: z.array(TaskNodeSchema).max(10_000),
  selectedTaskIds: z.array(identifier).max(10_000).refine(values => new Set(values).size === values.length, 'duplicate selected task identifiers'),
  executionPolicy: ExecutionPolicySchema.default({ maxConcurrency: 4, resourceLimits: { cpu: 64, memoryMiB: 1_048_576, networkConcurrency: 16 } }),
});

export const INSTALLER_PHASES = ['discover', 'validate', 'plan', 'approve', 'apply', 'verify', 'record'] as const;
export type InstallerPhase = typeof INSTALLER_PHASES[number];
export type Inspection = 'needed' | 'verified' | 'inapplicable' | 'reboot-required';
export type Verification = 'verified' | 'inapplicable' | 'pending' | 'pending-reboot';
export type TaskTerminalStatus = 'verified' | 'inapplicable' | 'pending' | 'pending-reboot' | 'blocked' | 'failed' | 'interrupted';
export type OperationFailureClass = 'permanent' | 'transient' | 'rate-limit' | 'cancelled' | 'timeout';

export class InstallerOperationError extends Error {
  readonly failureClass: OperationFailureClass;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, failureClass: OperationFailureClass, retryAfterMs?: number) {
    super(message);
    this.name = 'InstallerOperationError';
    this.failureClass = failureClass;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface TaskExecutionContext {
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly output: (stream: 'stdout' | 'stderr', line: string) => void;
  readonly configurationCompensation?: ConfigurationCompensationPersistence;
  /**
   * Present only after the durable run journal has been claimed. The capability
   * is fenced to that exact owner token, so native package code cannot persist
   * or resume a transaction through ambient run identifiers.
   */
  readonly nativeDpkgTransaction?: {
    readonly identity: {
      readonly runId: string;
      readonly hostId: string;
      readonly planDigest: string;
    };
    readonly persistence: NativeDpkgTransactionPersistence;
  };
}

export interface InstallerRunOptions {
  readonly observer?: (event: InstallerEvent) => void;
  readonly signal?: AbortSignal;
}

export interface InstallerAdapter {
  discover(): Promise<unknown>;
  plan(facts: HostFacts, desiredState: DesiredStateInput, releaseId: string): Promise<unknown>;
  check(task: TaskNode, context?: TaskExecutionContext): Promise<Inspection>;
  apply(task: TaskNode, context?: TaskExecutionContext): Promise<void>;
  verify(task: TaskNode, context?: TaskExecutionContext): Promise<Verification>;
  cleanup?(task: TaskNode, context?: TaskExecutionContext): Promise<void>;
}

export interface InstallerRunResult {
  readonly schemaVersion: 1;
  readonly phaseOrder: readonly InstallerPhase[];
  readonly plan: NormalizedPlan;
  readonly events: readonly InstallerEvent[];
  readonly taskStatuses: Readonly<Record<string, TaskTerminalStatus>>;
  readonly receipt: TerminalReceipt;
  readonly exitCode: number;
  readonly rendererFailures: number;
}

export interface InstallerEngine {
  discover(): Promise<HostFacts>;
  validate(factsInput: unknown, desiredInput: unknown): { facts: HostFacts; desiredState: DesiredStateInput };
  plan(factsInput: unknown, desiredInput: unknown, releaseId: string): Promise<NormalizedPlan>;
  run(requestInput: unknown, observerOrOptions?: ((event: InstallerEvent) => void) | InstallerRunOptions): Promise<InstallerRunResult>;
  status(requestInput: unknown, observer?: (event: InstallerEvent) => void): Promise<InstallerRunResult>;
}

type EventBody<T = InstallerEvent> = T extends InstallerEvent
  ? Omit<T, 'schemaVersion' | 'sequence' | 'at' | 'runId'>
  : never;

export interface EngineOptions {
  readonly adapter: InstallerAdapter;
  readonly now?: () => string;
  readonly maxConcurrency?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly resourceLimits?: {
    readonly cpu: number;
    readonly memoryMiB: number;
    readonly networkConcurrency: number;
  };
  readonly resourcePressureSampler?: ResourcePressureSampler;
  readonly resourcePressureSampleTimeoutMs?: number;
  readonly journal?: JournalStore;
}

export interface ResourcePressureSample {
  readonly cpuUtilization: number;
  readonly memoryUtilization: number;
  readonly ioUtilization: number;
  readonly thermalState: 'nominal' | 'fair' | 'serious' | 'critical';
  readonly powerSource: 'ac' | 'battery' | 'unknown';
  readonly batteryLevel: number | null;
  readonly meteredNetwork: boolean;
}

export interface ResourcePressureSampler {
  sample(): Promise<ResourcePressureSample>;
}

const ResourcePressureSampleSchema = z.strictObject({
  cpuUtilization: z.number().min(0).max(1),
  memoryUtilization: z.number().min(0).max(1),
  ioUtilization: z.number().min(0).max(1),
  thermalState: z.enum(['nominal', 'fair', 'serious', 'critical']),
  powerSource: z.enum(['ac', 'battery', 'unknown']),
  batteryLevel: z.number().min(0).max(1).nullable(),
  meteredNetwork: z.boolean(),
});

function adaptiveAdmission(sample: ResourcePressureSample, configuredConcurrency: number, configuredNetworkConcurrency: number) {
  let concurrency = configuredConcurrency;
  let networkConcurrency = configuredNetworkConcurrency;
  const reasons: string[] = [];
  const constrain = (limit: number, reason: string): void => {
    concurrency = Math.min(concurrency, limit);
    reasons.push(reason);
  };
  if (sample.cpuUtilization >= 0.9) constrain(1, 'cpu-critical');
  else if (sample.cpuUtilization >= 0.75) constrain(2, 'cpu-high');
  if (sample.memoryUtilization >= 0.9) constrain(1, 'memory-critical');
  else if (sample.memoryUtilization >= 0.75) constrain(2, 'memory-high');
  if (sample.ioUtilization >= 0.9) constrain(1, 'io-critical');
  else if (sample.ioUtilization >= 0.75) constrain(2, 'io-high');
  if (sample.thermalState === 'critical') constrain(1, 'thermal-critical');
  else if (sample.thermalState === 'serious') constrain(2, 'thermal-serious');
  if (sample.powerSource === 'battery' && sample.batteryLevel !== null && sample.batteryLevel <= 0.2) constrain(1, 'battery-low');
  if (sample.meteredNetwork) {
    networkConcurrency = Math.min(networkConcurrency, 1);
    reasons.push('metered-network');
  }
  return { concurrency: Math.max(1, concurrency), networkConcurrency, reasons: [...new Set(reasons)].sort() };
}

function taskMap(plan: NormalizedPlan): Map<string, TaskNode> {
  const tasks = new Map(plan.tasks.map(task => [task.id, task]));
  if (tasks.size !== plan.tasks.length) throw new Error('plan contains duplicate task identifiers');
  for (const selected of plan.selectedTaskIds) {
    if (!tasks.has(selected)) throw new Error(`selected task is missing: ${selected}`);
  }
  return tasks;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeTask(task: TaskNode): TaskNode {
  return TaskNodeSchema.parse({
    ...task,
    dependencies: sorted(task.dependencies),
    lockDomains: sorted(task.lockDomains),
  });
}

function normalizeGraph(draft: z.infer<typeof PlanDraftSchema>): { tasks: TaskNode[]; selectedTaskIds: string[] } {
  const tasks = draft.tasks.map(normalizeTask).sort((left, right) => left.id.localeCompare(right.id));
  const byId = new Map<string, TaskNode>();
  for (const task of tasks) {
    if (byId.has(task.id)) throw new Error(`duplicate task identifier: ${task.id}`);
    byId.set(task.id, task);
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency)) throw new Error(`unknown dependency for ${task.id}: ${dependency}`);
      if (task.lifecycle === 'operation' && byId.get(dependency)?.lifecycle === 'run-finalizer') {
        throw new Error(`ordinary task cannot depend on run finalizer: ${task.id}`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) throw new Error(`task dependency cycle includes: ${taskId}`);
    const task = byId.get(taskId);
    if (!task) throw new Error(`selected task is missing: ${taskId}`);
    visiting.add(taskId);
    for (const dependency of task.dependencies) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of tasks) visit(task.id);
  const selected = new Set<string>();
  const select = (taskId: string): void => {
    if (selected.has(taskId)) return;
    const task = byId.get(taskId);
    if (!task) throw new Error(`selected task is missing: ${taskId}`);
    for (const dependency of task.dependencies) select(dependency);
    selected.add(taskId);
  };
  for (const taskId of draft.selectedTaskIds) select(taskId);
  return { tasks, selectedTaskIds: sorted([...selected]) };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

async function sha256(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function deriveBoundNormalizedPlan(
  planInput: unknown,
  factsInput: unknown,
  desiredInput: unknown,
  releaseIdInput: unknown,
  createdAtInput: unknown,
): Promise<NormalizedPlan> {
  const facts = HostFactsSchema.parse(factsInput);
  const desired = DesiredStateInputSchema.parse(desiredInput);
  const releaseId = identifier.parse(releaseIdInput);
  const createdAt = z.string().datetime({ offset: true }).parse(createdAtInput);
  if (facts.hostId !== desired.hostId) throw new Error('desired state targets a different host');
  const draft = PlanDraftSchema.parse(planInput);
  const graph = normalizeGraph(draft);
  for (const task of graph.tasks) {
    const missingCapabilities = task.requiredCapabilities.filter(capability => !facts.capabilities.includes(capability));
    if (missingCapabilities.length > 0) throw new Error(`task ${task.id} requires missing capabilities: ${missingCapabilities.join(',')}`);
    if (task.consent !== 'none' && !desired.consents.includes(task.consent)) throw new Error(`task ${task.id} requires missing consent: ${task.consent}`);
    if (desired.offline && task.network === 'required') throw new Error(`task ${task.id} requires network while desired state is offline`);
  }
  const semanticFacts = {
    ...facts,
    collectedAt: undefined,
    roles: sorted(facts.roles),
    packageManagers: sorted(facts.packageManagers),
    capabilities: sorted(facts.capabilities),
  };
  const semanticDesired = {
    ...desired,
    packages: sorted(desired.packages),
    services: sorted(desired.services),
    consents: sorted(desired.consents),
  };
  const hostFactsDigest = await sha256(semanticFacts);
  const semanticPlan = {
    schemaVersion: 1 as const,
    releaseId,
    desiredRevision: desired.revision,
    desiredState: semanticDesired,
    hostFactsDigest,
    tasks: graph.tasks,
    selectedTaskIds: graph.selectedTaskIds,
    executionPolicy: draft.executionPolicy,
  };
  const digest = await sha256(semanticPlan);
  const { desiredState: _desiredState, ...persistedPlan } = semanticPlan;
  const plan = NormalizedPlanSchema.parse({ ...persistedPlan, planId: `plan-${digest.slice(0, 24)}`, digest, createdAt });
  taskMap(plan);
  return plan;
}

/** Reproduce plan authority from complete semantic inputs without executing adapter operations. */
export async function reproduceNormalizedPlan(
  planInput: unknown,
  facts: HostFacts,
  desired: DesiredStateInput,
  releaseId: string,
  createdAt: string,
): Promise<NormalizedPlan> {
  return deriveBoundNormalizedPlan(planInput, facts, desired, releaseId, createdAt);
}

function counts(statuses: Readonly<Record<string, TaskTerminalStatus>>) {
  const values = Object.values(statuses);
  return {
    verified: values.filter(value => value === 'verified').length,
    inapplicable: values.filter(value => value === 'inapplicable').length,
    skipped: 0,
    blocked: values.filter(value => value === 'blocked').length,
    pending: values.filter(value => value === 'pending' || value === 'pending-reboot' || value === 'interrupted').length,
    failed: values.filter(value => value === 'failed').length,
  };
}

function outcome(statuses: Readonly<Record<string, TaskTerminalStatus>>): { status: TerminalReceipt['status']; exitCode: number; nextAction: string | null } {
  const values = Object.values(statuses);
  if (values.some(value => value === 'failed' || value === 'blocked')) {
    return { status: 'failed', exitCode: 7, nextAction: 'Inspect the failed or blocked task evidence, correct the cause, and rerun the same plan.' };
  }
  if (values.some(value => value === 'pending-reboot')) {
    return { status: 'pending-reboot', exitCode: 5, nextAction: 'Reboot the host, then rerun the same approved desired state to verify convergence.' };
  }
  if (values.some(value => value === 'pending' || value === 'interrupted')) {
    return { status: 'pending-verification', exitCode: 6, nextAction: 'Complete or resume verification before treating this host as converged.' };
  }
  return { status: 'success', exitCode: 0, nextAction: null };
}

export function createInstallerEngine(options: EngineOptions): InstallerEngine {
  const now = options.now ?? (() => new Date().toISOString());
  const resourcePressureSampleTimeoutMs = z.number().int().min(10).max(5_000).parse(options.resourcePressureSampleTimeoutMs ?? 250);
  const configuredExecutionPolicy = ExecutionPolicySchema.parse({
    maxConcurrency: options.maxConcurrency ?? 4,
    resourceLimits: options.resourceLimits ?? { cpu: 64, memoryMiB: 1_048_576, networkConcurrency: 16 },
  });
  const bindExecutionPolicy = (planInput: unknown): unknown => {
    const draft = z.record(z.string(), z.unknown()).parse(planInput);
    if (draft.executionPolicy === undefined) return { ...draft, executionPolicy: configuredExecutionPolicy };
    const declared = ExecutionPolicySchema.parse(draft.executionPolicy);
    if ((options.maxConcurrency !== undefined || options.resourceLimits !== undefined)
      && JSON.stringify(declared) !== JSON.stringify(configuredExecutionPolicy)) {
      throw new Error('engine execution options do not match the plan-bound execution policy');
    }
    return draft;
  };
  const validateResourceFit = (plan: NormalizedPlan): NormalizedPlan => {
    const { resourceLimits } = plan.executionPolicy;
    const selectedTasks = plan.tasks.filter(candidate => plan.selectedTaskIds.includes(candidate.id));
    let projectedLifecycleEvents = 16;
    for (const task of selectedTasks) {
      if (task.resources.cpu > resourceLimits.cpu || task.resources.memoryMiB > resourceLimits.memoryMiB
        || (task.resources.network && resourceLimits.networkConcurrency === 0)) {
        throw new Error(`task ${task.id} exceeds installer resource limits`);
      }
      projectedLifecycleEvents += 3 + (task.lockDomains.length * 3) + (task.retry.maxAttempts * 2);
    }
    if (projectedLifecycleEvents > 20_000) throw new Error('selected plan exceeds the bounded lifecycle evidence budget');
    return plan;
  };
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));

  return {
    async discover() {
      return HostFactsSchema.parse(await options.adapter.discover());
    },

    validate(factsInput, desiredInput) {
      const facts = HostFactsSchema.parse(factsInput);
      const desiredState = DesiredStateInputSchema.parse(desiredInput);
      if (facts.hostId !== desiredState.hostId) throw new Error('desired state targets a different host');
      return { facts, desiredState };
    },

    async plan(factsInput, desiredInput, releaseId) {
      const { facts, desiredState } = this.validate(factsInput, desiredInput);
      const parsedReleaseId = identifier.parse(releaseId);
      const draft = bindExecutionPolicy(await options.adapter.plan(facts, desiredState, parsedReleaseId));
      return validateResourceFit(await deriveBoundNormalizedPlan(draft, facts, desiredState, parsedReleaseId, now()));
    },

    async run(requestInput, observerOrOptions) {
      const request = RunRequestSchema.parse(requestInput);
      const runOptions: InstallerRunOptions = typeof observerOrOptions === 'function'
        ? { observer: observerOrOptions }
        : (observerOrOptions ?? {});
      const observer = runOptions.observer;
      const runSignal = runOptions.signal;
      let sequence = 0;
      let rendererFailures = 0;
      let outputEventCount = 0;
      let outputBytes = 0;
      let outputTruncationEmitted = false;
      const events: InstallerEvent[] = [];
      const phaseOrder: InstallerPhase[] = [];
      const createEvent = (body: EventBody): InstallerEvent => InstallerEventSchema.parse({ schemaVersion: 1, sequence: sequence++, at: now(), runId: request.runId, ...body });
      const publish = (event: InstallerEvent): void => {
        if (event.kind === 'output') {
          const bytes = Buffer.byteLength(event.line, 'utf8');
          if (outputEventCount >= 5_000 || outputBytes + bytes > 4_194_304) {
            if (outputTruncationEmitted) { sequence -= 1; return; }
            outputTruncationEmitted = true;
            event = InstallerEventSchema.parse({
              ...event,
              line: '[output truncated: bounded local evidence budget reached]',
            });
          } else {
            outputEventCount += 1;
            outputBytes += bytes;
          }
        }
        events.push(event);
        if (observer) {
          try { observer(structuredClone(event)); } catch { rendererFailures += 1; }
        }
      };
      const emit = (body: EventBody): void => publish(createEvent(body));
      const phase = (name: InstallerPhase, status: 'started' | 'succeeded' | 'failed' | 'skipped'): void => {
        if (status === 'started') phaseOrder.push(name);
        emit({ kind: 'phase-status', phase: name, status });
      };

      const startedAt = now();
      emit({ kind: 'run-status', status: 'started' });
      phase('discover', 'started');
      const facts = await this.discover();
      phase('discover', 'succeeded');
      phase('validate', 'started');
      const validated = this.validate(facts, request.desiredState);
      phase('validate', 'succeeded');
      phase('plan', 'started');
      const plan = await this.plan(validated.facts, validated.desiredState, request.releaseId);
      const { maxConcurrency, resourceLimits } = plan.executionPolicy;
      phase('plan', 'succeeded');
      phase('approve', 'started');

      const statuses: Record<string, TaskTerminalStatus> = {};
      if (request.approvedPlanDigest !== plan.digest) {
        for (const taskId of plan.selectedTaskIds) statuses[taskId] = 'pending';
        phase('approve', 'failed');
        phase('apply', 'skipped'); phaseOrder.push('apply');
        phase('verify', 'skipped'); phaseOrder.push('verify');
        phase('record', 'started');
        const finishedAt = now();
        const receipt = TerminalReceiptSchema.parse({
          schemaVersion: 1, runId: request.runId, planDigest: plan.digest, status: 'rejected', startedAt, finishedAt,
          taskCounts: counts(statuses), evidencePaths: ['unpersisted:event-stream'],
          nextAction: `Approve the exact normalized plan digest ${plan.digest} before applying changes.`,
        });
        phase('record', 'succeeded');
        emit({ kind: 'run-status', status: 'rejected' });
        return { schemaVersion: 1, phaseOrder, plan, events, taskStatuses: statuses, receipt, exitCode: 3, rendererFailures };
      }

      phase('approve', 'succeeded');
      const journalClaim: JournalClaim | undefined = options.journal
        ? await options.journal.claim(request.runId, plan, request.resume ? 'resume' : 'run')
        : undefined;
      let journalCommitted = false;
      let journalReleased = false;
      let heartbeatStopped = false;
      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
      let heartbeatInFlight: Promise<void> = Promise.resolve();
      let heartbeatFailure: unknown;
      const leaseController = new AbortController();
      const heartbeatIntervalMs = options.journal?.heartbeatIntervalMs ?? 10_000;
      const scheduleHeartbeat = (): void => {
        if (!journalClaim || !options.journal || heartbeatStopped) return;
        heartbeatTimer = setTimeout(() => {
          heartbeatInFlight = options.journal!.renew(journalClaim.owner).then(
            () => scheduleHeartbeat(),
            error => {
              heartbeatFailure = error;
              leaseController.abort(error);
            },
          );
        }, heartbeatIntervalMs);
        heartbeatTimer.unref?.();
      };
      const stopHeartbeat = async (): Promise<void> => {
        heartbeatStopped = true;
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        await heartbeatInFlight;
        if (heartbeatFailure) throw heartbeatFailure;
      };
      scheduleHeartbeat();
      const releaseJournal = async (attempts: number, throwOnFailure: boolean): Promise<void> => {
        if (!journalClaim || !options.journal || journalReleased) return;
        let lastError: unknown;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
            await options.journal.release(journalClaim.owner);
            journalReleased = true;
            return;
          } catch (error) {
            lastError = error;
            if (attempt < attempts) await sleep(25 * attempt);
          }
        }
        if (throwOnFailure) throw lastError;
      };
      const checkpoint = async (task: TaskNode, status: JournalEntry['status'], attempts: number): Promise<void> => {
        if (!journalClaim || !options.journal) return;
        await options.journal.checkpoint(journalClaim.owner, {
          taskId: task.id, inputDigest: task.inputDigest, status, attempts, updatedAt: now(),
        });
      };
      try {
      const tasks = taskMap(plan);
      phase('apply', 'started');
      const pending = new Set(plan.selectedTaskIds);
      const running = new Map<string, Promise<void>>();
      const runningResources = new Map<string, TaskNode['resources']>();
      const taskControllers = new Map<string, AbortController>();
      const heldLocks = new Map<string, string>();
      let failurePolicyAbort = false;
      const isFinalizer = (task: TaskNode): boolean => task.lifecycle === 'run-finalizer';
      const terminalDependency = (task: TaskNode): TaskTerminalStatus | undefined => isFinalizer(task) ? undefined :
        task.dependencies.map(dependency => statuses[dependency]).find(status =>
          status === 'failed' || status === 'blocked' || status === 'pending' || status === 'pending-reboot' || status === 'interrupted');
      const dependenciesReady = (task: TaskNode): boolean => task.dependencies.every(dependency => isFinalizer(task)
        ? statuses[dependency] !== undefined
        : statuses[dependency] === 'verified' || statuses[dependency] === 'inapplicable');
      const locksAvailable = (task: TaskNode): boolean => task.lockDomains.every(domain => !heldLocks.has(domain));
      const resourcesAvailable = (task: TaskNode, networkConcurrency: number): boolean => {
        const admitted = [...runningResources.values()];
        return admitted.reduce((sum, resources) => sum + resources.cpu, 0) + task.resources.cpu <= resourceLimits.cpu
          && admitted.reduce((sum, resources) => sum + resources.memoryMiB, 0) + task.resources.memoryMiB <= resourceLimits.memoryMiB
          && admitted.filter(resources => resources.network).length + (task.resources.network ? 1 : 0) <= networkConcurrency;
      };
      const execute = async (task: TaskNode): Promise<void> => {
        const taskId = task.id;
        const finalizer = isFinalizer(task);
        const controller = new AbortController();
        taskControllers.set(taskId, controller);
        const cancelTask = (): void => controller.abort(runSignal?.reason ?? leaseController.signal.reason);
        if (!finalizer) runSignal?.addEventListener('abort', cancelTask, { once: true });
        leaseController.signal.addEventListener('abort', cancelTask, { once: true });
        if ((!finalizer && runSignal?.aborted) || leaseController.signal.aborted) cancelTask();
        for (const domain of task.lockDomains) {
          heldLocks.set(domain, taskId);
          emit({ kind: 'lock', taskId, domain, state: 'acquired' });
        }
        let finalAttempt = 0;
        try {
          for (let attempt = 1; attempt <= task.retry.maxAttempts; attempt += 1) {
            finalAttempt = attempt;
            try {
              if (controller.signal.aborted) throw new InstallerOperationError('operation cancelled', 'cancelled');
              let compensationPrepared = false;
              const configurationCompensation: ConfigurationCompensationPersistence | undefined = journalClaim && options.journal
                ? {
                    prepare: async artifact => {
                      if (artifact.record.taskId !== task.id) throw new Error('compensation task identity does not match the running task');
                      await options.journal?.persistCompensation(journalClaim.owner, artifact);
                      compensationPrepared = true;
                    },
                    update: async record => {
                      if (record.taskId !== task.id) throw new Error('compensation task identity does not match the running task');
                      await options.journal?.updateCompensation(journalClaim.owner, record);
                    },
                  }
                : undefined;
              const nativeDpkgTransaction = journalClaim && options.journal
                ? Object.freeze({
                    identity: Object.freeze({
                      runId: journalClaim.owner.runId,
                      hostId: validated.facts.hostId,
                      planDigest: journalClaim.owner.planDigest,
                    }),
                    persistence: options.journal.bindNativeDpkgTransactionPersistence(journalClaim.owner),
                  })
                : undefined;
              const context = {
                signal: controller.signal,
                attempt,
                output: (stream: 'stdout' | 'stderr', line: string) => emit({ kind: 'output', taskId, stream, line: redactSecrets(line) }),
                ...(configurationCompensation ? { configurationCompensation } : {}),
                ...(nativeDpkgTransaction ? { nativeDpkgTransaction } : {}),
              } satisfies TaskExecutionContext;
              const inspection = await options.adapter.check(task, context);
              if (!['needed', 'verified', 'inapplicable', 'reboot-required'].includes(inspection)) throw new Error('operation returned an invalid inspection state');
              if (inspection === 'reboot-required') {
                await checkpoint(task, 'pending-reboot', attempt - 1);
                statuses[taskId] = 'pending-reboot';
                emit({ kind: 'task-status', taskId, status: 'pending-reboot', attempt: attempt - 1 });
                break;
              }
              if (inspection === 'verified' || inspection === 'inapplicable') {
                await checkpoint(task, inspection, attempt - 1);
                statuses[taskId] = inspection;
                emit({ kind: 'task-status', taskId, status: inspection, attempt: attempt - 1 });
                break;
              }
              emit({ kind: 'task-status', taskId, status: 'running', attempt });
              await checkpoint(task, 'running', attempt);
              if (task.compensation === 'configuration' && !configurationCompensation) {
                throw new Error('configuration task requires durable journal-backed compensation');
              }
              await options.adapter.apply(task, context);
              if (task.compensation === 'configuration' && !compensationPrepared) {
                throw new Error('configuration task returned without durable compensation evidence');
              }
              const verification = await options.adapter.verify(task, context);
              if (!['verified', 'inapplicable', 'pending', 'pending-reboot'].includes(verification)) throw new Error('operation returned an invalid verification state');
              await checkpoint(task, verification, attempt);
              statuses[taskId] = verification;
              emit({ kind: 'task-status', taskId, status: verification, attempt });
              break;
            } catch (error) {
              const classified = error instanceof InstallerOperationError ? error : new InstallerOperationError('operation failed', 'permanent');
              const retryable = (task.retry.class === 'transient' && classified.failureClass === 'transient')
                || (task.retry.class === 'rate-limit' && (classified.failureClass === 'transient' || classified.failureClass === 'rate-limit'));
              if (classified.failureClass === 'cancelled' || controller.signal.aborted) throw new InstallerOperationError('operation cancelled', 'cancelled');
              if (!retryable || attempt >= task.retry.maxAttempts) throw classified;
              emit({ kind: 'task-status', taskId, status: 'retrying', attempt });
              const exponential = Math.min(300_000, task.retry.backoffMs * (2 ** (attempt - 1)));
              const delay = classified.failureClass === 'rate-limit'
                ? Math.min(300_000, Math.max(exponential, classified.retryAfterMs ?? 0))
                : exponential;
              await Promise.race([
                sleep(delay),
                new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new InstallerOperationError('operation cancelled', 'cancelled')), { once: true })),
              ]);
            }
          }
        } catch (error) {
          const interrupted = controller.signal.aborted || (error instanceof InstallerOperationError && error.failureClass === 'cancelled');
          statuses[taskId] = interrupted ? 'interrupted' : 'failed';
          await checkpoint(task, interrupted ? 'interrupted' : 'failed', finalAttempt || 1);
          emit({ kind: 'task-status', taskId, status: interrupted ? 'interrupted' : 'failed', attempt: finalAttempt || 1 });
          if (!finalizer && !interrupted && task.failurePolicy === 'abort-run') {
            failurePolicyAbort = true;
            for (const [runningTaskId, runningController] of taskControllers) {
              if (runningTaskId !== taskId) runningController.abort(new Error(`run aborted by failure policy on ${taskId}`));
            }
          }
        } finally {
          if (task.cleanup === 'always' && options.adapter.cleanup) {
            try {
              await options.adapter.cleanup(task, {
                signal: new AbortController().signal,
                attempt: finalAttempt || 1,
                output: (stream: 'stdout' | 'stderr', line: string) => emit({ kind: 'output', taskId, stream, line: redactSecrets(line) }),
              });
            }
            catch {
              statuses[taskId] = 'failed';
              await checkpoint(task, 'failed', finalAttempt || 1);
              emit({ kind: 'task-status', taskId, status: 'failed', attempt: finalAttempt || 1 });
            }
          }
          for (const domain of [...task.lockDomains].reverse()) {
            heldLocks.delete(domain);
            emit({ kind: 'lock', taskId, domain, state: 'released' });
          }
          if (!finalizer) runSignal?.removeEventListener('abort', cancelTask);
          leaseController.signal.removeEventListener('abort', cancelTask);
          taskControllers.delete(taskId);
        }
      };
      for (const taskId of plan.selectedTaskIds) emit({ kind: 'task-status', taskId, status: 'queued', attempt: 0 });
      let lastAdmissionAdjustment = '';
      while (pending.size > 0 || running.size > 0) {
        if (runSignal?.aborted) {
          for (const [taskId, controller] of taskControllers) {
            if (!isFinalizer(tasks.get(taskId)!)) controller.abort(runSignal.reason);
          }
          for (const taskId of sorted([...pending]).filter(id => !isFinalizer(tasks.get(id)!))) {
            pending.delete(taskId);
            statuses[taskId] = 'interrupted';
            const task = tasks.get(taskId);
            if (!task) throw new Error(`selected task is missing: ${taskId}`);
            await checkpoint(task, 'interrupted', 0);
            emit({ kind: 'task-status', taskId, status: 'interrupted', attempt: 0 });
          }
        }
        if (failurePolicyAbort) {
          for (const [taskId, controller] of taskControllers) {
            if (!isFinalizer(tasks.get(taskId)!)) controller.abort(new Error('run aborted by task failure policy'));
          }
          for (const taskId of sorted([...pending]).filter(id => !isFinalizer(tasks.get(id)!))) {
            pending.delete(taskId);
            statuses[taskId] = 'blocked';
            const task = tasks.get(taskId);
            if (!task) throw new Error(`selected task is missing: ${taskId}`);
            await checkpoint(task, 'blocked', 0);
            emit({ kind: 'task-status', taskId, status: 'blocked', attempt: 0 });
          }
        }
        for (const taskId of sorted([...pending])) {
          const task = tasks.get(taskId);
          if (!task) throw new Error(`selected task is missing: ${taskId}`);
          if (terminalDependency(task)) {
            pending.delete(taskId);
            statuses[taskId] = 'blocked';
            await checkpoint(task, 'blocked', 0);
            emit({ kind: 'task-status', taskId, status: 'blocked', attempt: 0 });
          }
        }
        let pressure: ResourcePressureSample | null = null;
        if (options.resourcePressureSampler && pending.size > 0) {
          let pressureTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            const sampled = await Promise.race([
              options.resourcePressureSampler.sample(),
              new Promise<never>((_, reject) => {
                pressureTimer = setTimeout(() => reject(new Error('resource pressure sampling timed out')), resourcePressureSampleTimeoutMs);
                pressureTimer.unref?.();
              }),
            ]);
            pressure = ResourcePressureSampleSchema.parse(sampled);
          } finally {
            if (pressureTimer) clearTimeout(pressureTimer);
          }
        }
        const admission = pressure
          ? adaptiveAdmission(pressure, maxConcurrency, resourceLimits.networkConcurrency)
          : { concurrency: maxConcurrency, networkConcurrency: resourceLimits.networkConcurrency, reasons: [] as string[] };
        const adjustment = admission.reasons.length > 0
          ? `concurrency=${admission.concurrency};network=${admission.networkConcurrency};reasons=${admission.reasons.join(',')}`
          : '';
        if (adjustment && adjustment !== lastAdmissionAdjustment && pending.size > 0) {
          const evidenceTaskId = sorted([...pending])[0];
          if (!evidenceTaskId) throw new Error('pressure adjustment has no pending evidence task');
          emit({ kind: 'output', taskId: evidenceTaskId, stream: 'stderr', line: `[admission-adjustment] ${adjustment}` });
        }
        lastAdmissionAdjustment = adjustment;
        let admitted = false;
        const ordinaryOutstanding = [...pending].some(id => !isFinalizer(tasks.get(id)!))
          || [...running.keys()].some(id => !isFinalizer(tasks.get(id)!));
        for (const taskId of sorted([...pending])) {
          if (running.size >= admission.concurrency) break;
          const task = tasks.get(taskId);
          if (!task) throw new Error(`selected task is missing: ${taskId}`);
          if (isFinalizer(task) && ordinaryOutstanding) continue;
          if (!dependenciesReady(task)) continue;
          if (!locksAvailable(task)) {
            for (const domain of task.lockDomains.filter(domain => heldLocks.has(domain))) {
              emit({ kind: 'lock', taskId, domain, state: 'waiting' });
            }
            continue;
          }
          if (!resourcesAvailable(task, admission.networkConcurrency)) continue;
          pending.delete(taskId);
          admitted = true;
          runningResources.set(taskId, task.resources);
          const promise = execute(task).finally(() => { running.delete(taskId); runningResources.delete(taskId); });
          running.set(taskId, promise);
        }
        if (running.size > 0) await Promise.race(running.values());
        else if (pending.size > 0 && !admitted) throw new Error('scheduler stalled with pending tasks');
      }
      if (heartbeatFailure) throw heartbeatFailure;
      phase('apply', Object.values(statuses).some(value => value === 'failed' || value === 'blocked' || value === 'interrupted') ? 'failed' : 'succeeded');
      phase('verify', 'started');
      phase('verify', Object.values(statuses).some(value => value === 'failed' || value === 'blocked' || value === 'pending' || value === 'pending-reboot') ? 'failed' : 'succeeded');
      phase('record', 'started');
      const terminal = runSignal?.aborted
        ? { status: 'cancelled' as const, exitCode: 130, nextAction: 'Resume the same normalized plan after confirming the interrupted operation is safe to continue.' }
        : outcome(statuses);
      const finishedAt = now();
      let receipt = TerminalReceiptSchema.parse({
        schemaVersion: 1, runId: request.runId, planDigest: plan.digest, status: terminal.status, startedAt, finishedAt,
        taskCounts: counts(statuses), evidencePaths: journalClaim ? [journalClaim.runDirectory] : ['unpersisted:event-stream'], nextAction: terminal.nextAction,
      });
      const finalizersVerified = plan.selectedTaskIds
        .filter(taskId => isFinalizer(tasks.get(taskId)!))
        .every(taskId => statuses[taskId] === 'verified' || statuses[taskId] === 'inapplicable');
      if (journalClaim && options.journal && terminal.status !== 'cancelled' && finalizersVerified) {
        const finalPhase = createEvent({ kind: 'phase-status', phase: 'record', status: 'succeeded' });
        const finalRun = createEvent({ kind: 'run-status', status: terminal.status === 'success' ? 'success' : 'failed' });
        const evidencePaths = await options.journal.finalize(journalClaim.owner, plan, receipt, [...events, finalPhase, finalRun]);
        journalCommitted = true;
        receipt = TerminalReceiptSchema.parse({ ...receipt, evidencePaths });
        // Completion is authoritative once the final commit marker exists. Lease
        // cleanup is retried before publication, but must not turn that durable
        // completion into an API failure or contradict an observer-visible result.
        await stopHeartbeat();
        await releaseJournal(3, false);
        publish(finalPhase);
        publish(finalRun);
      } else {
        if (journalClaim && options.journal) {
          // Cancelled runs and runs with an unverified finalizer remain
          // intentionally resumable. Persisted task checkpoints are exact, but
          // a terminal commit would prevent reconciliation of the cleanup effect.
          await stopHeartbeat();
          await releaseJournal(3, true);
        }
        phase('record', 'succeeded');
        emit({ kind: 'run-status', status: terminal.status === 'success' ? 'success' : terminal.status === 'cancelled' ? 'cancelled' : 'failed' });
      }
      return { schemaVersion: 1, phaseOrder, plan, events, taskStatuses: statuses, receipt, exitCode: terminal.exitCode, rendererFailures };
      } finally {
        let heartbeatError: unknown;
        try { await stopHeartbeat(); } catch (error) { heartbeatError = error; }
        if (!journalCommitted) await releaseJournal(1, true);
        if (heartbeatError) throw heartbeatError;
      }
    },

    async status(requestInput, observer) {
      const request = StatusRequestSchema.parse(requestInput);
      if (request.approvedPlanDigest !== request.plan.digest
        || request.plan.planId !== `plan-${request.plan.digest.slice(0, 24)}`) {
        throw new Error('status requires exact normalized plan approval authority');
      }
      let sequence = 0;
      let rendererFailures = 0;
      const events: InstallerEvent[] = [];
      const emit = (body: EventBody): void => {
        const event = InstallerEventSchema.parse({ schemaVersion: 1, sequence: sequence++, at: now(), runId: request.runId, ...body });
        events.push(event);
        if (observer) { try { observer(structuredClone(event)); } catch { rendererFailures += 1; } }
      };
      const startedAt = now();
      emit({ kind: 'run-status', status: 'started' });
      const tasks = taskMap(request.plan);
      const statuses: Record<string, TaskTerminalStatus> = {};
      for (const taskId of request.plan.selectedTaskIds) {
        const task = tasks.get(taskId);
        if (!task) throw new Error(`selected task is missing: ${taskId}`);
        const inspection = await options.adapter.check(task);
        statuses[taskId] = inspection === 'needed' ? 'pending' : inspection === 'reboot-required' ? 'pending-reboot' : inspection;
        emit({ kind: 'task-status', taskId, status: statuses[taskId], attempt: 0 });
      }
      const terminal = outcome(statuses);
      const receipt = TerminalReceiptSchema.parse({
        schemaVersion: 1, runId: request.runId, planDigest: request.plan.digest, status: terminal.status,
        startedAt, finishedAt: now(), taskCounts: counts(statuses), evidencePaths: ['unpersisted:event-stream'], nextAction: terminal.nextAction,
      });
      emit({ kind: 'run-status', status: terminal.status === 'success' ? 'success' : 'failed' });
      return { schemaVersion: 1, phaseOrder: [], plan: request.plan, events, taskStatuses: statuses, receipt, exitCode: terminal.exitCode, rendererFailures };
    },
  };
}
