import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { FileHandle } from 'node:fs/promises';
import type { Inspection, Verification } from './engine.js';
import type { NativePackageRuntime, NativePackageRuntimeAuthority } from './offline-execution.js';
import {
  PrivilegedBrokerGrantSchema,
  PrivilegedBrokerReceiptSchema,
  PrivilegedBrokerRequestSchema,
  privilegedBrokerDigest,
} from './privileged-broker-protocol.js';
import type { PrivilegedBrokerGrant, PrivilegedBrokerReceipt, PrivilegedBrokerRequest } from './privileged-broker-protocol.js';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const PrivilegedBrokerClientConfigSchema = z.strictObject({
  helperPath: z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value),
  socketPath: z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value && value.startsWith('/run/desktop-tools/')),
  hostId: identifier,
  releaseId: identifier,
  runId: identifier,
  planDigest: digest,
  taskId: identifier,
  grant: PrivilegedBrokerGrantSchema,
});
const ErrorResponseSchema = z.strictObject({
  schemaVersion: z.literal(1), status: z.literal('failed'), error: z.literal('broker request rejected').or(z.literal('broker operation failed')),
});
const BrokerResponseSchema = z.union([PrivilegedBrokerReceiptSchema, ErrorResponseSchema]);

export type PrivilegedBrokerClientConfig = z.infer<typeof PrivilegedBrokerClientConfigSchema>;

export interface PrivilegedBrokerTransport {
  readonly invoke: (input: {
    readonly helperPath: string;
    readonly helperDigest: string;
    readonly socketPath: string;
    readonly request: PrivilegedBrokerRequest;
    readonly payload: FileHandle;
  }) => Promise<PrivilegedBrokerReceipt>;
}

async function hashHandle(handle: FileHandle, size: number): Promise<string> {
  if (!Number.isSafeInteger(size) || size < 1 || size > 32 * 1024 * 1024) throw new Error('privileged broker helper size is outside its boundary');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size));
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (bytesRead === 0) throw new Error('privileged broker helper was truncated');
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest('hex');
}

async function openVerifiedHelper(path: string, expectedDigest: string): Promise<FileHandle> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== 0
    || (before.mode & 0o022) !== 0 || (before.mode & 0o111) === 0 || await realpath(path) !== path) {
    throw new Error('privileged broker helper is not a canonical protected root-owned executable');
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const opened = await handle.stat();
  if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
    || await hashHandle(handle, opened.size) !== expectedDigest) {
    await handle.close();
    throw new Error('privileged broker helper differs from signed grant authority');
  }
  return handle;
}

export const defaultPrivilegedBrokerTransport: PrivilegedBrokerTransport = Object.freeze({
  async invoke(input: Parameters<PrivilegedBrokerTransport['invoke']>[0]) {
    if (process.platform !== 'linux') throw new Error('privileged broker transport is supported only on Linux');
    const helper = await openVerifiedHelper(input.helperPath, input.helperDigest);
    try {
      const requestBytes = Buffer.from(JSON.stringify(PrivilegedBrokerRequestSchema.parse(input.request)), 'utf8');
      const child = spawn('/proc/self/fd/5', ['client', '--socket', input.socketPath], {
        shell: false, windowsHide: true, detached: false,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe', input.payload.fd, helper.fd],
        env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
      });
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let overflow = false;
      if (!child.stdout || !child.stderr) {
        child.kill('SIGKILL');
        throw new Error('privileged broker output channels are unavailable');
      }
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes <= 65_536) stdout.push(Buffer.from(chunk)); else overflow = true;
      });
      child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 8_192) overflow = true; });
      const requestStream = child.stdio[3];
      if (!requestStream || !('end' in requestStream)) {
        child.kill('SIGKILL');
        throw new Error('privileged broker request channel is unavailable');
      }
      requestStream.end(requestBytes);
      const status = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 125_000);
        timer.unref();
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
      });
      if (status.signal !== null || status.code !== 0 || overflow || stdoutBytes === 0) {
        throw new Error('privileged broker transport failed or exceeded its output boundary');
      }
      const response = BrokerResponseSchema.parse(JSON.parse(Buffer.concat(stdout).toString('utf8')) as unknown);
      if ('error' in response) throw new Error(response.error);
      const requestDigest = privilegedBrokerDigest(input.request);
      const requestedAt = Date.parse(input.request.requestedAt);
      const completedAt = Date.parse(response.completedAt);
      if (response.requestDigest !== requestDigest || response.grantDigest !== input.request.grantDigest
        || response.hostId !== input.request.hostId || response.releaseId !== input.request.releaseId
        || response.runId !== input.request.runId || response.planDigest !== input.request.planDigest
        || response.grantId !== input.request.grantId || response.taskId !== input.request.taskId
        || response.operationId !== input.request.operationId || response.phase !== input.request.phase
        || response.nonce !== input.request.nonce || response.payloadSha256 !== input.request.payload.sha256
        || completedAt < requestedAt || completedAt > requestedAt + 130_000) {
        throw new Error('privileged broker receipt differs from the exact request');
      }
      return response;
    } finally { await helper.close(); }
  },
});

