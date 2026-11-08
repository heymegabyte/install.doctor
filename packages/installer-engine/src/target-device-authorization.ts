import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DeviceAuthorizationRequestSchema,
  type DeviceAuthorizationBinding,
  type DeviceAuthorizationRequest,
} from '@install-doctor/aid-core/device-authorization';
import { z } from 'zod';

const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 30_000;
const STATE_VERSION = 1 as const;

const StoredStateSchema = z.strictObject({
  schemaVersion: z.literal(STATE_VERSION),
  request: DeviceAuthorizationRequestSchema,
  approvalUri: z.string().url().refine(value => new URL(value).protocol === 'https:', 'approval URI must use HTTPS'),
  pollIntervalMs: z.number().int().min(MIN_POLL_INTERVAL_MS).max(MAX_POLL_INTERVAL_MS),
  pollSecret: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  privateKeyPem: z.string().startsWith('-----BEGIN PRIVATE KEY-----').endsWith('-----END PRIVATE KEY-----\n'),
});

export type StoredTargetAuthorization = z.infer<typeof StoredStateSchema>;

export interface AuthorizationStartInput {
  readonly tenantId: string;
  readonly profileId: string;
  readonly machineLabel: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}

export interface AuthorizationStartRequest {
  readonly binding: DeviceAuthorizationBinding;
  readonly machineLabel: string;
  /** Secret request-body field. Callers MUST use authenticated HTTPS. */
  readonly pollSecret: string;
}

export interface AuthorizationStartResponse {
  readonly request: unknown;
  readonly approvalUri: string;
  readonly pollIntervalMs: number;
}

export type AuthorizationPollResponse =
  | { readonly status: 'pending'; readonly retryAfterMs?: number }
  | { readonly status: 'approved'; readonly credential: string; readonly credentialId: string; readonly expiresAt: string }
  | { readonly status: 'denied'; readonly reason: 'owner-denied' | 'policy-denied' | 'expired' | 'cancelled' };

export interface TargetAuthorizationTransport {
  start(input: AuthorizationStartRequest, signal: AbortSignal): Promise<AuthorizationStartResponse>;
  /** Poll secret is carried in an HTTPS request body/header, never a process argument. */
  poll(requestId: string, pollSecret: string, signal: AbortSignal): Promise<AuthorizationPollResponse>;
  cancel(requestId: string, pollSecret: string, signal: AbortSignal): Promise<void>;
}

export interface SafeAuthorizationEvent {
  readonly event: 'waiting' | 'resumed' | 'approved' | 'denied' | 'cancelled';
  readonly requestId: string;
  readonly occurredAt: string;
  readonly reason?: string;
}

export interface AuthorizationPrompt {
  readonly verificationCode: string;
  readonly approvalUri: string;
  readonly expiresAt: string;
  readonly cancellation: 'Press Ctrl-C to cancel safely.';
}

export type AuthorizationOutcome =
  | { readonly status: 'approved'; readonly credential: string; readonly credentialId: string; readonly expiresAt: string }
  | { readonly status: 'denied' | 'cancelled' | 'expired'; readonly reason: string };

export interface TargetAuthorizationOptions {
  readonly statePath: string;
  readonly transport: TargetAuthorizationTransport;
  readonly emit?: (event: SafeAuthorizationEvent) => void;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly now?: () => Date;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function safeEvent(
  emit: TargetAuthorizationOptions['emit'], event: SafeAuthorizationEvent['event'],
  requestId: string, now: () => Date, reason?: string,
): void {
  emit?.({ event, requestId, occurredAt: now().toISOString(), ...(reason === undefined ? {} : { reason }) });
}

function publicCancellationReason(reason: string): string {
  return /^[a-z][a-z0-9.-]{0,63}$/.test(reason) ? reason : 'cancelled';
}

async function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new Error('authorization cancelled')); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('authorization cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function assertPrivateStateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('authorization state parent must be a private directory');
  if (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o700) throw new Error('authorization state parent must have mode 0700');
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error('authorization state parent owner does not match the process');
}

/** Owner-only, atomic state file. The file deliberately contains no display/log representation. */
export class ProtectedAuthorizationState {
  constructor(readonly path: string) {}

