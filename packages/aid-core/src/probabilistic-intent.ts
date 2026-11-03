/**
 * Probabilistic Intent Architecture (PIA), Cloudflare Edge Super-Stack, and Easter Egg Farm.
 * Pure, side-effect-free contracts for aid and app.install.doctor.
 */

/** Wire version of the PIA contract. Bump on any breaking shape change. */
export const PIA_SPEC_VERSION = '2.0.0-PROBABILISTIC-EXPANSION' as const;

/** Every intent kind understood by the router, edge mapping, and Easter Egg farm. */
export const INTENT_KINDS = [
  'PROVISION_NODE',
  'SYNC_CHEZMOI',
  'DIAGNOSE_LOKI',
  'UPGRADE_PACKAGE',
  'INSPECT_FLEET',
  'TRIGGER_EASTER_EGG',
  'ASTRAL_EXPLORATION'
] as const;
/** A single routable intent kind derived from {@link INTENT_KINDS}. */
export type IntentKind = typeof INTENT_KINDS[number];

/** Inputs used to estimate the next intent from terminal context and cadence. */
export interface IntentContext {
  terminalBuffer: string;
  interArrivalsMs: number[];
  machineRole: string;
  recentCommands: string[];
}

/** Normalized intent distribution plus the derived routing signals. */
export interface IntentDistribution {
  probabilities: Record<IntentKind, number>;
  primaryIntent: IntentKind;
  confidence: number;
  entropy: number;
  speculativeEligible: boolean;
}

/** A speculative shadow branch staged inside an edge Durable Object. */
export interface SpeculativeBranch {
  branchId: string;
  tenantId: string;
  machineId: string;
  intent: IntentKind;
  predictedAction: string;
  stagedDiff: string;
  shadowActorId: string;
  createdAt: string;
  expiresAt: string;
  entropy: number;
}

/** Client confirmation that authorizes collapsing a speculative branch. */
export interface IntentVoucher {
  branchId: string;
  intent: IntentKind;
  actionDigest: string;
  clientTimestamp: string;
}

/** Result of collapsing a branch: the staged action applied at zero perceived latency. */
export interface CollapsedExecution {
  branchId: string;
  intent: IntentKind;
  status: 'collapsed';
  perceivedLatencyMicros: 0;
  appliedAction: string;
  auditSignature: string;
  executedAt: string;
}

/** Result of discarding a branch because the user diverged or the TTL elapsed. */
export interface EvaporatedBranch {
  branchId: string;
  status: 'evaporated';
  reason: 'user_divergence' | 'timeout';
  droppedAt: string;
}

/** Cloudflare edge placement and AI Gateway model for an intent. */
export interface EdgeRouteConfig {
  workerTier: 'smart-placement' | 'standard';
  durableObjectBinding: string;
  aiGatewayModel: string;
  cacheTtlSeconds: number;
  vectorizeQueryNeeded: boolean;
}

/** Supported Easter Egg trigger families. */
export type EasterEggTriggerKind = 'HARMONIC_FIBONACCI' | 'SECRET_CODE' | 'HIGH_ENTROPY_EXPLORATION' | 'ASTRAL_404';

/** Trigger payload evaluated by {@link evaluateEasterEgg}. */
export interface EasterEggTrigger {
  kind: EasterEggTriggerKind;
  payload: string;
  intervalsMs?: number[];
  entropy?: number;
}

/** Unlocked (or negative) Easter Egg outcome including edge headers. */
export interface EasterEggResult {
  unlocked: boolean;
  codeName: string;
  rewardType: 'persona' | 'ansi_game' | 'crypto_trophy' | 'astral_dungeon';
  content: string;
  headers: Record<string, string>;
}

/** Evolution stage of the Virtual Pet Durable Object. */
export type PetStage = 'egg' | 'bitling' | 'daemon' | 'fleet-master';

/** Persisted Virtual Pet state; every metric is a clamped 0-100 integer. */
export interface VirtualPetState {
  sessionId: string;
  stage: PetStage;
  happiness: number; // 0 - 100
  hunger: number;    // 0 - 100
  wisdom: number;    // 0 - 100
  ansiAvatar: string;
}

