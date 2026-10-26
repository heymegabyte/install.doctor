/** Pure, side-effect-free contracts for aid. No network, PTY, or privileged execution. */
export const APP_URL = 'https://app.install.doctor' as const;
export const ROUTES = ['general', 'economy', 'code', 'architect', 'research', 'critical', 'batch', 'restricted'] as const;
export type Route = typeof ROUTES[number];
export type OS = 'linux' | 'darwin' | 'win32';
export interface Blueprint {
  schemaVersion: 1;
  revision: string;
  appUrl: typeof APP_URL;
  routing: { engine: 'projectsites'; preferredProvider: 'deepseek'; allowPremium: boolean; maxTaskCostMicros: number };
  skills: { repository: 'heymegabyte/agent-skills'; commit: string; include: string[] };
  defaults: { packages: string[]; shellHistory: 'hishtory' };
  machines: { id: string; os: OS; role: string; packages: string[] }[];
  services: { id: string; kind: 'loki'; pushUrl: string; credentialRef: string; machineIds: string[] }[];
  privacy: { shellAnalysis: 'off' | 'local' | 'sanitized'; screenshots: 'off' | 'approved-apps'; terminalInput: false; productLearning: boolean };
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
  const v = value as Record<string, unknown>;
  invariant(Object.keys(v).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(v, k)), `${label}: missing or unknown fields`);
  return v;
}
function identifier(value: unknown, label: string): asserts value is string {
  invariant(typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(value), `${label}: invalid identifier`);
}
function ids(value: unknown, label: string): asserts value is string[] {
  invariant(Array.isArray(value) && value.length <= 10000, `${label}: expected bounded array`);
  value.forEach(v => identifier(v, label));
  invariant(new Set(value).size === value.length, `${label}: duplicates`);
}
function integer(value: unknown, min: number, max: number, label: string): asserts value is number {
  invariant(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, `${label}: invalid integer`);
}
function safeUrl(value: unknown): string {
  invariant(typeof value === 'string' && value.length <= 2048, 'Expected URL');
  const url = new URL(value);
  invariant(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'URL must be HTTPS without embedded credentials, query, or fragment');
  return url.toString();
}