  async save(input: StoredTargetAuthorization): Promise<void> {
    const state = StoredStateSchema.parse(input);
    const parent = dirname(this.path);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await assertPrivateStateDirectory(parent);
    const temporary = join(parent, `.authorization-${randomBytes(12).toString('hex')}.tmp`);
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, 0o600);
    await rename(temporary, this.path);
  }

  async load(): Promise<StoredTargetAuthorization | undefined> {
    try {
      await assertPrivateStateDirectory(dirname(this.path));
      const metadata = await lstat(this.path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw new Error('authorization state is not a regular private file');
      if (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o600) throw new Error('authorization state must have mode 0600');
      if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error('authorization state owner does not match the process');
      return StoredStateSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async remove(): Promise<void> { await rm(this.path, { force: true }); }
}

/**
 * Creates or resumes a bounded device authorization operation. Private key and
 * polling authority never leave protected state except as in-memory HTTPS payloads.
 */
export class TargetDeviceAuthorization {
  readonly #state: ProtectedAuthorizationState;
  readonly #transport: TargetAuthorizationTransport;
  readonly #emit: ((event: SafeAuthorizationEvent) => void) | undefined;
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly #now: () => Date;

  constructor(options: TargetAuthorizationOptions) {
    this.#state = new ProtectedAuthorizationState(options.statePath);
    this.#transport = options.transport;
    this.#emit = options.emit;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? (() => new Date());
  }

  async begin(input: AuthorizationStartInput, signal: AbortSignal): Promise<AuthorizationPrompt> {
    if (await this.#state.load()) throw new Error('authorization already pending; resume or cancel it');
    signal.throwIfAborted();
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicDer = publicKey.export({ type: 'spki', format: 'der' });
    const targetPublicKey = base64Url(publicDer);
    const binding: DeviceAuthorizationBinding = {
      tenantId: input.tenantId,
      profileId: input.profileId,
      targetPublicKey,
      targetKeyFingerprint: createHash('sha256').update(publicDer).digest('hex'),
      scopes: [...input.scopes].sort(),
      nonce: base64Url(randomBytes(32)),
      expiresAt: input.expiresAt,
    };
    const pollSecret = base64Url(randomBytes(32));
    const expectedBinding = structuredClone(binding);
    const response = await this.#transport.start({ binding: structuredClone(binding), machineLabel: input.machineLabel, pollSecret }, signal);
    const request = DeviceAuthorizationRequestSchema.parse(response.request);
    if (JSON.stringify(request.binding) !== JSON.stringify(expectedBinding)
      || request.pollKeyFingerprint !== createHash('sha256').update(pollSecret).digest('hex')) {
      throw new Error('authorization response is not bound to target-generated authority');
    }
    const state = StoredStateSchema.parse({
      schemaVersion: STATE_VERSION, request, approvalUri: response.approvalUri,
      pollIntervalMs: response.pollIntervalMs, pollSecret,
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    await this.#state.save(state);
    safeEvent(this.#emit, 'waiting', request.requestId, this.#now);
    return this.#prompt(state);
  }

  async resume(signal: AbortSignal): Promise<AuthorizationOutcome> {
    const state = await this.#state.load();
    if (!state) throw new Error('no pending authorization to resume');
    safeEvent(this.#emit, 'resumed', state.request.requestId, this.#now);
    try {
      while (true) {
        signal.throwIfAborted();
        if (this.#now().getTime() >= Date.parse(state.request.binding.expiresAt)) {
          await this.#state.remove();
          safeEvent(this.#emit, 'denied', state.request.requestId, this.#now, 'expired');
          return { status: 'expired', reason: 'expired' };
        }
        const result = await this.#transport.poll(state.request.requestId, state.pollSecret, signal);
        if (result.status === 'approved') {
          await this.#state.remove();
          safeEvent(this.#emit, 'approved', state.request.requestId, this.#now);
          return result;
        }
        if (result.status === 'denied') {
          await this.#state.remove();
          safeEvent(this.#emit, 'denied', state.request.requestId, this.#now, result.reason);
          return { status: result.reason === 'cancelled' ? 'cancelled' : result.reason === 'expired' ? 'expired' : 'denied', reason: result.reason };
        }
        const delay = Math.max(state.pollIntervalMs, Math.min(result.retryAfterMs ?? state.pollIntervalMs, MAX_POLL_INTERVAL_MS));
        await this.#sleep(delay, signal);
      }
    } catch (error) {
      if (!signal.aborted) throw error;
      return this.cancel(publicCancellationReason(signal.reason instanceof Error ? signal.reason.message : 'cancelled'));
    }
  }

  async cancel(reason = 'cancelled'): Promise<AuthorizationOutcome> {
    const safeReason = publicCancellationReason(reason);
    const state = await this.#state.load();
    if (!state) return { status: 'cancelled', reason: safeReason };
    const cancellation = new AbortController();
    try { await this.#transport.cancel(state.request.requestId, state.pollSecret, cancellation.signal); } finally { await this.#state.remove(); }
    safeEvent(this.#emit, 'cancelled', state.request.requestId, this.#now, safeReason);
    return { status: 'cancelled', reason: safeReason };
  }

  async prompt(): Promise<AuthorizationPrompt | undefined> {
    const state = await this.#state.load();
    return state ? this.#prompt(state) : undefined;
  }

  #prompt(state: StoredTargetAuthorization): AuthorizationPrompt {
    return {
      verificationCode: state.request.verificationCode,
      approvalUri: state.approvalUri,
      expiresAt: state.request.binding.expiresAt,
      cancellation: 'Press Ctrl-C to cancel safely.',
    };
  }
}