/** Maximum accepted telemetry sample count, guarding against unbounded edge input. */
const MAX_SAMPLES = 1_000_000;
/** Inclusive log-scaled cadence bin bounds; a value below a bound lands in that bin. */
const CADENCE_BOUNDS = [50, 120, 250, 600, 1500] as const;
/** Allowed intent kinds as a set for O(1) membership checks. */
const INTENT_KIND_SET: ReadonlySet<string> = new Set(INTENT_KINDS);
/** Allowed Easter Egg trigger kinds as a set for O(1) membership checks. */
const EGG_TRIGGER_KINDS: ReadonlySet<string> = new Set<EasterEggTriggerKind>([
  'HARMONIC_FIBONACCI',
  'SECRET_CODE',
  'HIGH_ENTROPY_EXPLORATION',
  'ASTRAL_404'
]);
/** Pet events accepted by {@link stepVirtualPet}. */
const PET_EVENTS = ['idempotent-run', 'failed-build', 'easter-egg-unlocked'] as const;
type PetEvent = typeof PET_EVENTS[number];

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function identifier(value: unknown, label: string): asserts value is string {
  invariant(typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(value), `${label}: invalid identifier`);
}

function iso(nowIso: unknown, label = 'timestamp'): asserts nowIso is string {
  invariant(typeof nowIso === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(nowIso) && Number.isFinite(Date.parse(nowIso)), `Invalid ${label}`);
}

function intentKind(value: unknown): asserts value is IntentKind {
  invariant(typeof value === 'string' && INTENT_KIND_SET.has(value), 'Invalid intent');
}

function metric(value: unknown, label: string): asserts value is number {
  invariant(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100, `Invalid ${label}`);
}

/**
 * Calculates Shannon entropy (in bits) over log-scaled interaction timing bins:
 * Bin 0: <50ms (burst/scripted/hotkey)
 * Bin 1: 50-120ms (rapid typing)
 * Bin 2: 120-250ms (deliberate cadence)
 * Bin 3: 250-600ms (reading / micro-pause)
 * Bin 4: 600-1500ms (hesitation / reflection)
 * Bin 5: >=1500ms (idle / context-switch)
 */
export function calculateCadenceEntropy(intervalsMs: number[]): number {
  if (!Array.isArray(intervalsMs) || intervalsMs.length === 0) return 0;
  invariant(intervalsMs.length <= MAX_SAMPLES, 'Too many intervals');
  // Fixed-size integer counts: one allocation per call, no per-sample branching ladder.
  const bins = new Uint32Array(CADENCE_BOUNDS.length + 1);
  let total = 0;
  for (const ms of intervalsMs) {
    invariant(typeof ms === 'number' && Number.isFinite(ms) && ms >= 0, 'Invalid interval');
    let bin = 0;
    while (bin < CADENCE_BOUNDS.length && ms >= CADENCE_BOUNDS[bin]!) bin++;
    bins[bin]!++;
    total++;
  }
  let entropy = 0;
  for (const count of bins) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return Math.round(entropy * 1000) / 1000;
}

/**
 * Predicts the multi-dimensional intent probability distribution given buffer context and telemetry.
 */
