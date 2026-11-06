import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, open, readdir, readlink, realpath, stat } from 'node:fs/promises';
import { z } from 'zod';

const DPKG_QUERY = '/usr/bin/dpkg-query';
const DPKG_STATUS = '/var/lib/dpkg/status';
const DPKG_LOCKS = ['/var/lib/dpkg/lock', '/var/lib/dpkg/lock-frontend'] as const;
const MAX_QUERY_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGES = 100_000;
const MAX_PROCESSES = 1_000_000;
const QUERY_TIMEOUT_MS = 15_000;

const packageName = z.string().regex(/^[a-z0-9][a-z0-9+.-]{0,127}(?::[a-z0-9][a-z0-9-]{0,31})?$/);
const version = z.string().max(256).refine(value => !/[\0\r\n\x1f]/.test(value), 'invalid Debian version');
const architecture = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const want = z.enum(['unknown', 'install', 'hold', 'deinstall', 'purge']);
const errorFlag = z.enum(['ok', 'reinstreq']);
const packageStatus = z.enum(['not-installed', 'config-files', 'half-installed', 'unpacked', 'half-configured', 'triggers-awaited', 'triggers-pending', 'installed']);

export interface DpkgInventoryRecord {
  readonly packageName: string;
  readonly version: string;
  readonly architecture: string;
  readonly want: z.infer<typeof want>;
  readonly errorFlag: z.infer<typeof errorFlag>;
  readonly status: z.infer<typeof packageStatus>;
}

export type QuiescenceProbe =
  | { readonly state: 'clear'; readonly evidence: string }
  | { readonly state: 'busy'; readonly evidence: string }
  | { readonly state: 'ambiguous'; readonly evidence: string };

export interface NativeDpkgQuiescenceAdapter {
  readonly assertProductionGate: () => Promise<void>;
  readonly probeLocks: (signal?: AbortSignal) => Promise<QuiescenceProbe>;
  readonly probeMutationProcesses: (signal?: AbortSignal) => Promise<QuiescenceProbe>;
  readonly queryDatabase: (signal?: AbortSignal) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
}

export type NativeDpkgQuiescenceProof =
  | { readonly state: 'quiescent'; readonly packageCount: number; readonly observations: readonly string[]; readonly limitation: string }
  | { readonly state: 'busy'; readonly reason: string; readonly observations: readonly string[] }
  | { readonly state: 'corrupt-or-ambiguous'; readonly reason: string; readonly observations: readonly string[] }
  | { readonly state: 'database-unhealthy'; readonly reason: string; readonly affectedPackages: readonly string[]; readonly observations: readonly string[] };

export class NativeDpkgQuiescenceError extends Error {
  override readonly name = 'NativeDpkgQuiescenceError';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new DOMException('Operation aborted', 'AbortError');
}

