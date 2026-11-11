import { createHash } from 'node:crypto';
import { z } from 'zod';

export const QUBES_COMPARTMENT_KINDS = [
  'dom0',
  'template-vm',
  'app-vm',
  'disposable-vm',
  'whonix-gateway',
  'whonix-workstation',
] as const;

export const QUBES_FIXTURE_BOUNDARIES = [
  ...QUBES_COMPARTMENT_KINDS,
  'qrexec',
] as const;

export const QUBES_LIFECYCLE_PHASES = [
  'clean-install',
  'unchanged-reapply',
  'interruption-recovery',
  'restart',
  'rollback',
  'authority-denial',
] as const;

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const authority = z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9.:/_-]*$/);
const qrexecService = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/);
const qrexecArgument = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._+:/-]*$/).nullable();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });

const QubesCompartmentSchema = z.strictObject({
  id: identifier,
  kind: z.enum(QUBES_COMPARTMENT_KINDS),
  templateId: identifier.nullable(),
  networking: z.enum(['none', 'direct', 'through-netvm', 'whonix-only']),
  persistentRoot: z.boolean(),
  outboundAuthorities: z.array(authority).max(128),
  acceptedAuthorities: z.array(authority).max(128),
}).superRefine((compartment, context) => {
  for (const field of ['outboundAuthorities', 'acceptedAuthorities'] as const) {
    if (new Set(compartment[field]).size !== compartment[field].length) {
      context.addIssue({ code: 'custom', path: [field], message: `${field} must be unique` });
    }
  }
  if (compartment.kind === 'dom0') {
    if (compartment.networking !== 'none') context.addIssue({ code: 'custom', path: ['networking'], message: 'dom0 must be network-isolated' });
    if (compartment.templateId !== null) context.addIssue({ code: 'custom', path: ['templateId'], message: 'dom0 cannot inherit a template' });
  }
  if (compartment.kind === 'template-vm' && compartment.templateId !== null) {
    context.addIssue({ code: 'custom', path: ['templateId'], message: 'TemplateVM cannot inherit another fixture template' });
  }
  if (compartment.kind === 'disposable-vm' && compartment.persistentRoot) {
    context.addIssue({ code: 'custom', path: ['persistentRoot'], message: 'DisposableVM root must be ephemeral' });
  }
  if (compartment.kind === 'whonix-workstation' && compartment.networking !== 'whonix-only') {
    context.addIssue({ code: 'custom', path: ['networking'], message: 'Whonix Workstation must use the Whonix-only network boundary' });
  }
});

const QrexecRuleSchema = z.strictObject({
  ruleId: identifier,
  sourceId: identifier,
  targetId: identifier,
  service: qrexecService,
  argument: qrexecArgument,
  authorities: z.array(authority).min(1).max(64),
  user: z.string().min(1).max(64).regex(/^[a-z_][a-z0-9_-]*$/),
}).superRefine((rule, context) => {
  if (rule.sourceId === rule.targetId) context.addIssue({ code: 'custom', path: ['targetId'], message: 'qrexec boundary must cross compartments' });
  if (new Set(rule.authorities).size !== rule.authorities.length) {
    context.addIssue({ code: 'custom', path: ['authorities'], message: 'qrexec authorities must be unique' });
  }
});