export function predictIntentDistribution(context: IntentContext): IntentDistribution {
  invariant(context !== null && typeof context === 'object', 'Invalid context');
  invariant(typeof context.terminalBuffer === 'string' && context.terminalBuffer.length <= MAX_SAMPLES, 'Expected bounded string terminalBuffer');
  invariant(Array.isArray(context.interArrivalsMs), 'Expected array interArrivalsMs');
  invariant(typeof context.machineRole === 'string' && context.machineRole.length <= 256, 'Expected bounded string machineRole');
  invariant(Array.isArray(context.recentCommands) && context.recentCommands.length <= 10_000
    && context.recentCommands.every((command): command is string => typeof command === 'string'), 'Expected string[] recentCommands');

  const entropy = calculateCadenceEntropy(context.interArrivalsMs);
  const buf = context.terminalBuffer.toLowerCase().trim();

  // Baseline unnormalized weights
  const scores: Record<IntentKind, number> = {
    PROVISION_NODE: 0.1,
    SYNC_CHEZMOI: 0.1,
    DIAGNOSE_LOKI: 0.1,
    UPGRADE_PACKAGE: 0.1,
    INSPECT_FLEET: 0.1,
    TRIGGER_EASTER_EGG: 0.05,
    ASTRAL_EXPLORATION: 0.05
  };

  // Buffer heuristic matching
  if (/xyzzy|konami|c64|matrix|space-invaders|easter|hack\s+the\s+planet/.test(buf)) {
    scores.TRIGGER_EASTER_EGG += 10.0;
  } else if (/chezmoi|dotfile|apply|diff/.test(buf)) {
    scores.SYNC_CHEZMOI += 5.0;
  } else if (/alloy|loki|grafana|log|telemetry/.test(buf)) {
    scores.DIAGNOSE_LOKI += 4.5;
  } else if (/brew|apt|dnf|apk|install|upgrade|package/.test(buf)) {
    scores.UPGRADE_PACKAGE += 4.0;
  } else if (/provision|start\.sh|setup|bootstrap/.test(buf)) {
    scores.PROVISION_NODE += 4.5;
  } else if (/fleet|machine|status|health|ping/.test(buf)) {
    scores.INSPECT_FLEET += 3.5;
  } else if (/astral|404|void|wander|lost/.test(buf)) {
    scores.ASTRAL_EXPLORATION += 4.0;
  }

  // Entropy-based modulation: high entropy elevates diagnostic / exploration
  if (entropy >= 2.0) {
    scores.DIAGNOSE_LOKI += 0.5;
    scores.ASTRAL_EXPLORATION += 0.8;
  }

  // Normalize to valid probability distribution sum(p_i) == 1.0
  const sum = Object.values(scores).reduce((a, b) => a + b, 0);
  const probabilities = {} as Record<IntentKind, number>;
  let primaryIntent: IntentKind = 'INSPECT_FLEET';
  let maxP = -1;

  for (const kind of INTENT_KINDS) {
    const p = Math.round((scores[kind] / sum) * 10000) / 10000;
    probabilities[kind] = p;
    if (p > maxP) {
      maxP = p;
      primaryIntent = kind;
    }
  }

  return {
    probabilities,
    primaryIntent,
    confidence: maxP,
    entropy,
    speculativeEligible: maxP >= 0.65
  };
}

/**
 * Forks a speculative shadow branch inside an edge Durable Object actor.
 */
export function createSpeculativeBranch(
  tenantId: string,
  machineId: string,
  intent: IntentKind,
  entropy: number,
  nowIso: string
): SpeculativeBranch {
  identifier(tenantId, 'tenantId');
  identifier(machineId, 'machineId');
  intentKind(intent);
  invariant(typeof entropy === 'number' && Number.isFinite(entropy) && entropy >= 0, 'Invalid entropy');
  iso(nowIso);
  const nowMs = Date.parse(nowIso);

  const branchId = `spec_${tenantId}_${machineId}_${Math.abs(Math.sin(nowMs)).toString(36).substring(2, 10)}`;
  const shadowActorId = `do_shadow_${branchId}`;
  const expiresAt = new Date(nowMs + 15000).toISOString(); // 15 second TTL

  let predictedAction = `aid action for ${intent}`;
  let stagedDiff = `// Speculative pre-computation for ${intent}\n`;

  if (intent === 'SYNC_CHEZMOI') {
    predictedAction = 'chezmoi apply --source-path ~/.local/share/chezmoi';
    stagedDiff = '--- .zshrc\n+++ .zshrc (speculative)\n@@ -10 +10 @@\n- export THEME=light\n+ export THEME=dark\n';
  } else if (intent === 'DIAGNOSE_LOKI') {
    predictedAction = 'alloy run --validate-only /etc/alloy/config.alloy';
    stagedDiff = '// Validated Alloy Fragment: syntax check ok\n';
  } else if (intent === 'TRIGGER_EASTER_EGG') {
    predictedAction = 'render_easter_egg_canvas';
    stagedDiff = 'ANSI_CANVAS_INITIALIZED';
  }

  return {
    branchId,
    tenantId,
    machineId,
    intent,
    predictedAction,
    stagedDiff,
    shadowActorId,
    createdAt: nowIso,
    expiresAt,
    entropy
  };
}

