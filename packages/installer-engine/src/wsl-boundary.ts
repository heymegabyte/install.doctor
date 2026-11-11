import { createHash } from 'node:crypto';
import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const opaqueReference = z.string().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/);

export const WslIdentitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  pairId: identifier,
  windows: z.strictObject({
    authority: z.literal('windows-host'),
    hostId: identifier,
    machineGuidDigest: digest,
    bootId: opaqueReference,
  }),
  linux: z.strictObject({
    authority: z.literal('linux-guest'),
    guestId: identifier,
    distroName: z.string().min(1).max(128),
    distroId: identifier,
    instanceId: opaqueReference,
  }),
}).superRefine((identity, context) => {
  if (identity.windows.hostId === identity.linux.guestId) {
    context.addIssue({ code: 'custom', path: ['linux', 'guestId'], message: 'WSL host and guest identities must be distinct' });
  }
});

export const WslOperationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pairId: identifier,
  runId: identifier,
  planDigest: digest,
  authority: z.enum(['windows-host', 'linux-guest']),
  principalId: identifier,
  action: z.enum(['read', 'write', 'execute', 'credential-read']),
  path: z.strictObject({
    authority: z.enum(['windows-host', 'linux-guest']),
    value: z.string().min(1).max(32_768),
    resolvedValue: z.string().min(1).max(32_768),
  }).optional(),
  credential: z.strictObject({
    authority: z.enum(['windows-host', 'linux-guest']),
    reference: opaqueReference,
  }).optional(),
}).superRefine((operation, context) => {
  if ((operation.action === 'credential-read') !== Boolean(operation.credential)) {
    context.addIssue({ code: 'custom', path: ['credential'], message: 'credential-read requires exactly one opaque credential reference' });
  }
  if (operation.action !== 'credential-read' && !operation.path) {
    context.addIssue({ code: 'custom', path: ['path'], message: 'filesystem operation requires a path' });
  }
  if (operation.path && operation.credential) {
    context.addIssue({ code: 'custom', path: ['credential'], message: 'one WSL operation cannot combine filesystem and credential authority' });
  }
});

function classifyPath(value: string): 'windows-host' | 'linux-guest' | 'windows-to-linux' | 'linux-to-windows' | 'invalid' {
  if (/^\\\\[?.]\\/.test(value)) return 'invalid';
  if (/^(?:\\\\[^\\/]+\\|[A-Za-z]:[\\/])/.test(value)) {
    return /^\\\\wsl(?:\$|\.localhost)\\/i.test(value) ? 'windows-to-linux' : 'windows-host';
  }
  if (value.startsWith('/')) {
    return /^\/mnt\/[A-Za-z](?:\/|$)/.test(value) ? 'linux-to-windows' : 'linux-guest';
  }
  return 'invalid';
}

export type WslOperationDecision = Readonly<{
  decision: 'allow' | 'deny';
  reason: 'same-authority-path' | 'same-authority-credential' | 'pair-identity-mismatch'
    | 'authority-identity-mismatch' | 'cross-boundary-path' | 'cross-boundary-credential'
    | 'path-authority-mismatch' | 'invalid-absolute-path';
}>;

/** Pure admission only: observing a mounted host path or UNC projection never grants cross-boundary authority. */
export function preflightWslOperation(identityInput: unknown, operationInput: unknown): WslOperationDecision {
  const identity = WslIdentitySchema.parse(identityInput);
  const operation = WslOperationSchema.parse(operationInput);
  if (operation.pairId !== identity.pairId) return Object.freeze({ decision: 'deny', reason: 'pair-identity-mismatch' });
  const expectedPrincipal = operation.authority === 'windows-host' ? identity.windows.hostId : identity.linux.guestId;
  if (operation.principalId !== expectedPrincipal) {
    return Object.freeze({ decision: 'deny', reason: 'authority-identity-mismatch' });
  }
  if (operation.credential) {
    const schemes = operation.credential.authority === 'windows-host'
      ? ['credential-manager://', 'dpapi://', 'infisical://']
      : ['infisical://', 'secret-service://', 'systemd-credential://'];
    if (!schemes.some(scheme => operation.credential!.reference.startsWith(scheme))) {
      return Object.freeze({ decision: 'deny', reason: 'cross-boundary-credential' });
    }
    return operation.credential.authority === operation.authority
      ? Object.freeze({ decision: 'allow', reason: 'same-authority-credential' })
      : Object.freeze({ decision: 'deny', reason: 'cross-boundary-credential' });
  }
  const path = operation.path!;
  const actual = classifyPath(path.value);
  const resolved = classifyPath(path.resolvedValue);
  if (actual === 'invalid' || resolved === 'invalid') return Object.freeze({ decision: 'deny', reason: 'invalid-absolute-path' });
  if (actual === 'windows-to-linux' || actual === 'linux-to-windows'
    || resolved === 'windows-to-linux' || resolved === 'linux-to-windows'
    || resolved !== actual) {
    return Object.freeze({ decision: 'deny', reason: 'cross-boundary-path' });
  }
  if (path.authority !== actual) return Object.freeze({ decision: 'deny', reason: 'path-authority-mismatch' });
  return path.authority === operation.authority
    ? Object.freeze({ decision: 'allow', reason: 'same-authority-path' })
    : Object.freeze({ decision: 'deny', reason: 'cross-boundary-path' });
}