export function parseDpkgDatabaseInventory(stdout: string): readonly DpkgInventoryRecord[] {
  if (stdout.length === 0 || Buffer.byteLength(stdout, 'utf8') > MAX_QUERY_BYTES || /[\0\r]/.test(stdout)) {
    throw new NativeDpkgQuiescenceError('dpkg inventory is empty, oversized, or contains unsafe control bytes');
  }
  const lines = stdout.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines.length > MAX_PACKAGES) throw new NativeDpkgQuiescenceError('dpkg inventory record count exceeds its bound');
  const seen = new Set<string>();
  const records: DpkgInventoryRecord[] = [];
  try {
    for (const line of lines) {
      const fields = line.split('\x1f');
      if (fields.length !== 6) throw new Error('unexpected field count');
      const record = Object.freeze({
        packageName: packageName.parse(fields[0]),
        version: version.parse(fields[1]),
        architecture: architecture.parse(fields[2]),
        want: want.parse(fields[3]),
        errorFlag: errorFlag.parse(fields[4]),
        status: packageStatus.parse(fields[5]),
      });
      if (seen.has(record.packageName)) throw new NativeDpkgQuiescenceError(`dpkg inventory contains duplicate package ${record.packageName}`);
      seen.add(record.packageName);
      records.push(record);
    }
  } catch (error) {
    if (error instanceof NativeDpkgQuiescenceError) throw error;
    throw new NativeDpkgQuiescenceError(`dpkg inventory is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze(records);
}

function unhealthyPackages(records: readonly DpkgInventoryRecord[]): readonly string[] {
  return records.filter(record =>
    record.errorFlag !== 'ok'
    || ['deinstall', 'purge'].includes(record.want)
    || ['half-installed', 'unpacked', 'half-configured', 'triggers-awaited', 'triggers-pending'].includes(record.status)
    || (record.status === 'installed' && !['install', 'hold'].includes(record.want)))
    .map(record => record.packageName)
    .sort();
}

function observation(kind: string, probe: QuiescenceProbe): string {
  return `${kind}:${probe.state}:${probe.evidence}`;
}

export async function proveNativeDpkgQuiescence(input: {
  readonly adapter?: NativeDpkgQuiescenceAdapter;
  readonly signal?: AbortSignal;
} = {}): Promise<NativeDpkgQuiescenceProof> {
  const adapter = input.adapter ?? createNativeDpkgQuiescenceAdapter();
  throwIfAborted(input.signal);
  await adapter.assertProductionGate();
  const observations: string[] = [];

  const evaluateProbe = (kind: string, probe: QuiescenceProbe): NativeDpkgQuiescenceProof | undefined => {
    observations.push(observation(kind, probe));
    if (probe.state === 'busy') return { state: 'busy', reason: probe.evidence, observations: Object.freeze([...observations]) };
    if (probe.state === 'ambiguous') return { state: 'corrupt-or-ambiguous', reason: probe.evidence, observations: Object.freeze([...observations]) };
    return undefined;
  };

  throwIfAborted(input.signal);
  const processBefore = await adapter.probeMutationProcesses(input.signal);
  let terminal = evaluateProbe('process-before', processBefore);
  if (terminal !== undefined) return terminal;
  const locksBefore = await adapter.probeLocks(input.signal);
  terminal = evaluateProbe('locks-before', locksBefore);
  if (terminal !== undefined) return terminal;

  throwIfAborted(input.signal);
  let query: Awaited<ReturnType<NativeDpkgQuiescenceAdapter['queryDatabase']>>;
  try { query = await adapter.queryDatabase(input.signal); }
  catch (error) {
    throwIfAborted(input.signal);
    return {
      state: 'database-unhealthy', reason: `dpkg-query could not inspect the database: ${error instanceof Error ? error.message : String(error)}`,
      affectedPackages: [], observations: Object.freeze([...observations]),
    };
  }
  if (query.code !== 0) return {
    state: 'database-unhealthy', reason: `dpkg-query failed with exit ${query.code}`, affectedPackages: [],
    observations: Object.freeze([...observations]),
  };
  let inventory: readonly DpkgInventoryRecord[];
  try { inventory = parseDpkgDatabaseInventory(query.stdout); }
  catch (error) {
    return {
      state: 'database-unhealthy', reason: error instanceof Error ? error.message : String(error), affectedPackages: [],
      observations: Object.freeze([...observations]),
    };
  }
  const unhealthy = unhealthyPackages(inventory);
  if (unhealthy.length > 0) return {
    state: 'database-unhealthy', reason: 'dpkg contains interrupted, repair-required, trigger-pending, or removal-intent state',
    affectedPackages: Object.freeze(unhealthy), observations: Object.freeze([...observations]),
  };

  throwIfAborted(input.signal);
  const locksAfter = await adapter.probeLocks(input.signal);
  terminal = evaluateProbe('locks-after', locksAfter);
  if (terminal !== undefined) return terminal;
  const processAfter = await adapter.probeMutationProcesses(input.signal);
  terminal = evaluateProbe('process-after', processAfter);
  if (terminal !== undefined) return terminal;
  return Object.freeze({
    state: 'quiescent', packageCount: inventory.length, observations: Object.freeze([...observations]),
    limitation: 'This is a point-in-time proof. The install-doctor global fence must be held and external lock/process evidence rechecked immediately around every mutation boundary.',
  });
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function assertCanonicalRootFile(path: string, executable = false): Promise<void> {
  const metadata = await lstat(path).catch(() => { throw new NativeDpkgQuiescenceError(`${path} is unavailable`); });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0 || await realpath(path) !== path) {
    throw new NativeDpkgQuiescenceError(`${path} is not a canonical root-owned non-writable regular file`);
  }
  if (executable) await access(path, constants.X_OK).catch(() => { throw new NativeDpkgQuiescenceError(`${path} is not executable`); });
}

function linuxDeviceIdentity(device: bigint): { readonly major: bigint; readonly minor: bigint } {
  return {
    major: ((device >> 8n) & 0xfffn) | ((device >> 32n) & 0xfffff000n),
    minor: (device & 0xffn) | ((device >> 12n) & 0xffffff00n),
  };
}

interface LockIdentity { readonly path: string; readonly major: bigint; readonly minor: bigint; readonly inode: bigint }

async function lockIdentities(): Promise<readonly LockIdentity[]> {
  return await Promise.all(DPKG_LOCKS.map(async path => {
    await assertCanonicalRootFile(path);
    const metadata = await stat(path, { bigint: true });
    const device = linuxDeviceIdentity(metadata.dev);
    return { path, ...device, inode: metadata.ino };
  }));
}

async function readBounded(path: string, maximum: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(maximum + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maximum) throw new NativeDpkgQuiescenceError(`${path} exceeds its read bound`);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

async function probeProcLocks(signal?: AbortSignal): Promise<QuiescenceProbe> {
  throwIfAborted(signal);
  let locks: readonly LockIdentity[];
  let text: string;
  try {
    locks = await lockIdentities();
    text = (await readBounded('/proc/locks', 16 * 1024 * 1024)).toString('utf8');
  } catch (error) {
    return { state: 'ambiguous', evidence: error instanceof Error ? error.message : String(error) };
  }
  if (/\0|\r/.test(text)) return { state: 'ambiguous', evidence: '/proc/locks contains unsafe control bytes' };
  for (const [index, line] of text.split('\n').entries()) {
    if (line.length === 0) continue;
    const match = /^\d+:\s+(?:->\s+)?(\S+)\s+\S+\s+\S+\s+(-?\d+)\s+([0-9a-fA-F]+):([0-9a-fA-F]+):(\d+)\s+/.exec(line);
    if (match === null) return { state: 'ambiguous', evidence: `/proc/locks line ${index + 1} is malformed or unsupported` };
    const major = BigInt(`0x${match[3]}`); const minor = BigInt(`0x${match[4]}`); const inode = BigInt(match[5]!);
    const target = locks.find(candidate => candidate.major === major && candidate.minor === minor && candidate.inode === inode);
    if (target !== undefined && !['POSIX', 'FLOCK', 'OFDLCK'].includes(match[1]!)) {
      return { state: 'ambiguous', evidence: `${target.path} has unsupported ${match[1]} lock evidence` };
    }
    if (target !== undefined) return { state: 'busy', evidence: `${target.path} has an advisory lock held by pid ${match[2]}` };
  }
  return { state: 'clear', evidence: 'no POSIX/OFD/flock record targets either canonical dpkg lock inode' };
}

const mutationExecutables = new Set([
  '/usr/bin/apt', '/usr/bin/apt-get', '/usr/bin/aptitude', '/usr/bin/dpkg', '/usr/bin/nala',
  '/usr/bin/packagekitd', '/usr/sbin/synaptic', '/usr/bin/unattended-upgrade',
]);
const mutationCommands = new Set(['apt', 'apt-get', 'apt.systemd.daily', 'aptitude', 'dpkg', 'nala', 'packagekitd', 'synaptic', 'unattended-upgrade', 'unattended-upgr']);

async function probeProcProcesses(signal?: AbortSignal): Promise<QuiescenceProbe> {
  throwIfAborted(signal);
  let entries;
  try { entries = await readdir('/proc', { withFileTypes: true, encoding: 'utf8' }); }
  catch (error) { return { state: 'ambiguous', evidence: `/proc cannot be enumerated: ${error instanceof Error ? error.message : String(error)}` }; }
  const pids = entries.filter(entry => entry.isDirectory() && /^[1-9]\d*$/.test(entry.name)).map(entry => Number(entry.name));
  if (pids.length > MAX_PROCESSES) return { state: 'ambiguous', evidence: '/proc process count exceeds its bound' };
  for (const pid of pids) {
    throwIfAborted(signal);
    if (pid === process.pid) continue;
    try {
      const [exe, commBytes] = await Promise.all([readlink(`/proc/${pid}/exe`), readBounded(`/proc/${pid}/comm`, 256)]);
      const comm = commBytes.toString('utf8').trimEnd();
      const normalizedExe = exe.replace(/ \(deleted\)$/, '');
      if (mutationExecutables.has(normalizedExe) || mutationCommands.has(comm)) {
        return { state: 'busy', evidence: `package mutation actor pid ${pid} (${normalizedExe}; ${comm}) is running` };
      }
    } catch (error) {
      if (isErrno(error, 'ENOENT') || isErrno(error, 'ESRCH')) continue;
      return { state: 'ambiguous', evidence: `cannot inspect process ${pid}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { state: 'clear', evidence: 'no recognized apt/dpkg mutation actor is running' };
}

async function runDpkgInventory(signal?: AbortSignal): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  throwIfAborted(signal);
  return await new Promise((resolve, reject) => {
    const child = spawn(DPKG_QUERY, [
      '--show', '--showformat=${binary:Package}\x1f${Version}\x1f${Architecture}\x1f${db:Status-Want}\x1f${db:Status-Eflag}\x1f${db:Status-Status}\n',
    ], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' }, signal });
    let stdout = ''; let stderr = ''; let terminal = false;
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > MAX_QUERY_BYTES) { terminal = true; child.kill('SIGKILL'); }
      return next.slice(0, MAX_QUERY_BYTES + 1);
    };
    const timer = setTimeout(() => { terminal = true; child.kill('SIGKILL'); }, QUERY_TIMEOUT_MS); timer.unref();
    child.stdout!.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (terminal) return reject(new NativeDpkgQuiescenceError('dpkg-query timed out or exceeded its output bound'));
      resolve(Object.freeze({ code: code ?? 255, stdout, stderr }));
    });
  });
}

export function createNativeDpkgQuiescenceAdapter(): NativeDpkgQuiescenceAdapter {
  return Object.freeze({
    assertProductionGate: async () => {
      if (process.platform !== 'linux') throw new NativeDpkgQuiescenceError('native dpkg quiescence proof is supported only on Linux');
      if (process.getuid?.() !== 0) throw new NativeDpkgQuiescenceError('native dpkg quiescence proof requires root');
      await assertCanonicalRootFile(DPKG_QUERY, true);
      await assertCanonicalRootFile(DPKG_STATUS);
      await lockIdentities();
    },
    probeLocks: probeProcLocks,
    probeMutationProcesses: probeProcProcesses,
    queryDatabase: runDpkgInventory,
  });
}