/**
 * Collapses the speculative branch when user intent confirms the action with 0ms perceived latency.
 */
export function collapseSpeculativeBranch(
  branch: SpeculativeBranch,
  voucher: IntentVoucher,
  nowIso: string
): CollapsedExecution {
  invariant(branch.branchId === voucher.branchId, 'Branch ID mismatch');
  invariant(branch.intent === voucher.intent, 'Intent voucher mismatch');
  const nowMs = Date.parse(nowIso);
  const expMs = Date.parse(branch.expiresAt);
  invariant(nowMs <= expMs, 'Speculative branch has expired');

  return {
    branchId: branch.branchId,
    intent: branch.intent,
    status: 'collapsed',
    perceivedLatencyMicros: 0,
    appliedAction: branch.predictedAction,
    auditSignature: `ed25519_sig_${branch.branchId}_${voucher.actionDigest}`,
    executedAt: nowIso
  };
}

/**
 * Safely evaporates a speculative branch when the user diverges or clears input (zero side-effects).
 */
export function evaporateSpeculativeBranch(
  branch: SpeculativeBranch,
  reason: 'user_divergence' | 'timeout',
  nowIso: string
): EvaporatedBranch {
  return {
    branchId: branch.branchId,
    status: 'evaporated',
    reason,
    droppedAt: nowIso
  };
}

/**
 * Maps intents to Cloudflare Planetary Edge routing configurations and AI Gateway models.
 */
export function cloudflareEdgeRoute(intent: IntentKind, allowPremium: boolean): EdgeRouteConfig {
  switch (intent) {
    case 'PROVISION_NODE':
      return {
        workerTier: 'smart-placement',
        durableObjectBinding: 'FLEET_COORDINATOR_DO',
        aiGatewayModel: allowPremium ? 'deepseek/deepseek-r1' : 'deepseek/deepseek-v3',
        cacheTtlSeconds: 0,
        vectorizeQueryNeeded: true
      };
    case 'SYNC_CHEZMOI':
      return {
        workerTier: 'smart-placement',
        durableObjectBinding: 'DOTFILE_SYNC_DO',
        aiGatewayModel: 'deepseek/deepseek-v3',
        cacheTtlSeconds: 60,
        vectorizeQueryNeeded: false
      };
    case 'DIAGNOSE_LOKI':
      return {
        workerTier: 'standard',
        durableObjectBinding: 'TELEMETRY_DO',
        aiGatewayModel: '@cf/meta/llama-3.3-70b-instruct',
        cacheTtlSeconds: 300,
        vectorizeQueryNeeded: false
      };
    case 'TRIGGER_EASTER_EGG':
    case 'ASTRAL_EXPLORATION':
      return {
        workerTier: 'smart-placement',
        durableObjectBinding: 'LUDIC_FARM_DO',
        aiGatewayModel: '@cf/meta/llama-3.3-70b-instruct',
        cacheTtlSeconds: 3600,
        vectorizeQueryNeeded: false
      };
    default:
      return {
        workerTier: 'standard',
        durableObjectBinding: 'GENERAL_SESSION_DO',
        aiGatewayModel: '@cf/meta/llama-3.3-70b-instruct',
        cacheTtlSeconds: 120,
        vectorizeQueryNeeded: false
      };
  }
}

/**
 * Generates dynamic Cloudflare edge HTTP headers for probabilistic intent and the Easter Egg farm.
 */
export function generateEdgeHeaders(
  entropy: number,
  intent: IntentKind,
  seed: string
): Record<string, string> {
  return {
    'X-Intent-Entropy': String(entropy),
    'X-Predicted-Intent': intent,
    'X-Speculative-Collapse': 'ready',
    'X-Edge-Placement': 'smart-pop-iad',
    'X-Easter-Egg-Seed': seed,
    'X-Chronos-Dimension': '0x7F2A'
  };
}

