import { z } from 'zod';
import { AgentSandboxPolicySchema, compileAgentSandboxPolicy } from './agent-sandbox-policy.js';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const exactPath = z.string().min(1).max(512).refine(value => value.startsWith('/') && !value.includes('\0') && !value.split('/').includes('..'), 'path must be absolute and normalized');
const unique = <T extends z.ZodTypeAny>(schema: T, maximum = 256) => z.array(schema).max(maximum).refine(values => new Set(values).size === values.length, 'values must be unique');
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort((left, right) => left.localeCompare(right));
const rule = (effect: 'allow' | 'deny', values: readonly string[], reason: string) => ({ effect, values: sortedUnique(values), reason });

const ToolSchema = z.strictObject({ id: identifier, contractVersion: z.number().int().positive().max(65_535), purpose: z.string().min(1).max(512) });
const SkillSchema = z.strictObject({ id: identifier, repository: z.string().regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i), commit: z.string().regex(/^[a-f0-9]{40}$/) });
const AuthoritySchema = z.strictObject({
  filesystemRead: unique(exactPath, 512), filesystemWrite: unique(exactPath, 512), commands: unique(z.string().min(1).max(512), 512),
  networkHosts: unique(z.string().min(1).max(253).regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/), 512), toolIds: unique(identifier), skillIds: unique(identifier), secretRefs: unique(identifier),
  denied: z.strictObject({
    filesystemRead: unique(exactPath), filesystemWrite: unique(exactPath), commands: unique(z.string().min(1).max(512)),
    networkHosts: unique(z.string().min(1).max(253)), toolIds: unique(identifier), skillIds: unique(identifier), secretRefs: unique(identifier),
  }),
});

const PromptSchema = z.strictObject({ system: z.string().min(1).max(16_384), objective: z.string().min(1).max(16_384), contextRefs: unique(identifier, 512) });
const ModelPolicySchema = z.strictObject({
  gateway: z.literal('projectsites'), preferredRoute: z.enum(['general', 'economy', 'code', 'architect', 'research', 'critical', 'batch', 'restricted']),
  allowedRoutes: unique(z.enum(['general', 'economy', 'code', 'architect', 'research', 'critical', 'batch', 'restricted']), 8),
  allowPremium: z.boolean(), maxModelCalls: z.number().int().positive().max(10_000),
});
const ContextSchema = z.strictObject({ refs: unique(identifier, 512), maxTokens: z.number().int().positive().max(10_000_000), maxBytes: z.number().int().positive().max(100_000_000), maxItems: z.number().int().positive().max(100_000) });
const RecordingSchema = z.strictObject({ required: z.literal(true), outputOnly: z.literal(true), encrypted: z.literal(true), encryptionKeyRef: identifier, retentionDays: z.number().int().positive().max(3_650) });
const BudgetsSchema = z.strictObject({ maxSteps: z.number().int().positive().max(10_000), maxCostMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), maxSubagents: z.number().int().nonnegative().max(64), maxWallClockSeconds: z.number().int().positive().max(604_800), maxToolCalls: z.number().int().positive().max(100_000) });

const TaskAgentDefinitionSchema = z.strictObject({
  taskId: identifier, agent: z.strictObject({ id: identifier, role: identifier }), prompt: PromptSchema,
  tools: z.array(ToolSchema).max(256), skills: z.array(SkillSchema).max(256), modelPolicy: ModelPolicySchema,
  context: ContextSchema, recording: RecordingSchema, budgets: BudgetsSchema, authority: AuthoritySchema,
}).superRefine((task, context) => {
  const exact = (actual: readonly string[], expected: readonly string[], path: (string | number)[], label: string) => {
    if (JSON.stringify(sortedUnique(actual)) !== JSON.stringify(sortedUnique(expected))) context.addIssue({ code: 'custom', path, message: `${label} authority must exactly match the declared task inputs` });
  };
  exact(task.authority.toolIds, task.tools.map(tool => tool.id), ['authority', 'toolIds'], 'tool');
  exact(task.authority.skillIds, task.skills.map(skill => skill.id), ['authority', 'skillIds'], 'skill');
  exact(task.prompt.contextRefs, task.context.refs, ['prompt', 'contextRefs'], 'context');
  if (!task.modelPolicy.allowedRoutes.includes(task.modelPolicy.preferredRoute)) context.addIssue({ code: 'custom', path: ['modelPolicy', 'preferredRoute'], message: 'preferred route must be explicitly allowed' });
  if (!task.authority.secretRefs.includes(task.recording.encryptionKeyRef)) context.addIssue({ code: 'custom', path: ['recording', 'encryptionKeyRef'], message: 'recording key must be an exact task secret reference' });
  if (new Set(task.tools.map(tool => tool.id)).size !== task.tools.length) context.addIssue({ code: 'custom', path: ['tools'], message: 'tool identifiers must be unique' });
  if (new Set(task.skills.map(skill => skill.id)).size !== task.skills.length) context.addIssue({ code: 'custom', path: ['skills'], message: 'skill identifiers must be unique' });
});