export function createPrivilegedBrokerNativeRuntime(
  configInput: PrivilegedBrokerClientConfig,
  transport: PrivilegedBrokerTransport = defaultPrivilegedBrokerTransport,
  now: () => Date = () => new Date(),
): NativePackageRuntime {
  const config = PrivilegedBrokerClientConfigSchema.parse(configInput);
  const grant = config.grant as PrivilegedBrokerGrant;
  if (grant.hostId !== config.hostId || grant.releaseId !== config.releaseId || grant.runId !== config.runId
    || grant.planDigest !== config.planDigest || grant.brokerExecutableDigest.length !== 64) {
    throw new Error('privileged broker client configuration differs from its exact grant');
  }
  const invoke = async (phase: 'check' | 'apply' | 'verify', authority: NativePackageRuntimeAuthority): Promise<PrivilegedBrokerReceipt> => {
    if (authority.operation.action !== phase || authority.rootDescriptor.packageKey !== authority.operation.packageKey) {
      throw new Error('privileged broker runtime authority phase or package identity differs');
    }
    const operation = grant.operations.find(candidate => candidate.taskId === config.taskId && candidate.phase === phase);
    if (!operation) throw new Error(`privileged broker grant lacks the ${phase} operation`);
    const descriptor = authority.rootDescriptor.artifact;
    return authority.withPayload(authority.rootDescriptor.packageKey, async payload => {
      const requestedAt = now().toISOString();
      const request = PrivilegedBrokerRequestSchema.parse({
        schemaVersion: 1, hostId: config.hostId, releaseId: config.releaseId, runId: config.runId,
        planDigest: config.planDigest, grantId: grant.grantId, grantDigest: privilegedBrokerDigest(grant),
        taskId: config.taskId, operationId: operation.operationId, phase,
        consentDigest: grant.consentDigest, descriptorDigest: grant.descriptorDigest, closureDigest: grant.closureDigest,
        payload: { sha256: descriptor.sha256, sizeBytes: descriptor.sizeBytes, requiredSeals: ['seal', 'shrink', 'grow', 'write'] },
        nonce: randomBytes(32).toString('base64url'), requestedAt,
      });
      return transport.invoke({ helperPath: config.helperPath, helperDigest: grant.brokerExecutableDigest,
        socketPath: config.socketPath, request, payload });
    });
  };
  return Object.freeze({
    async check(authority: NativePackageRuntimeAuthority): Promise<Inspection> {
      const receipt = await invoke('check', authority);
      if (!['verified', 'needed', 'inapplicable'].includes(receipt.status)) throw new Error('broker check receipt has an invalid status');
      return receipt.status as Inspection;
    },
    async apply(authority: NativePackageRuntimeAuthority): Promise<void> {
      if ((await invoke('apply', authority)).status !== 'applied') throw new Error('broker apply receipt is not applied');
    },
    async verify(authority: NativePackageRuntimeAuthority): Promise<Verification> {
      const receipt = await invoke('verify', authority);
      if (!['verified', 'inapplicable', 'pending'].includes(receipt.status)) throw new Error('broker verify receipt has an invalid status');
      return receipt.status as Verification;
    },
  });
}