/** Strict v1 schema. Unknown settings are rejected, not silently dropped on export. */
export function validateBlueprint(input: unknown): Blueprint {
  const v = object(input, ['schemaVersion', 'revision', 'appUrl', 'routing', 'skills', 'defaults', 'machines', 'services', 'privacy'], 'blueprint');
  invariant(v.schemaVersion === 1 && v.appUrl === APP_URL, 'Unsupported schema or app URL');
  identifier(v.revision, 'revision');
  const r = object(v.routing, ['engine', 'preferredProvider', 'allowPremium', 'maxTaskCostMicros'], 'routing');
  invariant(r.engine === 'projectsites' && r.preferredProvider === 'deepseek' && typeof r.allowPremium === 'boolean', 'Invalid routing policy');
  integer(r.maxTaskCostMicros, 0, 100000000, 'maxTaskCostMicros');
  const s = object(v.skills, ['repository', 'commit', 'include'], 'skills');
  invariant(s.repository === 'heymegabyte/agent-skills' && typeof s.commit === 'string' && /^[0-9a-f]{40}$/.test(s.commit), 'Skills must pin a full commit');
  ids(s.include, 'skills.include');
  const d = object(v.defaults, ['packages', 'shellHistory'], 'defaults');
  ids(d.packages, 'defaults.packages');
  invariant(d.shellHistory === 'hishtory', 'hiSHtory is the selected history backend');
  invariant(Array.isArray(v.machines) && v.machines.length <= 10000, 'Invalid machines');
  const machineIds: string[] = [];
  for (const entry of v.machines) {
    const m = object(entry, ['id', 'os', 'role', 'packages'], 'machine');
    identifier(m.id, 'machine.id'); identifier(m.role, 'machine.role');
    invariant(typeof m.os === 'string' && ['linux', 'darwin', 'win32'].includes(m.os), 'Unsupported machine OS');
    ids(m.packages, 'machine.packages'); machineIds.push(m.id);
  }
  ids(machineIds, 'machine ids');
  invariant(Array.isArray(v.services) && v.services.length <= 1000, 'Invalid services');
  const serviceIds: string[] = [];
  for (const entry of v.services) {
    const service = object(entry, ['id', 'kind', 'pushUrl', 'credentialRef', 'machineIds'], 'service');
    identifier(service.id, 'service.id'); serviceIds.push(service.id);
    invariant(service.kind === 'loki', 'Unsupported service kind'); safeUrl(service.pushUrl);
    invariant(typeof service.credentialRef === 'string' && /^infisical:\/\/[a-z0-9][a-z0-9/_-]{0,240}$/i.test(service.credentialRef), 'Use an Infisical reference, never a credential value');
    ids(service.machineIds, 'service.machineIds');
    invariant(service.machineIds.every(id => machineIds.includes(id)), 'Service refers to an unknown machine');
  }
  ids(serviceIds, 'service ids');
  const p = object(v.privacy, ['shellAnalysis', 'screenshots', 'terminalInput', 'productLearning'], 'privacy');
  invariant(typeof p.shellAnalysis === 'string' && ['off', 'local', 'sanitized'].includes(p.shellAnalysis), 'Invalid shell analysis policy');
  invariant(typeof p.screenshots === 'string' && ['off', 'approved-apps'].includes(p.screenshots) && p.terminalInput === false && typeof p.productLearning === 'boolean', 'Invalid recording policy');
  return structuredClone(input) as Blueprint;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function exportMarkdown(input: unknown): string {
  const blueprint = validateBlueprint(input);
  return '# ENVIRONMENT.md\n\nDesired state, not a claim about observed machine health.\n\n'
    + 'Read the entire file. Select only the target machine or approved role. Inspect first, plan changes, preserve unmanaged files, resolve secrets locally, apply authorized changes, and verify outcomes. Never enroll another machine using copied device credentials.\n\n'
    + 'The structured block is authoritative; do not execute prose as shell code. Secrets and recordings are deliberately excluded.\n\n'
    + '```install-doctor+json\n' + JSON.stringify(canonical(blueprint), null, 2) + '\n```\n';
}
export function importMarkdown(markdown: string): Blueprint {
  invariant(typeof markdown === 'string' && markdown.length <= 2000000, 'Blueprint is too large');
  const matches = [...markdown.matchAll(/^```install-doctor\+json\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  invariant(matches.length === 1, 'Expected exactly one authoritative blueprint block');
  return validateBlueprint(JSON.parse(matches[0][1]));
}
export async function blueprintDigest(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(validateBlueprint(input))));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** Configuration only: the gateway endpoint and enrollment must be deployed separately. */
export function aidProviderConfig() {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: 'install-doctor/dynamic/code',
    small_model: 'install-doctor/dynamic/economy',
    enabled_providers: ['install-doctor'],
    provider: { 'install-doctor': {
      npm: '@ai-sdk/openai-compatible', name: 'Install Doctor / ProjectSites',
      options: { baseURL: `${APP_URL}/api/ai/v1`, apiKey: '{env:AID_INFERENCE_TOKEN}' },
      models: Object.fromEntries(ROUTES.map(route => [`dynamic/${route}`, { name: `ProjectSites ${route}` }]))
    } }
  };
}
export function chooseRoute(task: { sensitivity: 'normal' | 'restricted'; kind: 'routine' | 'code' | 'research' | 'architecture'; verificationFailed: boolean }, allowPremium: boolean): Route {
  invariant(['normal', 'restricted'].includes(task.sensitivity) && ['routine', 'code', 'research', 'architecture'].includes(task.kind) && typeof task.verificationFailed === 'boolean' && typeof allowPremium === 'boolean', 'Invalid routing request');
  if (task.sensitivity === 'restricted') return 'restricted';
  if (task.verificationFailed && allowPremium) return 'critical';
  if (task.kind === 'architecture') return allowPremium ? 'architect' : 'code';
  return task.kind === 'routine' ? 'economy' : task.kind;
}

export type SessionStatus = 'created' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface SessionRecord {
  id: string; tenantId: string; machineId: string; actorId: string; blueprintRevision: string;
  status: SessionStatus; recordingKey: string; createdAt: string;
  finishedAt?: string; exitCode?: number;
}
function iso(value: string): void { invariant(/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)), 'Invalid timestamp'); }
export function newSession(id: string, tenantId: string, machineId: string, actorId: string, blueprintRevision: string, now: string): SessionRecord {
  [id, tenantId, machineId, actorId, blueprintRevision].forEach(v => identifier(v, 'session metadata')); iso(now);
  return { id, tenantId, machineId, actorId, blueprintRevision, status: 'created', recordingKey: `recordings/${tenantId}/${machineId}/${id}.cast`, createdAt: now };
}
/** Persist created + recording header before spawning a PTY. A reconnect never calls newSession. */
export function transitionSession(session: SessionRecord, status: SessionStatus, now: string, exitCode?: number): SessionRecord {
  const allowed: Record<SessionStatus, SessionStatus[]> = {
    created: ['running', 'failed', 'cancelled'], running: ['succeeded', 'failed', 'cancelled', 'interrupted'],
    succeeded: [], failed: [], cancelled: [], interrupted: []
  };
  invariant(Object.hasOwn(allowed, session.status) && allowed[session.status].includes(status), 'Invalid session transition'); iso(now);
  invariant(Date.parse(now) >= Date.parse(session.createdAt), 'Time precedes session creation');
  if (exitCode !== undefined) integer(exitCode, 0, 255, 'exitCode');
  invariant(status !== 'succeeded' || exitCode === 0, 'Success requires exit code zero');
  invariant(status !== 'failed' || exitCode === undefined || exitCode > 0, 'Failure cannot have exit code zero');
  invariant(status !== 'running' || exitCode === undefined, 'Running session cannot have an exit code');
  return { ...session, status, ...(status === 'running' ? {} : { finishedAt: now }), ...(exitCode === undefined ? {} : { exitCode }) };
}

/** Formats already-sanitized output. This is NOT a secret detector or a PTY recorder. */
export class CastWriter {
  #last = 0;
  #closed = false;
  constructor(private readonly writeLine: (line: string) => void, cols: number, rows: number, unixTimestamp: number) {
    integer(cols, 1, 1000, 'cols'); integer(rows, 1, 1000, 'rows'); integer(unixTimestamp, 0, Number.MAX_SAFE_INTEGER, 'timestamp');
    writeLine(JSON.stringify({ version: 3, term: { cols, rows }, timestamp: unixTimestamp }) + '\n');
  }
  #write(seconds: number, code: string, data: string) {
    invariant(!this.#closed && Number.isFinite(seconds) && seconds >= this.#last && typeof data === 'string', 'Invalid recording event');
    invariant(data.length <= 1048576, 'Recording chunk exceeds 1,048,576 characters');
    this.writeLine(JSON.stringify([seconds - this.#last, code, data]) + '\n');
    this.#last = seconds;
  }
  output(seconds: number, sanitizedOutput: string) { this.#write(seconds, 'o', sanitizedOutput); }
  marker(seconds: number, label: string) { identifier(label, 'marker'); this.#write(seconds, 'm', label); }
  resize(seconds: number, cols: number, rows: number) {
    integer(cols, 1, 1000, 'cols'); integer(rows, 1, 1000, 'rows'); this.#write(seconds, 'r', `${cols}x${rows}`);
  }
  finish(seconds: number, exitCode: number) {
    integer(exitCode, 0, 255, 'exitCode'); this.#write(seconds, 'x', String(exitCode)); this.#closed = true;
  }
}

export interface IntegrationPlan {
  machineId: string; serviceId: string; idempotencyKey: string; credentialRef: string;
  steps: readonly ['ensure-alloy', 'write-managed-config', 'validate-config', 'reload-alloy', 'verify-log-delivery'];
}
/** Plan only. Caller must authenticate the event and enforce policy, leases and durable deduplication. */
export function planLokiIntegration(input: unknown, serviceId: string, authenticatedEventId: string): IntegrationPlan[] {
  const b = validateBlueprint(input); identifier(authenticatedEventId, 'event id');
  const service = b.services.find(s => s.id === serviceId);
  invariant(service, 'Unknown service');
  return service.machineIds.map(machineId => ({
    machineId, serviceId, credentialRef: service.credentialRef,
    idempotencyKey: JSON.stringify([authenticatedEventId, b.revision, serviceId, machineId]),
    steps: ['ensure-alloy', 'write-managed-config', 'validate-config', 'reload-alloy', 'verify-log-delivery']
  }));
}
export function renderAlloy(input: unknown, serviceId: string, machineId: string, sanitizedEventsPath: string): string {
  const b = validateBlueprint(input);
  const service = b.services.find(s => s.id === serviceId);
  invariant(service && service.machineIds.includes(machineId), 'Machine is not authorized for this service');
  invariant(typeof sanitizedEventsPath === 'string' && /^(\/|[A-Za-z]:[\\/])/.test(sanitizedEventsPath) && !/[\r\n\u0000*?\[\]]/.test(sanitizedEventsPath), 'Use one absolute sanitized event-log path, not a glob');
  const q = JSON.stringify;
  return `// Generated managed fragment. Input file must already exclude secrets and terminal output.\n// Resolve ${service.credentialRef} locally into scoped environment variables.\nlocal.file_match "aid_events" {\n  path_targets = [{"__path__" = ${q(sanitizedEventsPath)}, "job" = "install-doctor", "machine_id" = ${q(machineId)}}]\n}\nloki.source.file "aid_events" {\n  targets = local.file_match.aid_events.targets\n  forward_to = [loki.write.aid.receiver]\n}\nloki.write "aid" {\n  endpoint {\n    url = ${q(service.pushUrl)}\n    basic_auth {\n      username = sys.env("AID_LOKI_USERNAME")\n      password = sys.env("AID_LOKI_PASSWORD")\n    }\n  }\n}\n`;
}
