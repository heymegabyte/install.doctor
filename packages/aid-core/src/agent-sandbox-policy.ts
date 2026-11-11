import { z } from 'zod';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);
const exactPath = z.string().min(1).max(512).refine(value => value.startsWith('/') && !value.includes('\0') && !value.split('/').includes('..'), 'path must be absolute and normalized');
const unique = <T extends z.ZodTypeAny>(schema: T, max = 256) => z.array(schema).max(max).refine(values => new Set(values).size === values.length, 'values must be unique');
const RuleSchema = z.strictObject({ effect: z.enum(['allow', 'deny']), values: unique(z.string().min(1).max(512), 512), reason: z.string().min(1).max(512) });

export const AgentSandboxPolicySchema = z.strictObject({
  schemaVersion: z.literal(1), policyId: identifier, taskId: identifier, autoMode: z.boolean(),
  maxSteps: z.number().int().min(1).max(10_000), maxCostMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maxSubagents: z.number().int().nonnegative().max(64),
  filesystem: z.strictObject({ read: z.array(RuleSchema).max(64), write: z.array(RuleSchema).max(64) }),
  commands: z.array(RuleSchema).max(64), network: z.array(RuleSchema).max(64), tools: z.array(RuleSchema).max(64),
  skills: z.array(RuleSchema).max(64), secrets: z.array(RuleSchema).max(64),
});

export const AgentSandboxRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('filesystem-read'), value: exactPath }), z.strictObject({ kind: z.literal('filesystem-write'), value: exactPath }),
  z.strictObject({ kind: z.literal('command'), value: z.string().min(1).max(512) }), z.strictObject({ kind: z.literal('network'), value: z.string().min(1).max(253).regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/) }),
  z.strictObject({ kind: z.literal('tool'), value: identifier }), z.strictObject({ kind: z.literal('skill'), value: identifier }),
  z.strictObject({ kind: z.literal('secret'), value: identifier }), z.strictObject({ kind: z.literal('step'), value: z.number().int().positive() }),
  z.strictObject({ kind: z.literal('cost'), value: z.number().int().nonnegative() }), z.strictObject({ kind: z.literal('subagent'), value: z.number().int().nonnegative() }),
]);

type Policy = z.infer<typeof AgentSandboxPolicySchema>;
type Request = z.infer<typeof AgentSandboxRequestSchema>;
const matches = (pattern: string, value: string): boolean => pattern === '*' || pattern.endsWith('/**') && (value === pattern.slice(0, -3) || value.startsWith(pattern.slice(0, -2))) || pattern === value;

/** Compile one approved task policy into deterministic OpenCode enforcement input. */
export function compileAgentSandboxPolicy(input: unknown): Policy {
  const policy = AgentSandboxPolicySchema.parse(input);
  const sortRules = (rules: Policy['commands']): Policy['commands'] => rules.map(rule => ({ ...rule, values: [...rule.values].sort() }))
    .sort((left, right) => `${left.effect}:${left.reason}`.localeCompare(`${right.effect}:${right.reason}`));
  return AgentSandboxPolicySchema.parse({ ...policy,
    filesystem: { read: sortRules(policy.filesystem.read), write: sortRules(policy.filesystem.write) },
    commands: sortRules(policy.commands), network: sortRules(policy.network), tools: sortRules(policy.tools),
    skills: sortRules(policy.skills), secrets: sortRules(policy.secrets),
  });
}
function rulesFor(policy: Policy, kind: Request['kind']): z.infer<typeof RuleSchema>[] {
  if (kind === 'filesystem-read') return policy.filesystem.read; if (kind === 'filesystem-write') return policy.filesystem.write;
  if (kind === 'command') return policy.commands; if (kind === 'network') return policy.network; if (kind === 'tool') return policy.tools;
  if (kind === 'skill') return policy.skills; if (kind === 'secret') return policy.secrets; return [];
}

export function evaluateAgentSandbox(policyInput: unknown, requestInput: unknown) {
  const policy = compileAgentSandboxPolicy(policyInput); const request = AgentSandboxRequestSchema.parse(requestInput);
  if (request.kind === 'step') return Object.freeze({ decision: request.value <= policy.maxSteps ? 'allow' as const : 'deny' as const, reason: 'step-budget' as const });
  if (request.kind === 'cost') return Object.freeze({ decision: request.value <= policy.maxCostMicros ? 'allow' as const : 'deny' as const, reason: 'cost-budget' as const });
  if (request.kind === 'subagent') return Object.freeze({ decision: request.value <= policy.maxSubagents ? 'allow' as const : 'deny' as const, reason: 'subagent-budget' as const });
  const matching = rulesFor(policy, request.kind).filter(rule => rule.values.some(pattern => matches(pattern, request.value)));
  const denied = matching.filter(rule => rule.effect === 'deny');
  if (denied.length) return Object.freeze({ decision: 'deny' as const, reason: 'explicit-deny' as const, contributingRules: denied.map(rule => rule.reason).sort() });
  const allowed = matching.filter(rule => rule.effect === 'allow');
  if (allowed.length) return Object.freeze({ decision: 'allow' as const, reason: 'explicit-allow' as const, contributingRules: allowed.map(rule => rule.reason).sort() });
  return Object.freeze({ decision: 'deny' as const, reason: 'default-deny' as const, contributingRules: [] });
}
