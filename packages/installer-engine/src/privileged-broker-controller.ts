#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { publishTrustedLocalBrokerGrant, retireTrustedLocalBrokerGrant } from './privileged-broker-local-approval.js';
import type { TrustedLocalConfirmation } from './privileged-broker-local-approval.js';
import { publishSignedDeviceBrokerGrant } from './privileged-broker-device-approval.js';
import { PrivilegedBrokerControllerInputSchema } from './privileged-broker-controller-contract.js';
import type { PrivilegedBrokerControllerInput } from './privileged-broker-controller-contract.js';

export { PrivilegedBrokerControllerInputSchema } from './privileged-broker-controller-contract.js';
export type { PrivilegedBrokerControllerInput } from './privileged-broker-controller-contract.js';

export interface PrivilegedBrokerControllerTestOptions {
  /** Test-only dependency injection. The strict CLI input has no such field. */
  readonly confirmation?: TrustedLocalConfirmation;
  readonly now?: () => Date;
}

const MAX_INPUT_BYTES = 2_097_152;

async function hashOpenFile(handle: Awaited<ReturnType<typeof open>>, size: number, maximumBytes: number): Promise<string> {
  if (!Number.isSafeInteger(size) || size < 1 || size > maximumBytes) throw new Error('broker runtime file size is outside policy');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size));
  for (let offset = 0; offset < size;) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (bytesRead === 0) throw new Error('broker helper was truncated');
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return hash.digest('hex');
}

async function openVerifiedRootFile(path: string, expectedDigest: string, executable: boolean, maximumBytes: number) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== 0
    || (before.mode & 0o022) !== 0 || executable && (before.mode & 0o111) === 0 || await realpath(path) !== path) {
    throw new Error('broker runtime file is not exact and root-protected');
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const opened = await handle.stat();
  if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
    || await hashOpenFile(handle, opened.size, maximumBytes) !== expectedDigest) {
    await handle.close();
    throw new Error('broker runtime file differs from signed grant authority');
  }
  return handle;
}