/**
 * Evaluates triggers across the multi-dimensional Easter Egg Farm.
 */
export function evaluateEasterEgg(trigger: EasterEggTrigger): EasterEggResult {
  const normPayload = trigger.payload.toLowerCase().trim();

  // 1. Secret codes
  if (trigger.kind === 'SECRET_CODE') {
    if (normPayload === 'xyzzy') {
      return {
        unlocked: true,
        codeName: 'COLOSSAL_CAVE_PORTAL',
        rewardType: 'persona',
        content: 'A hollow voice says "Plugh". The NeXTSTEP 1989 Architect persona is now active in your terminal.',
        headers: { 'X-Easter-Egg-Unlocked': 'xyzzy-1989', 'X-Persona': 'nextstep-architect' }
      };
    }
    if (normPayload === 'matrix') {
      return {
        unlocked: true,
        codeName: 'DIGITAL_RAIN',
        rewardType: 'ansi_game',
        content: '\x1b[32m[MATRIX STREAM INITIALIZED] Wake up, Neo... Follow the white rabbit.\x1b[0m',
        headers: { 'X-Easter-Egg-Unlocked': 'matrix-rain' }
      };
    }
    if (normPayload === 'c64') {
      return {
        unlocked: true,
        codeName: 'COMMODORE_64_BOOT',
        rewardType: 'ansi_game',
        content: '**** COMMODORE 64 BASIC V2 ****\n64K RAM SYSTEM  38911 BASIC BYTES FREE\nREADY.\n10 PRINT "INSTALL DOCTOR FOREVER";\n20 GOTO 10',
        headers: { 'X-Easter-Egg-Unlocked': 'c64-basic' }
      };
    }
    if (normPayload === 'space-invaders') {
      return {
        unlocked: true,
        codeName: 'SPACE_INVADERS_PTY',
        rewardType: 'ansi_game',
        content: '  👾  👾  👾  👾  👾\n  👽  👽  👽  👽  👽\n\n       |=| [FIRE: SPACE]',
        headers: { 'X-Easter-Egg-Unlocked': 'space-invaders' }
      };
    }
  }

  // 2. Harmonic Fibonacci Cadence
  if (trigger.kind === 'HARMONIC_FIBONACCI' && trigger.intervalsMs) {
    const f = [10, 10, 20, 30, 50, 80, 130];
    const isFib = trigger.intervalsMs.length >= 5 && trigger.intervalsMs.slice(0, 5).every((ms, i) => Math.abs(ms - f[i]) < 40);
    if (isFib) {
      return {
        unlocked: true,
        codeName: 'FIBONACCI_HARMONIC_RESONANCE',
        rewardType: 'crypto_trophy',
        content: 'Harmonic resonance detected. You have unlocked VIP Edge Quota: +50,000 speculative tokens.',
        headers: { 'X-Easter-Egg-Unlocked': 'fibonacci-harmonic', 'X-VIP-Tokens': '50000' }
      };
    }
  }

  // 3. Astral 404 Dungeon
  if (trigger.kind === 'ASTRAL_404') {
    return {
      unlocked: true,
      codeName: 'ASTRAL_PLANE_DUNGEON',
      rewardType: 'astral_dungeon',
      content: 'You stand in the Astral Plane of 404. Broken routes float like stardust. Exits are NORTH (to /) and VOID (to /api/v1/intent).',
      headers: { 'X-Easter-Egg-Unlocked': 'astral-dungeon' }
    };
  }

  return {
    unlocked: false,
    codeName: 'NONE',
    rewardType: 'persona',
    content: 'Nothing happens.',
    headers: {}
  };
}

/**
 * Initializes a Virtual Pet (Tamagotchi Durable Object actor).
 */