export const QubesFixtureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  fixtureId: identifier,
  isolation: z.literal('disposable-qubes-lab'),
  platform: z.literal('qubes'),
  qubesVersion: z.string().regex(/^4\.\d+(?:\.\d+)?$/),
  compartments: z.array(QubesCompartmentSchema).min(QUBES_COMPARTMENT_KINDS.length).max(256),
  qrexecRules: z.array(QrexecRuleSchema).max(1024),
  supportedBoundaries: z.array(z.enum(QUBES_FIXTURE_BOUNDARIES)).min(1).max(QUBES_FIXTURE_BOUNDARIES.length),
}).superRefine((fixture, context) => {
  const ids = new Set<string>();
  for (const [index, compartment] of fixture.compartments.entries()) {
    if (ids.has(compartment.id)) context.addIssue({ code: 'custom', path: ['compartments', index, 'id'], message: 'compartment ids must be unique' });
    ids.add(compartment.id);
  }
  for (const kind of QUBES_COMPARTMENT_KINDS) {
    if (!fixture.compartments.some(compartment => compartment.kind === kind)) {
      context.addIssue({ code: 'custom', path: ['compartments'], message: `fixture must include ${kind}` });
    }
  }
  for (const [index, compartment] of fixture.compartments.entries()) {
    if (compartment.templateId !== null
      && !fixture.compartments.some(candidate => candidate.id === compartment.templateId && candidate.kind === 'template-vm')) {
      context.addIssue({ code: 'custom', path: ['compartments', index, 'templateId'], message: 'template identity must resolve to a fixture TemplateVM' });
    }
  }
  if (new Set(fixture.supportedBoundaries).size !== fixture.supportedBoundaries.length) {
    context.addIssue({ code: 'custom', path: ['supportedBoundaries'], message: 'supported boundaries must be unique' });
  }
  const ruleIds = new Set<string>();
  const exactRoutes = new Set<string>();
  for (const [index, rule] of fixture.qrexecRules.entries()) {
    if (ruleIds.has(rule.ruleId)) context.addIssue({ code: 'custom', path: ['qrexecRules', index, 'ruleId'], message: 'qrexec rule ids must be unique' });
    ruleIds.add(rule.ruleId);
    const source = fixture.compartments.find(compartment => compartment.id === rule.sourceId);
    const target = fixture.compartments.find(compartment => compartment.id === rule.targetId);
    if (!source) context.addIssue({ code: 'custom', path: ['qrexecRules', index, 'sourceId'], message: 'qrexec source must name a fixture compartment' });
    if (!target) context.addIssue({ code: 'custom', path: ['qrexecRules', index, 'targetId'], message: 'qrexec target must name a fixture compartment' });
    const route = `${rule.sourceId}\u0000${rule.targetId}\u0000${rule.service}\u0000${rule.argument ?? ''}`;
    if (exactRoutes.has(route)) context.addIssue({ code: 'custom', path: ['qrexecRules', index], message: 'qrexec routes must be exact and non-overlapping' });
    exactRoutes.add(route);
    for (const granted of rule.authorities) {
      if (source && !source.outboundAuthorities.includes(granted)) {
        context.addIssue({ code: 'custom', path: ['qrexecRules', index, 'authorities'], message: 'qrexec rule cannot broaden source authority' });
      }
      if (target && !target.acceptedAuthorities.includes(granted)) {
        context.addIssue({ code: 'custom', path: ['qrexecRules', index, 'authorities'], message: 'qrexec rule cannot broaden target acceptance' });
      }
    }
  }
  if (fixture.supportedBoundaries.includes('qrexec') && fixture.qrexecRules.length === 0) {
    context.addIssue({ code: 'custom', path: ['qrexecRules'], message: 'qrexec support requires at least one exact rule' });
  }
});

export const QubesFixtureEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceId: identifier,
  source: z.literal('real-qubes-lab'),
  fixtureId: identifier,
  boundary: z.enum(QUBES_FIXTURE_BOUNDARIES),
  releaseDigest: sha256,
  recipeDigest: sha256,
  fixtureDigest: sha256,
  observedAt: instant,
  expiresAt: instant,
  independentAttestor: identifier,
  phases: z.array(z.enum(QUBES_LIFECYCLE_PHASES)).length(QUBES_LIFECYCLE_PHASES.length),
  outcome: z.literal('passed'),
}).superRefine((evidence, context) => {
  if (new Set(evidence.phases).size !== QUBES_LIFECYCLE_PHASES.length
    || QUBES_LIFECYCLE_PHASES.some(phase => !evidence.phases.includes(phase))) {
    context.addIssue({ code: 'custom', path: ['phases'], message: 'evidence must cover every Qubes lifecycle phase exactly once' });
  }
  if (Date.parse(evidence.expiresAt) <= Date.parse(evidence.observedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'evidence expiry must follow observation' });
  }
});