async function assertSocketParent(input: PrivilegedBrokerControllerInput): Promise<void> {
  const parent = await lstat(dirname(input.socketPath));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || parent.gid !== input.socketGid
    || (parent.mode & 0o777) !== 0o710) {
    throw new Error('broker socket parent is not the exact protected root-owned run directory');
  }
  try {
    await lstat(input.socketPath);
    throw new Error('broker socket already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function waitForBrokerSocket(input: PrivilegedBrokerControllerInput, child: ReturnType<typeof spawn>): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('privileged broker exited before readiness');
    try {
      const socket = await lstat(input.socketPath);
      if (!socket.isSocket() || socket.isSymbolicLink() || socket.uid !== 0 || socket.gid !== input.socketGid
        || (socket.mode & 0o777) !== 0o660) throw new Error('privileged broker published an unsafe socket');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await new Promise<void>(resolveDelay => setTimeout(resolveDelay, 20));
  }
  child.kill('SIGKILL');
  throw new Error('privileged broker did not become ready within five seconds');
}

async function removeOwnedSocketPath(input: PrivilegedBrokerControllerInput, path: string, staging: boolean): Promise<void> {
  try {
    const socket = await lstat(path);
    if (!socket.isSocket() || socket.isSymbolicLink() || socket.uid !== 0
      || (!staging && socket.gid !== input.socketGid)) {
      throw new Error('refusing to remove a substituted broker socket');
    }
    await rm(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function removeOwnedSocket(input: PrivilegedBrokerControllerInput): Promise<void> {
  await removeOwnedSocketPath(input, input.socketPath, false);
  await removeOwnedSocketPath(input, `${input.socketPath}.starting`, true);
}

export async function runPrivilegedBrokerController(inputValue: unknown, testOptions: PrivilegedBrokerControllerTestOptions = {}): Promise<Readonly<{
  grantDigest: string; authorityDigest: string; approvalEvidenceDigest: string; exitCode: number;
}>> {
  if (process.platform !== 'linux' || process.geteuid?.() !== 0) throw new Error('privileged broker controller requires Linux root');
  const input = PrivilegedBrokerControllerInputSchema.parse(inputValue);
  await assertSocketParent(input);
  const helper = await openVerifiedRootFile(input.helperPath, input.helperDigest, true, 32 * 1024 * 1024);
  try {
    const runtime = await openVerifiedRootFile(input.runtimePath, input.runtimeDigest, true, 268_435_456);
    try {
      const worker = await openVerifiedRootFile(input.workerPath, input.workerDigest, false, 2_097_152);
      await worker.close();
    } finally { await runtime.close(); }
    const publication = input.deviceApproval && input.deviceApprovalTrust
      ? await publishSignedDeviceBrokerGrant({ grant: input.grant, authority: input.authority,
          approval: input.deviceApproval, trust: input.deviceApprovalTrust })
      : await publishTrustedLocalBrokerGrant({ grant: input.grant, authority: input.authority,
          ...(testOptions.confirmation ? { confirmation: testOptions.confirmation } : {}),
          ...(testOptions.now ? { now: testOptions.now } : {}) });
    const child = spawn('/proc/self/fd/3', [
      'serve', '--socket', input.socketPath, '--uid', String(input.grant.enrolledUid), '--gid', String(input.socketGid),
      '--runtime', input.runtimePath, '--runtime-sha256', input.runtimeDigest,
      '--worker', input.workerPath, '--worker-sha256', input.workerDigest,
      '--requests', String(input.requestLimit), '--timeout', `${input.operationTimeoutMs}ms`,
    ], {
      shell: false, detached: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', helper.fd],
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C' },
    });
    const lifecycle: { termination: 'none' | 'graceful' | 'interrupted' | 'expired' } = { termination: 'none' };
    const terminate = (kind: typeof lifecycle.termination) => {
      if (lifecycle.termination === 'none') lifecycle.termination = kind;
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    };
    const graceful = () => terminate('graceful');
    const interrupted = () => terminate('interrupted');
    process.once('SIGTERM', graceful); process.once('SIGINT', interrupted); process.once('SIGHUP', interrupted);
    const expiresInMs = Date.parse(input.grant.expiresAt) - Date.now();
    if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
      terminate('expired');
    }
    const expiryTimer = setTimeout(() => terminate('expired'), Math.max(1, Math.min(expiresInMs, 2_147_483_647)));
    try {
      await waitForBrokerSocket(input, child);
      process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: 'authorized', socketPath: input.socketPath,
        grantDigest: publication.grantDigest, authorityDigest: publication.authorityDigest, brokerPid: child.pid })}\n`);
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolveResult({ code, signal }));
      });
      if (lifecycle.termination === 'expired') throw new Error('privileged broker exceeded its grant lifetime');
      if (lifecycle.termination === 'interrupted') throw new Error('privileged broker controller was interrupted');
      if (result.signal !== null || result.code !== 0) throw new Error('privileged broker terminated without a clean bounded completion');
      return Object.freeze({ ...publication, exitCode: result.code });
    } finally {
      clearTimeout(expiryTimer);
      process.removeListener('SIGTERM', graceful); process.removeListener('SIGINT', interrupted); process.removeListener('SIGHUP', interrupted);
      await removeOwnedSocket(input);
      await retireTrustedLocalBrokerGrant(input.grant.grantId);
    }
  } finally {
    await helper.close();
  }
}

async function readInput(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk); total += bytes.length;
    if (total > MAX_INPUT_BYTES) throw new Error('privileged broker controller input exceeds its boundary');
    chunks.push(bytes);
  }
  if (total === 0) throw new Error('privileged broker controller input is empty');
  return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as unknown;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPrivilegedBrokerController(await readInput()).catch(() => {
    process.stderr.write('desktop-tools privileged broker controller failed\n');
    process.exitCode = 1;
  });
}