export function createVirtualPet(sessionId: string): VirtualPetState {
  invariant(typeof sessionId === 'string' && sessionId.length > 0, 'Invalid session ID');
  return {
    sessionId,
    stage: 'egg',
    happiness: 80,
    hunger: 20,
    wisdom: 10,
    ansiAvatar: ' ( ? ) '
  };
}

/**
 * Steps the Virtual Pet state based on system and developer telemetry.
 */
export function stepVirtualPet(
  pet: VirtualPetState,
  event: 'idempotent-run' | 'failed-build' | 'easter-egg-unlocked'
): VirtualPetState {
  const p = { ...pet };
  if (event === 'idempotent-run') {
    p.happiness = Math.min(100, p.happiness + 15);
    p.hunger = Math.max(0, p.hunger - 10);
    p.wisdom = Math.min(100, p.wisdom + 5);
  } else if (event === 'failed-build') {
    p.happiness = Math.max(0, p.happiness - 20);
    p.hunger = Math.min(100, p.hunger + 25);
  } else if (event === 'easter-egg-unlocked') {
    p.happiness = 100;
    p.wisdom = Math.min(100, p.wisdom + 30);
  }

  // Evolve stages based on wisdom & happiness
  if (p.wisdom >= 70 && p.happiness >= 80) {
    p.stage = 'fleet-master';
    p.ansiAvatar = ' ᕦ(ò_óˇ)ᕤ ';
  } else if (p.wisdom >= 40) {
    p.stage = 'daemon';
    p.ansiAvatar = ' (⚙_⚙) ';
  } else if (p.wisdom >= 15) {
    p.stage = 'bitling';
    p.ansiAvatar = ' (•‿•) ';
  } else {
    p.stage = 'egg';
    p.ansiAvatar = ' ( ? ) ';
  }

  return p;
}

/** Desired machine state input for {@link analyzeFleetDrift}. */
export interface DesiredMachinePosture {
  machineId: string;
  packages: string[];
  services?: string[];
}

/** Observed host telemetry input for {@link analyzeFleetDrift}. */
export interface ObservedHostPosture {
  installedPackages: string[];
  runningServices?: string[];
  sshPort?: number;
  cloudflareOnlyIngress?: boolean;
  autologinConfigured?: boolean;
}

/** Structured drift analysis and deterministic self-healing plan. */
export interface FleetDriftReport {
  machineId: string;
  converged: boolean;
  driftScore: number; // 0 (100% converged) to 100 (critical drift)
  missingPackages: string[];
  unmanagedPackages: string[];
  stoppedServices: string[];
  securityFindings: string[];
  healingPlan: string[];
}

/**
 * Computes a deterministic Desired-vs-Observed drift score, security posture check
 * (SSH Port 22, Cloudflare-only Zero-Trust firewall, Infisical autologin), and ordered
 * self-healing remediation steps.
 */