export const ApprovedTaskAgentPlanSchema = z.strictObject({ schemaVersion: z.literal(1), planId: identifier, planDigest: digest, tasks: z.array(TaskAgentDefinitionSchema).min(1).max(1_024) }).superRefine((plan, context) => {
  if (new Set(plan.tasks.map(task => task.taskId)).size !== plan.tasks.length) context.addIssue({ code: 'custom', path: ['tasks'], message: 'task identifiers must be unique' });
  if (new Set(plan.tasks.map(task => task.agent.id)).size !== plan.tasks.length) context.addIssue({ code: 'custom', path: ['tasks'], message: 'agent identifiers must be task specific' });
});

export const CompiledTaskAgentSchema = z.strictObject({
  schemaVersion: z.literal(1), planId: identifier, planDigest: digest, taskId: identifier, agent: z.strictObject({ id: identifier, role: identifier }),
  prompt: PromptSchema, tools: z.array(ToolSchema), skills: z.array(SkillSchema), modelPolicy: ModelPolicySchema, context: ContextSchema,
  recording: RecordingSchema, budgets: BudgetsSchema, sandboxPolicy: AgentSandboxPolicySchema,
  inheritance: z.strictObject({ environment: z.literal('none'), credentials: z.literal('none'), tools: z.literal('none'), skills: z.literal('none'), context: z.literal('none') }),
});

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
async function sha256(value: unknown): Promise<string> {
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value)))));
  return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Digest the exact approved semantic input; the digest field itself is never self-referential. */
export async function approvedTaskAgentPlanDigest(input: Omit<z.input<typeof ApprovedTaskAgentPlanSchema>, 'planDigest'>): Promise<string> { return sha256(input); }

/** Compile exclusively from approved bytes. Ambient session authority is neither read nor merged. */
export async function compileTaskAgents(input: unknown): Promise<readonly z.infer<typeof CompiledTaskAgentSchema>[]> {
  const plan = ApprovedTaskAgentPlanSchema.parse(input); const { planDigest: _claimed, ...unsigned } = plan;
  if (await approvedTaskAgentPlanDigest(unsigned) !== plan.planDigest) throw new Error('task-agent plan digest does not match the approved plan');
  return Object.freeze([...plan.tasks].sort((left, right) => left.taskId.localeCompare(right.taskId)).map(task => {
    const allow = (values: readonly string[], reason: string) => values.length ? [rule('allow', values, reason)] : [];
    const deny = (values: readonly string[], reason: string) => values.length ? [rule('deny', values, reason)] : [];
    const sandboxPolicy = compileAgentSandboxPolicy({ schemaVersion: 1, policyId: `${plan.planId}:${task.taskId}`, taskId: task.taskId, autoMode: false,
      maxSteps: task.budgets.maxSteps, maxCostMicros: task.budgets.maxCostMicros, maxSubagents: task.budgets.maxSubagents,
      filesystem: { read: [...allow(task.authority.filesystemRead, 'approved task read'), ...deny(task.authority.denied.filesystemRead, 'approved task read denial')], write: [...allow(task.authority.filesystemWrite, 'approved task write'), ...deny(task.authority.denied.filesystemWrite, 'approved task write denial')] },
      commands: [...allow(task.authority.commands, 'approved task command'), ...deny(task.authority.denied.commands, 'approved task command denial')],
      network: [...allow(task.authority.networkHosts, 'approved task network'), ...deny(task.authority.denied.networkHosts, 'approved task network denial')],
      tools: [...allow(task.authority.toolIds, 'approved task tool'), ...deny(task.authority.denied.toolIds, 'approved task tool denial')],
      skills: [...allow(task.authority.skillIds, 'approved task skill'), ...deny(task.authority.denied.skillIds, 'approved task skill denial')],
      secrets: [...allow(task.authority.secretRefs, 'approved task secret'), ...deny(task.authority.denied.secretRefs, 'approved task secret denial')] });
    return CompiledTaskAgentSchema.parse({ schemaVersion: 1, planId: plan.planId, planDigest: plan.planDigest, taskId: task.taskId, agent: task.agent,
      prompt: { ...task.prompt, contextRefs: sortedUnique(task.prompt.contextRefs) }, tools: [...task.tools].sort((a, b) => a.id.localeCompare(b.id)), skills: [...task.skills].sort((a, b) => a.id.localeCompare(b.id)),
      modelPolicy: { ...task.modelPolicy, allowedRoutes: sortedUnique(task.modelPolicy.allowedRoutes) }, context: { ...task.context, refs: sortedUnique(task.context.refs) },
      recording: task.recording, budgets: task.budgets, sandboxPolicy, inheritance: { environment: 'none', credentials: 'none', tools: 'none', skills: 'none', context: 'none' } });
  }));
}