const QrexecRequestSchema = z.strictObject({
  sourceId: identifier,
  targetId: identifier,
  service: qrexecService,
  argument: qrexecArgument,
  authority,
});

export const QubesMutationPreflightSchema = z.strictObject({
  fixture: QubesFixtureSchema,
  boundary: z.enum(QUBES_FIXTURE_BOUNDARIES),
  qrexec: QrexecRequestSchema.nullable(),
  releaseDigest: sha256,
  recipeDigest: sha256,
  evidence: z.array(QubesFixtureEvidenceSchema).max(512),
  verifiedEvidenceIds: z.array(identifier).max(512),
  now: instant,
}).superRefine((request, context) => {
  if ((request.boundary === 'qrexec') !== (request.qrexec !== null)) {
    context.addIssue({ code: 'custom', path: ['qrexec'], message: 'qrexec request is required only for the qrexec boundary' });
  }
});

export type QubesFixtureBoundary = typeof QUBES_FIXTURE_BOUNDARIES[number];
export type QubesMutationPreflightResult = Readonly<{
  decision: 'allow' | 'deny';
  boundary: QubesFixtureBoundary;
  evidenceId?: string;
  ruleId?: string;
  reason: 'verified-real-evidence' | 'unsupported-boundary' | 'no-current-verified-real-evidence'
    | 'unknown-compartment' | 'no-exact-qrexec-rule' | 'authority-not-delegated';
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function digestQubesFixture(fixture: unknown): string {
  return createHash('sha256').update(canonical(QubesFixtureSchema.parse(fixture))).digest('hex');
}

/** Pure admission only: no qrexec command or host mutation is performed. */
export function preflightQubesMutation(input: unknown): QubesMutationPreflightResult {
  const request = QubesMutationPreflightSchema.parse(input);
  if (!request.fixture.supportedBoundaries.includes(request.boundary)) {
    return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'unsupported-boundary' });
  }

  let ruleId: string | undefined;
  if (request.boundary === 'qrexec') {
    const operation = request.qrexec!;
    const source = request.fixture.compartments.find(item => item.id === operation.sourceId);
    const target = request.fixture.compartments.find(item => item.id === operation.targetId);
    if (!source || !target) return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'unknown-compartment' });
    const rule = request.fixture.qrexecRules.find(item => item.sourceId === operation.sourceId
      && item.targetId === operation.targetId && item.service === operation.service && item.argument === operation.argument);
    if (!rule) return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'no-exact-qrexec-rule' });
    if (!rule.authorities.includes(operation.authority)
      || !source.outboundAuthorities.includes(operation.authority)
      || !target.acceptedAuthorities.includes(operation.authority)) {
      return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'authority-not-delegated' });
    }
    ruleId = rule.ruleId;
  }

  const fixtureDigest = digestQubesFixture(request.fixture);
  const verified = new Set(request.verifiedEvidenceIds);
  const now = Date.parse(request.now);
  const evidence = request.evidence.find(item => item.boundary === request.boundary
    && item.fixtureId === request.fixture.fixtureId && item.fixtureDigest === fixtureDigest
    && item.releaseDigest === request.releaseDigest && item.recipeDigest === request.recipeDigest
    && verified.has(item.evidenceId) && Date.parse(item.observedAt) <= now && now < Date.parse(item.expiresAt));
  if (!evidence) return Object.freeze({ decision: 'deny', boundary: request.boundary, reason: 'no-current-verified-real-evidence' });
  return Object.freeze({ decision: 'allow', boundary: request.boundary, evidenceId: evidence.evidenceId,
    ...(ruleId ? { ruleId } : {}), reason: 'verified-real-evidence' });
}