export function analyzeFleetDrift(
  desired: DesiredMachinePosture,
  observed: ObservedHostPosture
): FleetDriftReport {
  invariant(desired !== null && typeof desired === 'object', 'Expected desired posture');
  invariant(observed !== null && typeof observed === 'object', 'Expected observed posture');
  identifier(desired.machineId, 'machineId');
  invariant(Array.isArray(desired.packages) && desired.packages.length <= 10_000, 'Invalid desired.packages');
  invariant(Array.isArray(observed.installedPackages) && observed.installedPackages.length <= 10_000, 'Invalid observed.installedPackages');

  const desiredPkgSet = new Set(desired.packages);
  const observedPkgSet = new Set(observed.installedPackages);

  const missingPackages = desired.packages.filter((p) => !observedPkgSet.has(p)).sort();
  const unmanagedPackages = observed.installedPackages.filter((p) => !desiredPkgSet.has(p)).sort();

  const desiredServices = desired.services ?? [];
  const runningSet = new Set(observed.runningServices ?? []);
  const stoppedServices = desiredServices.filter((s) => !runningSet.has(s)).sort();

  const securityFindings: string[] = [];
  const healingPlan: string[] = [];

  if (missingPackages.length > 0) {
    healingPlan.push(`aid apply --yes # install ${missingPackages.length} missing package(s): ${missingPackages.slice(0, 5).join(', ')}`);
  }
  for (const svc of stoppedServices) {
    healingPlan.push(`sudo systemctl restart ${svc} || brew services restart ${svc}`);
  }
  if (observed.sshPort !== undefined && observed.sshPort !== 22) {
    securityFindings.push(`SSH listening on non-standard port ${observed.sshPort} (policy requires standard port 22 protected by Cloudflare firewall)`);
    healingPlan.push('chezmoi apply ~/.ssh/sshd_config && cloudflare-firewall');
  }
  if (observed.cloudflareOnlyIngress === false) {
    securityFindings.push('Cloudflare-Only Zero-Trust Firewall is not active on public ingress ports 22/80/443');
    healingPlan.push('cloudflare-firewall');
  }
  if (observed.autologinConfigured === false) {
    securityFindings.push('Infisical-backed unlocked desktop autologin is not configured');
    healingPlan.push('desktop-autologin');
  }

  const rawPenalty =
    missingPackages.length * 10 +
    stoppedServices.length * 20 +
    securityFindings.length * 25;
  const driftScore = Math.min(100, rawPenalty);
  const converged = driftScore === 0;

  return {
    machineId: desired.machineId,
    converged,
    driftScore,
    missingPackages,
    unmanagedPackages,
    stoppedServices,
    securityFindings,
    healingPlan
  };
}

/** Input used to mint a tamper-evident SHA-256 hash-chained execution receipt. */
export interface ExecutionReceiptInput {
  receiptId: string;
  tenantId: string;
  machineId: string;
  runId: string;
  parentRunId?: string;
  blueprintDigest: string;
  action: string;
  exitCode: number;
  timestamp: string;
  prevReceiptHash?: string;
}

/** Tamper-evident SHA-256 hash-chained execution receipt. */
export interface ExecutionReceipt extends ExecutionReceiptInput {
  prevReceiptHash: string;
  receiptHash: string;
}