const WslRestartBodySchema = z.strictObject({
  schemaVersion: z.literal(1),
  pairId: identifier,
  runId: identifier,
  planDigest: digest,
  target: z.enum(['linux-guest', 'windows-host']),
  authority: z.enum(['linux-guest', 'windows-host']),
  principalId: identifier,
  preWindowsBootId: opaqueReference,
  preLinuxInstanceId: opaqueReference,
  requestedAt: timestamp,
  returnDeadline: timestamp,
});

export const WslRestartContinuationSchema = WslRestartBodySchema.extend({ continuationId: digest })
  .superRefine((continuation, context) => {
    const { continuationId: _continuationId, ...body } = continuation;
    if (restartDigest(body) !== continuation.continuationId) {
      context.addIssue({ code: 'custom', path: ['continuationId'], message: 'WSL restart continuation differs from its bound identities' });
    }
  });

export const WslRestartRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  identity: WslIdentitySchema,
  runId: identifier,
  planDigest: digest,
  target: z.enum(['linux-guest', 'windows-host']),
  authority: z.enum(['linux-guest', 'windows-host']),
  principalId: identifier,
  requestedAt: timestamp,
  returnTimeoutMs: z.number().int().min(10_000).max(86_400_000),
});

export const WslRestartHeartbeatSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pairId: identifier,
  runId: identifier,
  planDigest: digest,
  continuationId: digest,
  windowsBootId: opaqueReference,
  linuxInstanceId: opaqueReference,
  observedAt: timestamp,
});

type WslRestartBody = z.infer<typeof WslRestartBodySchema>;

function restartDigest(body: WslRestartBody): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function coordinateWslRestart(input: unknown) {
  const request = WslRestartRequestSchema.parse(input);
  const expectedPrincipal = request.authority === 'windows-host'
    ? request.identity.windows.hostId : request.identity.linux.guestId;
  if (request.authority !== request.target || request.principalId !== expectedPrincipal) {
    return Object.freeze({ status: 'denied' as const, reason: 'restart-authority-mismatch' as const });
  }
  const body = WslRestartBodySchema.parse({
    schemaVersion: 1,
    pairId: request.identity.pairId,
    runId: request.runId,
    planDigest: request.planDigest,
    target: request.target,
    authority: request.authority,
    principalId: request.principalId,
    preWindowsBootId: request.identity.windows.bootId,
    preLinuxInstanceId: request.identity.linux.instanceId,
    requestedAt: request.requestedAt,
    returnDeadline: new Date(Date.parse(request.requestedAt) + request.returnTimeoutMs).toISOString(),
  });
  return Object.freeze({ status: 'ready' as const,
    continuation: WslRestartContinuationSchema.parse({ ...body, continuationId: restartDigest(body) }) });
}

export function inspectWslRestartReturn(continuationInput: unknown, heartbeatInput: unknown | null, nowInput: string) {
  const continuation = WslRestartContinuationSchema.parse(continuationInput);
  const now = timestamp.parse(nowInput);
  const expired = Date.parse(now) >= Date.parse(continuation.returnDeadline);
  if (heartbeatInput === null) return Object.freeze({ status: expired ? 'recovery-timeout' as const : 'awaiting-return' as const,
    canResume: false, reason: 'return-heartbeat-missing' as const });
  const heartbeat = WslRestartHeartbeatSchema.parse(heartbeatInput);
  if (heartbeat.pairId !== continuation.pairId || heartbeat.runId !== continuation.runId
    || heartbeat.planDigest !== continuation.planDigest || heartbeat.continuationId !== continuation.continuationId) {
    return Object.freeze({ status: 'identity-mismatch' as const, canResume: false, reason: 'continuation-identity-mismatch' as const });
  }
  const observedAt = Date.parse(heartbeat.observedAt);
  if (observedAt <= Date.parse(continuation.requestedAt) || observedAt > Date.parse(now)) {
    return Object.freeze({ status: 'identity-mismatch' as const, canResume: false, reason: 'heartbeat-time-invalid' as const });
  }
  if (expired || observedAt >= Date.parse(continuation.returnDeadline)) {
    return Object.freeze({ status: 'recovery-timeout' as const, canResume: false, reason: 'return-heartbeat-late' as const });
  }
  if (continuation.target === 'linux-guest') {
    if (heartbeat.windowsBootId !== continuation.preWindowsBootId) {
      return Object.freeze({ status: 'identity-mismatch' as const, canResume: false, reason: 'unexpected-windows-host-reboot' as const });
    }
    if (heartbeat.linuxInstanceId === continuation.preLinuxInstanceId) {
      return Object.freeze({ status: 'awaiting-return' as const, canResume: false, reason: 'linux-guest-identity-unchanged' as const });
    }
  } else {
    if (heartbeat.windowsBootId === continuation.preWindowsBootId) {
      return Object.freeze({ status: 'awaiting-return' as const, canResume: false, reason: 'windows-host-identity-unchanged' as const });
    }
    if (heartbeat.linuxInstanceId === continuation.preLinuxInstanceId) {
      return Object.freeze({ status: 'identity-mismatch' as const, canResume: false, reason: 'stale-linux-guest-after-host-reboot' as const });
    }
  }
  return Object.freeze({ status: 'ready-to-resume' as const, canResume: true,
    reason: continuation.target === 'linux-guest' ? 'linux-guest-restart-verified' as const : 'windows-host-restart-verified' as const });
}