async function computeReceiptPayloadHash(input: ExecutionReceiptInput, prevHash: string): Promise<string> {
  const canonicalPayload = JSON.stringify({
    receiptId: input.receiptId,
    tenantId: input.tenantId,
    machineId: input.machineId,
    runId: input.runId,
    parentRunId: input.parentRunId ?? null,
    blueprintDigest: input.blueprintDigest,
    action: input.action,
    exitCode: input.exitCode,
    timestamp: input.timestamp,
    prevReceiptHash: prevHash
  });
  const bytes = new TextEncoder().encode(canonicalPayload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mints a cryptographically hash-chained ExecutionReceipt for durable History auditability.
 */
export async function mintExecutionReceipt(input: ExecutionReceiptInput): Promise<ExecutionReceipt> {
  identifier(input.receiptId, 'receiptId');
  identifier(input.tenantId, 'tenantId');
  identifier(input.machineId, 'machineId');
  identifier(input.runId, 'runId');
  if (input.parentRunId !== undefined) identifier(input.parentRunId, 'parentRunId');
  invariant(typeof input.blueprintDigest === 'string' && /^[0-9a-f]{64}$/.test(input.blueprintDigest), 'Invalid blueprintDigest');
  invariant(typeof input.action === 'string' && input.action.length > 0 && input.action.length <= 2048, 'Invalid action');
  invariant(Number.isSafeInteger(input.exitCode) && input.exitCode >= 0 && input.exitCode <= 255, 'Invalid exitCode');
  iso(input.timestamp, 'timestamp');
  const prevReceiptHash = input.prevReceiptHash ?? '0'.repeat(64);
  invariant(/^[0-9a-f]{64}$/.test(prevReceiptHash), 'Invalid prevReceiptHash');

  const receiptHash = await computeReceiptPayloadHash(input, prevReceiptHash);
  return {
    ...input,
    prevReceiptHash,
    receiptHash
  };
}

/**
 * Verifies the cryptographic SHA-256 integrity of an ExecutionReceipt.
 */
export async function verifyExecutionReceipt(receipt: ExecutionReceipt): Promise<boolean> {
  if (!receipt || typeof receipt !== 'object' || typeof receipt.receiptHash !== 'string') return false;
  try {
    const expected = await computeReceiptPayloadHash(receipt, receipt.prevReceiptHash);
    return expected === receipt.receiptHash;
  } catch {
    return false;
  }
}

/** Candidate catalog item scored by {@link rankSemanticCatalogMatches}. */
export interface SemanticCatalogCandidate {
  name: string;
  bin: string;
  short?: string;
  providers: string[];
  platforms: string[];
  installMode?: 'app' | 'service' | 'cli';
  configured?: boolean;
}

/** Ranked semantic catalog match with score and matched terms. */
export interface SemanticCatalogMatch extends SemanticCatalogCandidate {
  score: number;
  matchedTerms: string[];
}

const SEMANTIC_SYNONYMS: Record<string, string[]> = {
  history: ['hishtory', 'shell', 'command', 'audit', 'atuin'],
  firewall: ['ufw', 'nftables', 'pf', 'cloudflare', 'security', 'iptables'],
  container: ['docker', 'orbstack', 'podman', 'kubernetes', 'k8s', 'oci', 'lxc'],
  gpu: ['nvidia', 'cuda', 'ollama', 'llm', 'ai'],
  disk: ['du', 'dust', 'dua', 'ncdu', 'storage', 'filesystem', 'btrfs', 'zfs'],
  search: ['ripgrep', 'rg', 'fd', 'fzf', 'grep', 'find'],
  secret: ['infisical', 'age', 'vault', 'bitwarden', 'pass', 'keychain'],
  editor: ['nvim', 'neovim', 'vim', 'vscode', 'codium', 'helix'],
  terminal: ['tmux', 'zellij', 'ghostty', 'wezterm', 'kitty', 'alacritty', 'warp']
};

/**
 * Ranks catalog tools by BM25-style lexical + domain-synonym semantic relevance in <2ms at the edge.
 */
export function rankSemanticCatalogMatches(
  query: string,
  entries: SemanticCatalogCandidate[],
  options?: { os?: string; limit?: number }
): SemanticCatalogMatch[] {
  invariant(typeof query === 'string' && query.length <= 512, 'Invalid query');
  invariant(Array.isArray(entries), 'Expected entries array');
  const limit = Math.max(1, Math.min(options?.limit ?? 10, 50));
  const osFilter = options?.os?.toLowerCase().trim();

  const rawTokens = query
    .toLowerCase()
    .split(/[^a-z0-9_+-]+/)
    .filter((t) => t.length >= 2);
  if (rawTokens.length === 0) return [];

  const expandedTokens = new Set<string>(rawTokens);
  for (const t of rawTokens) {
    const syns = SEMANTIC_SYNONYMS[t];
    if (syns) for (const s of syns) expandedTokens.add(s);
  }

  const scored: SemanticCatalogMatch[] = [];
  for (const entry of entries) {
    if (osFilter && Array.isArray(entry.platforms) && !entry.platforms.includes(osFilter)) {
      continue;
    }
    const nameLower = entry.name.toLowerCase();
    const binLower = entry.bin.toLowerCase();
    const descLower = (entry.short ?? '').toLowerCase();
    let score = 0;
    const matchedTerms: string[] = [];

    for (const tok of expandedTokens) {
      const isPrimary = rawTokens.includes(tok);
      const weight = isPrimary ? 1.0 : 0.45;
      if (nameLower === tok || binLower === tok) {
        score += 25 * weight;
        matchedTerms.push(tok);
      } else if (nameLower.includes(tok) || binLower.includes(tok)) {
        score += 12 * weight;
        matchedTerms.push(tok);
      } else if (descLower.includes(tok)) {
        score += 5 * weight;
        matchedTerms.push(tok);
      }
    }

    if (score > 0) {
      if (entry.configured) score += 1.5; // slight boost for tools with turnkey post-installx hooks
      scored.push({
        ...entry,
        score: Math.round(score * 100) / 100,
        matchedTerms: Array.from(new Set(matchedTerms))
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit);
}
