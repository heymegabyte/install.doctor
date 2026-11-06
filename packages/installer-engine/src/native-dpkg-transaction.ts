import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readdir, readFile, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { z } from 'zod';

import { NativeOfflinePayloadDescriptorSchema } from './contracts.js';
import type { NativeOfflinePayloadDescriptor } from './contracts.js';
import { SystemdServiceStateSnapshotSchema, serviceStateFromSnapshot } from './config-transaction.js';
import type { ServiceStateAdapter, ServiceStateSnapshot } from './config-transaction.js';
import type { Inspection, Verification } from './engine.js';
import type { NativePackageRuntime, NativePackageRuntimeAuthority } from './offline-execution.js';
import { createNativeDpkgFence } from './native-dpkg-fence.js';
import type { NativeDpkgFenceOwner } from './native-dpkg-fence.js';
import { createNativeDpkgQuiescenceAdapter, proveNativeDpkgQuiescence } from './native-dpkg-quiescence.js';
import type { NativeDpkgQuiescenceProof } from './native-dpkg-quiescence.js';
import { createNativeDpkgQueryRunner, parseDpkgQueryState } from './native-dpkg-state.js';
import type { DpkgPackageState } from './native-dpkg-state.js';
import { createNativePolicyRcdTransaction } from './native-policy-rcd.js';
import type { NativePolicyRcdTransaction, PolicyRcdPersistence } from './native-policy-rcd.js';
import { createSystemdServiceStateAdapter } from './service-state-adapters.js';
import type { DebianVersionComparator } from './debian-relationships.js';
import { NativeDpkgTransactionRecordSchema } from './native-dpkg-transaction-record.js';
import type { NativeDpkgTransactionPersistence, NativeDpkgTransactionRecord } from './native-dpkg-transaction-record.js';

export { NativeDpkgTransactionRecordSchema } from './native-dpkg-transaction-record.js';
export type { NativeDpkgTransactionPersistence, NativeDpkgTransactionRecord } from './native-dpkg-transaction-record.js';

const DPKG = '/usr/bin/dpkg';
const SYSTEMCTL = '/usr/bin/systemctl';
const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export interface NativeDpkgFenceRuntime {
  readonly acquire: (claim: { readonly runId: string; readonly hostId: string; readonly planDigest: string }) => Promise<NativeDpkgFenceOwner>;
  readonly renew: (owner: NativeDpkgFenceOwner) => Promise<NativeDpkgFenceOwner>;
  readonly release: (owner: NativeDpkgFenceOwner) => Promise<void>;
}

export interface NativeDpkgExecutionRequest {
  readonly action: 'unpack' | 'configure';
  readonly packageName: string;
  readonly payloadDescriptor?: number;
}

export interface NativeDpkgTransactionRuntimeOptions {
  readonly identity: { readonly runId: string; readonly hostId: string; readonly planDigest: string };
  readonly persistence: NativeDpkgTransactionPersistence;
  readonly compareDebianVersions: DebianVersionComparator;
  readonly fence?: NativeDpkgFenceRuntime;
  readonly proveQuiescence?: (signal?: AbortSignal) => Promise<NativeDpkgQuiescenceProof>;
  readonly queryPackage?: (packageName: string) => Promise<DpkgPackageState | null>;
  readonly createPolicyTransaction?: (persistence: PolicyRcdPersistence) => Promise<NativePolicyRcdTransaction>;
  readonly serviceAdapter?: ServiceStateAdapter;
  readonly executeDpkg?: (request: NativeDpkgExecutionRequest) => Promise<{ readonly code: number; readonly stderr: string }>;
  readonly assertProductionGate?: () => Promise<void>;
  readonly assertNetworkDenied?: () => Promise<void>;
  readonly now?: () => string;
}

export class NativeDpkgTransactionError extends Error {
  override readonly name = 'NativeDpkgTransactionError';
  constructor(message: string, options?: ErrorOptions) { super(message, options); }
}

interface AdmittedPackage {
  readonly descriptor: NativeOfflinePayloadDescriptor;
  readonly packageKey: string;
  readonly packageName: string;
  readonly version: string;
  readonly architecture: 'amd64' | 'arm64' | 'all';
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(`${JSON.stringify(canonical(value))}\n`).digest('hex');
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 1024) || 'native dpkg transaction failed';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Operation aborted', 'AbortError');
}

async function assertTrustedExecutable(path: string): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    [info] = await Promise.all([lstat(path), access(path, constants.X_OK)]);
  } catch (error) { throw new NativeDpkgTransactionError(`${path} is unavailable`, { cause: error }); }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink < 1 || info.uid !== 0
    || (info.mode & 0o022) !== 0 || await realpath(path) !== path) {
    throw new NativeDpkgTransactionError(`${path} is not a canonical root-owned non-writable executable`);
  }
}

async function assertDefaultProductionGate(): Promise<void> {
  if (process.platform !== 'linux' || process.geteuid?.() !== 0) {
    throw new NativeDpkgTransactionError('native dpkg mutation requires Linux root authority');
  }
  await Promise.all([assertTrustedExecutable(DPKG), assertTrustedExecutable(SYSTEMCTL)]);
}

async function readBoundedText(path: string, maximum: number): Promise<string> {
  const bytes = await readFile(path);
  if (bytes.byteLength > maximum || bytes.includes(0)) throw new NativeDpkgTransactionError(`${path} is oversized or malformed`);
  return bytes.toString('utf8');
}

/**
 * Production admission accepts only a namespace whose visible interface set is
 * loopback-only and whose IPv4/IPv6 route tables expose no non-loopback route.
 * Merely lacking a default route is intentionally insufficient.
 */
export interface NativeDpkgNetworkIsolationProbe {
  readonly listInterfaces?: () => Promise<readonly string[]>;
  readonly readText?: (path: string, maximumBytes: number) => Promise<string>;
}

/**
 * Proves the namespace cannot activate an inert interface and has no usable
 * non-loopback route. Linux creates dormant tunnel devices (for example gre0
 * and sit0) even inside a genuinely disconnected namespace, so their mere
 * presence is not network authority.
 */
export async function assertNativeDpkgNetworkDenied(
  probe: NativeDpkgNetworkIsolationProbe = {},
): Promise<void> {
  const listInterfaces = probe.listInterfaces ?? (async () => (await readdir('/sys/class/net', { withFileTypes: true }))
    .filter(entry => entry.isSymbolicLink() || entry.isDirectory())
    .map(entry => entry.name));
  const readText = probe.readText ?? readBoundedText;
  let interfaces: readonly string[];
  try { interfaces = await listInterfaces(); }
  catch (error) { throw new NativeDpkgTransactionError('cannot prove the native runtime network namespace', { cause: error }); }
  if (!interfaces.includes('lo') || new Set(interfaces).size !== interfaces.length
    || interfaces.some(value => !/^[A-Za-z0-9_.:-]{1,15}$/.test(value))) {
    throw new NativeDpkgTransactionError('native dpkg namespace has malformed interface evidence');
  }
  const status = await readText('/proc/self/status', 1024 * 1024);
  for (const capabilitySet of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'] as const) {
    const matches = [...status.matchAll(new RegExp(`^${capabilitySet}:\\s*([0-9A-Fa-f]{1,16})$`, 'gm'))];
    if (matches.length !== 1) throw new NativeDpkgTransactionError(`native dpkg namespace has malformed ${capabilitySet} evidence`);
    if ((BigInt(`0x${matches[0]![1]!}`) & (1n << 12n)) !== 0n) {
      throw new NativeDpkgTransactionError('native dpkg namespace retains CAP_NET_ADMIN authority');
    }
  }
  for (const interfaceName of interfaces.filter(value => value !== 'lo')) {
    const [flagsText, operstateText] = await Promise.all([
      readText(`/sys/class/net/${interfaceName}/flags`, 128),
      readText(`/sys/class/net/${interfaceName}/operstate`, 128),
    ]);
    const flagsMatch = /^0x([0-9A-Fa-f]{1,8})\n?$/.exec(flagsText);
    const operstate = operstateText.trim();
    if (!flagsMatch || !['down', 'unknown', 'dormant', 'notpresent', 'lowerlayerdown'].includes(operstate)) {
      throw new NativeDpkgTransactionError(`native dpkg namespace interface is not provably inert: ${interfaceName}`);
    }
    if ((Number.parseInt(flagsMatch[1]!, 16) & 0x1) !== 0) {
      throw new NativeDpkgTransactionError(`native dpkg namespace interface is administratively up: ${interfaceName}`);
    }
  }
  const ipv4 = await readText('/proc/net/route', 1024 * 1024);
  const ipv4Lines = ipv4.trim().split('\n').slice(1).filter(Boolean);
  if (ipv4Lines.some(line => !line.startsWith('lo\t'))) throw new NativeDpkgTransactionError('native dpkg namespace has a non-loopback IPv4 route');
  const ipv6 = await readText('/proc/net/ipv6_route', 1024 * 1024);
  for (const line of ipv6.split('\n').filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields.at(-1) !== 'lo') throw new NativeDpkgTransactionError('native dpkg namespace has a non-loopback or malformed IPv6 route');
  }
}

async function assertDefaultNetworkDenied(): Promise<void> {
  await assertNativeDpkgNetworkDenied();
}

async function defaultQueryPackage(packageName: string): Promise<DpkgPackageState | null> {
  const result = await createNativeDpkgQueryRunner().query(packageName);
  if (result.code === 1 && result.stdout.length === 0) return null;
  if (result.code !== 0) throw new NativeDpkgTransactionError(`dpkg-query failed with exit ${result.code}`);
  return parseDpkgQueryState(result.stdout);
}

async function defaultExecuteDpkg(request: NativeDpkgExecutionRequest): Promise<{ readonly code: number; readonly stderr: string }> {
  await assertTrustedExecutable(DPKG);
  const arguments_ = request.action === 'unpack'
    ? ['--force-confold', '--no-triggers', '--unpack', '--', '/proc/self/fd/3']
    : ['--force-confold', '--no-triggers', '--configure', '--', request.packageName];
  if (request.action === 'unpack' && (!Number.isSafeInteger(request.payloadDescriptor) || request.payloadDescriptor! < 0)) {
    throw new NativeDpkgTransactionError('dpkg unpack requires one exact borrowed payload descriptor');
  }
  return await new Promise((resolve, reject) => {
    const stdio: Array<'ignore' | 'pipe' | number> = request.action === 'unpack'
      ? ['ignore', 'ignore', 'pipe', request.payloadDescriptor!]
      : ['ignore', 'ignore', 'pipe'];
    const child = spawn(DPKG, arguments_, {
      shell: false,
      stdio,
      windowsHide: true,
      env: {
        PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
        LANG: 'C', LC_ALL: 'C',
        DEBIAN_FRONTEND: 'noninteractive',
        DEBCONF_NONINTERACTIVE_SEEN: 'true',
      },
    });
    const diagnostics: Buffer[] = [];
    let diagnosticBytes = 0;
    let overflow = false;
    child.stderr?.on('data', (chunk: Buffer) => {
      diagnosticBytes += chunk.byteLength;
      if (diagnosticBytes <= 65_536) diagnostics.push(Buffer.from(chunk));
      else overflow = true;
    });
    child.once('error', error => reject(new NativeDpkgTransactionError('fixed dpkg executable could not start', { cause: error })));
    child.once('close', (code, signal) => {
      const stderr = Buffer.concat(diagnostics).toString('utf8').replace(/[\0\r\n]+/g, ' ').trim().slice(0, 1024);
      if (signal !== null) return reject(new NativeDpkgTransactionError(`dpkg was terminated by ${signal}`));
      if (overflow) return reject(new NativeDpkgTransactionError('dpkg diagnostics exceeded their output bound'));
      resolve(Object.freeze({ code: code ?? 255, stderr }));
    });
    // Deliberately no AbortSignal, timeout, or kill path: dpkg is never
    // signalled mid-step. Cancellation is observed at the next safe boundary.
  });
}

function admitAuthority(authority: NativePackageRuntimeAuthority): {
  readonly packages: readonly AdmittedPackage[];
  readonly authorityDigest: string;
  readonly serviceUnits: readonly string[];
} {
  if (authority.packages.length === 0 || authority.packages.length > 4096) throw new NativeDpkgTransactionError('native package closure is empty or oversized');
  const packages: AdmittedPackage[] = [];
  const keys = new Set<string>();
  const names = new Set<string>();
  const serviceUnits = new Set<string>();
  for (const item of authority.packages) {
    const descriptor = NativeOfflinePayloadDescriptorSchema.parse(item.descriptor);
    if (keys.has(descriptor.packageKey) || names.has(descriptor.package.name)) throw new NativeDpkgTransactionError('native package closure contains duplicate identities');
    keys.add(descriptor.packageKey); names.add(descriptor.package.name);
    if (item.metadata.packageName !== descriptor.package.name
      || item.metadata.packageVersion !== descriptor.package.version
      || item.metadata.packageArchitecture !== descriptor.package.architecture
      || item.metadata.payloadSha256 !== descriptor.artifact.sha256
      || item.control.control.packageName !== descriptor.package.name
      || item.control.control.version !== descriptor.package.version
      || item.control.control.architecture !== descriptor.package.architecture) {
      throw new NativeDpkgTransactionError(`native package ${descriptor.packageKey} lost verified metadata authority`);
    }
    if (item.control.members.some(member => !['control', 'conffiles', 'md5sums'].includes(member.name))) {
      throw new NativeDpkgTransactionError(`native package ${descriptor.packageKey} contains a non-admitted control member`);
    }
    for (const unit of descriptor.affectedServiceUnits) serviceUnits.add(unit);
    packages.push(Object.freeze({
      descriptor, packageKey: descriptor.packageKey, packageName: descriptor.package.name,
      version: descriptor.package.version, architecture: descriptor.package.architecture,
    }));
  }
  if (packages.at(-1)?.packageKey !== authority.rootDescriptor.packageKey
    || authority.operation.packageKey !== authority.rootDescriptor.packageKey
    || authority.operation.payloadArtifactId !== authority.rootDescriptor.artifact.id) {
    throw new NativeDpkgTransactionError('native package root does not match the ordered verified closure');
  }
  return Object.freeze({
    packages: Object.freeze(packages),
    authorityDigest: sha256(authority.packages.map(item => ({ descriptor: item.descriptor, metadata: item.metadata, control: item.control }))),
    serviceUnits: Object.freeze([...serviceUnits].sort((left, right) => left.localeCompare(right))),
  });
}

function exactStateDisposition(
  observed: DpkgPackageState | null,
  expected: AdmittedPackage,
  compareVersions: DebianVersionComparator,
): 'pending' | 'needs-unpack' | 'needs-configure' | 'configured' {
  if (observed === null || observed.status === 'not-installed' || observed.status === 'config-files') return 'pending';
  if (observed.packageName !== expected.packageName || observed.architecture !== expected.architecture) {
    throw new NativeDpkgTransactionError(`installed identity for ${expected.packageKey} differs from signed authority`);
  }
  if (observed.want === 'hold' && observed.version !== expected.version) throw new NativeDpkgTransactionError(`held package ${expected.packageKey} has version drift`);
  if (!['install', 'hold'].includes(observed.want) || observed.errorFlag !== 'ok') throw new NativeDpkgTransactionError(`package ${expected.packageKey} requires unbounded dpkg repair`);
  const comparison = compareVersions(expected.version, observed.version);
  if (!Number.isFinite(comparison)) throw new NativeDpkgTransactionError('Debian version comparator returned a non-finite result');
  if (comparison < 0) throw new NativeDpkgTransactionError(`native package ${expected.packageKey} would require a forbidden downgrade`);
  if (comparison > 0) {
    if (observed.status !== 'installed') throw new NativeDpkgTransactionError(`version-drifted package ${expected.packageKey} is in ambiguous partial state`);
    return 'needs-unpack';
  }
  if (observed.status === 'installed') return 'configured';
  if (observed.status === 'unpacked' || observed.status === 'half-configured') return 'needs-configure';
  if (observed.status === 'half-installed') return 'needs-unpack';
  throw new NativeDpkgTransactionError(`package ${expected.packageKey} is in unsupported ${observed.status} state`);
}

type SystemdServiceSnapshot = Extract<ServiceStateSnapshot, { manager: 'systemd' }>;

function snapshotFor(serviceId: string, state: Awaited<ReturnType<ServiceStateAdapter['capture']>>): SystemdServiceSnapshot {
  return SystemdServiceStateSnapshotSchema.parse({ schemaVersion: 1, serviceId, manager: 'systemd', ...state });
}

export function createNativeDpkgTransactionRuntime(options: NativeDpkgTransactionRuntimeOptions): NativePackageRuntime {
  const identity = z.strictObject({ runId: identifier, hostId: identifier, planDigest: digest }).parse(options.identity);
  if (!options.persistence || typeof options.persistence.load !== 'function' || typeof options.persistence.save !== 'function') {
    throw new NativeDpkgTransactionError('native dpkg runtime requires owner-bound durable persistence');
  }
  if (typeof options.compareDebianVersions !== 'function') throw new NativeDpkgTransactionError('native dpkg runtime requires a Debian version comparator');
  const fence = options.fence ?? createNativeDpkgFence();
  const proveQuiescence = options.proveQuiescence ?? (async signal => await proveNativeDpkgQuiescence({ adapter: createNativeDpkgQuiescenceAdapter(), ...(signal ? { signal } : {}) }));
  const queryPackage = options.queryPackage ?? defaultQueryPackage;
  const executeDpkg = options.executeDpkg ?? defaultExecuteDpkg;
  const assertProductionGate = options.assertProductionGate ?? assertDefaultProductionGate;
  const assertNetworkDenied = options.assertNetworkDenied ?? assertDefaultNetworkDenied;
  const serviceAdapter = options.serviceAdapter ?? createSystemdServiceStateAdapter({ systemctlPath: SYSTEMCTL });
  const now = options.now ?? (() => new Date().toISOString());

  const inspectAll = async (authority: NativePackageRuntimeAuthority): Promise<readonly ReturnType<typeof exactStateDisposition>[]> => {
    const admitted = admitAuthority(authority);
    const dispositions = [] as ReturnType<typeof exactStateDisposition>[];
    for (const package_ of admitted.packages) dispositions.push(exactStateDisposition(await queryPackage(package_.packageName), package_, options.compareDebianVersions));
    return Object.freeze(dispositions);
  };

  const mutate = async (authority: NativePackageRuntimeAuthority): Promise<void> => {
    const admitted = admitAuthority(authority);
    const transactionId = sha256({ ...identity, rootPackageKey: authority.rootDescriptor.packageKey, authorityDigest: admitted.authorityDigest });
    const signal = authority.context?.signal;
    throwIfAborted(signal);
    await assertProductionGate();
    await assertNetworkDenied();
    let owner = await fence.acquire(identity);
    let record: NativeDpkgTransactionRecord | undefined;
    let policy: NativePolicyRcdTransaction | undefined;
    let thrown: unknown;

    const persist = async (changes: Partial<NativeDpkgTransactionRecord>): Promise<void> => {
      if (!record) throw new NativeDpkgTransactionError('native dpkg transaction record is not initialized');
      record = NativeDpkgTransactionRecordSchema.parse({ ...record, ...changes, updatedAt: now() });
      await options.persistence.save(record);
    };
    const renew = async (): Promise<void> => { owner = await fence.renew(owner); };
    const executeWithHeartbeat = async <T>(operation: () => Promise<T>): Promise<T> => {
      let heartbeat: Promise<void> | undefined;
      let heartbeatFailure: unknown;
      const timer = setInterval(() => {
        if (heartbeat !== undefined) return;
        heartbeat = renew().catch(error => { heartbeatFailure ??= error; }).finally(() => { heartbeat = undefined; });
      }, 4_000);
      timer.unref();
      let result: T;
      try { result = await operation(); }
      finally {
        clearInterval(timer);
        if (heartbeat !== undefined) await heartbeat;
      }
      if (heartbeatFailure !== undefined) throw new NativeDpkgTransactionError('native dpkg fence heartbeat was lost during an uninterruptible dpkg step', { cause: heartbeatFailure });
      return result;
    };
    const proveBoundary = async (allowTargetRepair: boolean): Promise<void> => {
      throwIfAborted(signal);
      await renew();
      const proof = await proveQuiescence(signal);
      if (proof.state === 'quiescent') return;
      if (allowTargetRepair && proof.state === 'database-unhealthy'
        && proof.affectedPackages.length > 0
        && proof.affectedPackages.every(name => admitted.packages.some(value => value.packageName === name))) return;
      throw new NativeDpkgTransactionError(`dpkg is not quiescent: ${proof.reason}`);
    };
    const policyPersistence: PolicyRcdPersistence = {
      prepare: async value => { await persist({ phase: 'policy-prepared', policyRecord: value }); },
      update: async value => { await persist({ policyRecord: value }); },
    };
    const policyFactory = options.createPolicyTransaction ?? (async persistence => await createNativePolicyRcdTransaction({ persistence }));

    const restoreServices = async (): Promise<void> => {
      if (!record || record.serviceSnapshots.length === 0) return;
      await persist({ phase: 'restoring-services' });
      for (const snapshot of [...record.serviceSnapshots].reverse()) {
        if (snapshot.manager !== 'systemd' || serviceAdapter.manager !== 'systemd') throw new NativeDpkgTransactionError('native dpkg runtime supports only systemd service restoration');
        await serviceAdapter.restore(snapshot.serviceId, serviceStateFromSnapshot(snapshot));
      }
      await persist({ phase: 'services-restored' });
    };
    const restorePolicy = async (): Promise<void> => {
      if (!record?.policyRecord || !policy) return;
      await persist({ phase: 'restoring-policy' });
      const restored = await policy.restore(record.policyRecord);
      await persist({ phase: 'restoring-policy', policyRecord: restored });
    };

    try {
      const existingRaw = await options.persistence.load(transactionId);
      if (existingRaw !== undefined) {
        record = NativeDpkgTransactionRecordSchema.parse(existingRaw);
        if (record.transactionId !== transactionId || record.runId !== identity.runId || record.hostId !== identity.hostId
          || record.planDigest !== identity.planDigest || record.rootPackageKey !== authority.rootDescriptor.packageKey
          || record.authorityDigest !== admitted.authorityDigest
          || record.packages.length !== admitted.packages.length
          || record.packages.some((value, index) => value.packageKey !== admitted.packages[index]!.packageKey)) {
          throw new NativeDpkgTransactionError('persisted native dpkg transaction belongs to different authority');
        }
        if (record.phase === 'completed') {
          const states = await inspectAll(authority);
          if (states.every(value => value === 'configured')) return;
          throw new NativeDpkgTransactionError('completed native dpkg transaction postcondition drifted');
        }
      } else {
        const at = now();
        record = NativeDpkgTransactionRecordSchema.parse({
          schemaVersion: 1, kind: 'install-doctor-native-dpkg-transaction-record', transactionId,
          ...identity, rootPackageKey: authority.rootDescriptor.packageKey, authorityDigest: admitted.authorityDigest,
          phase: 'prepared',
          packages: admitted.packages.map(value => ({ packageKey: value.packageKey, packageName: value.packageName, version: value.version, architecture: value.architecture, phase: 'pending' })),
          serviceSnapshots: [], policyRecord: null, activePackageKey: null, failure: null, createdAt: at, updatedAt: at,
        });
        await options.persistence.save(record);
      }

      policy = await policyFactory(policyPersistence);
      if (record.policyRecord !== null && record.policyRecord.phase !== 'restored') {
        const reconciled = await policy.reconcile(record.policyRecord);
        await persist({ policyRecord: reconciled });
      }
      if (record.serviceSnapshots.length > 0) await restoreServices();

      await proveBoundary(record.phase !== 'prepared' && record.phase !== 'services-captured');
      if (record.serviceSnapshots.length === 0 && admitted.serviceUnits.length > 0) {
        const snapshots: SystemdServiceSnapshot[] = [];
        for (const unit of admitted.serviceUnits) snapshots.push(snapshotFor(unit, await serviceAdapter.capture(unit)));
        await persist({ phase: 'services-captured', serviceSnapshots: snapshots });
      } else if (record.phase === 'prepared') await persist({ phase: 'services-captured' });

      const prepared = await policy.prepare();
      if (record.policyRecord === null || record.policyRecord.phase === 'restored') await persist({ phase: 'policy-prepared', policyRecord: prepared });
      const active = await policy.activate(record.policyRecord ?? prepared);
      await persist({ phase: 'policy-active', policyRecord: active, failure: null });

      for (let index = 0; index < admitted.packages.length; index += 1) {
        const package_ = admitted.packages[index]!;
        let disposition = exactStateDisposition(await queryPackage(package_.packageName), package_, options.compareDebianVersions);
        if (disposition === 'configured') {
          const packages = record.packages.map((value, candidate) => candidate === index ? { ...value, phase: 'configured' as const } : value);
          await persist({ packages, phase: 'configured', activePackageKey: null });
          continue;
        }
        if (disposition === 'pending' || disposition === 'needs-unpack') {
          throwIfAborted(signal);
          await proveBoundary(disposition === 'needs-unpack');
          await persist({ phase: 'unpacking', activePackageKey: package_.packageKey, failure: null });
          const result = await executeWithHeartbeat(async () => await authority.withPayload(package_.packageKey, async (payload: FileHandle) => await executeDpkg({
            action: 'unpack', packageName: package_.packageName, payloadDescriptor: payload.fd,
          })));
          disposition = exactStateDisposition(await queryPackage(package_.packageName), package_, options.compareDebianVersions);
          if (result.code !== 0) {
            const observedPhase = disposition === 'configured' ? 'configured' as const
              : disposition === 'needs-configure' ? 'unpacked' as const : 'pending' as const;
            const packages = record.packages.map((value, candidate) => candidate === index ? { ...value, phase: observedPhase } : value);
            await persist({ packages, phase: observedPhase === 'configured' ? 'configured' : observedPhase === 'unpacked' ? 'unpacked' : 'unpacking', activePackageKey: null });
            throw new NativeDpkgTransactionError(`dpkg unpack failed for ${package_.packageKey}: ${result.stderr || `exit ${result.code}`}`);
          }
          const packages = record.packages.map((value, candidate) => candidate === index ? { ...value, phase: 'unpacked' as const } : value);
          await persist({ packages, phase: 'unpacked', activePackageKey: null });
          if (disposition !== 'needs-configure' && disposition !== 'configured') throw new NativeDpkgTransactionError(`dpkg unpack postcondition failed for ${package_.packageKey}`);
        }
        if (disposition === 'needs-configure') {
          throwIfAborted(signal);
          await proveBoundary(true);
          await persist({ phase: 'configuring', activePackageKey: package_.packageKey, failure: null });
          const result = await executeWithHeartbeat(async () => await executeDpkg({ action: 'configure', packageName: package_.packageName }));
          const configuredDisposition = exactStateDisposition(await queryPackage(package_.packageName), package_, options.compareDebianVersions);
          if (result.code !== 0) {
            const observedPhase = configuredDisposition === 'configured' ? 'configured' as const
              : configuredDisposition === 'needs-configure' ? 'unpacked' as const : 'pending' as const;
            const packages = record.packages.map((value, candidate) => candidate === index ? { ...value, phase: observedPhase } : value);
            await persist({ packages, phase: observedPhase === 'configured' ? 'configured' : observedPhase === 'unpacked' ? 'unpacked' : 'configuring', activePackageKey: null });
            throw new NativeDpkgTransactionError(`dpkg configure failed for ${package_.packageKey}: ${result.stderr || `exit ${result.code}`}`);
          }
          if (configuredDisposition !== 'configured') {
            throw new NativeDpkgTransactionError(`dpkg configure postcondition failed for ${package_.packageKey}`);
          }
          const packages = record.packages.map((value, candidate) => candidate === index ? { ...value, phase: 'configured' as const } : value);
          await persist({ packages, phase: 'configured', activePackageKey: null });
        }
      }
      await restoreServices();
      await restorePolicy();
      await proveBoundary(false);
      await persist({ phase: 'completed', activePackageKey: null, failure: null });
    } catch (error) {
      thrown = error;
      const cleanupErrors: string[] = [];
      if (record) {
        try { await restoreServices(); } catch (cleanupError) { cleanupErrors.push(`service restoration: ${boundedMessage(cleanupError)}`); }
        try { await restorePolicy(); } catch (cleanupError) { cleanupErrors.push(`policy restoration: ${boundedMessage(cleanupError)}`); }
        const aborted = signal?.aborted === true;
        const message = [boundedMessage(error), ...cleanupErrors].join('; ').slice(0, 1024);
        try {
          await persist({
            phase: 'blocked', activePackageKey: null,
            failure: { code: cleanupErrors.length > 0 ? 'cleanup-failed' : aborted ? 'cancelled' : 'runtime-failed', message },
          });
        } catch (persistenceError) { cleanupErrors.push(`failure persistence: ${boundedMessage(persistenceError)}`); }
        if (cleanupErrors.length > 0) thrown = new NativeDpkgTransactionError([boundedMessage(error), ...cleanupErrors].join('; ').slice(0, 1024), { cause: error });
      }
    } finally {
      try { await fence.release(owner); }
      catch (releaseError) {
        if (record?.phase === 'completed') {
          try {
            await persist({
              phase: 'blocked', activePackageKey: null,
              failure: { code: 'cleanup-failed', message: `global fence release: ${boundedMessage(releaseError)}` },
            });
          } catch (persistenceError) {
            releaseError = new NativeDpkgTransactionError(
              `${boundedMessage(releaseError)}; failure persistence: ${boundedMessage(persistenceError)}`,
              { cause: releaseError },
            );
          }
        }
        if (thrown === undefined) thrown = releaseError;
        else thrown = new NativeDpkgTransactionError(`${boundedMessage(thrown)}; fence release: ${boundedMessage(releaseError)}`, { cause: thrown });
      }
    }
    if (thrown !== undefined) throw thrown;
  };

  return Object.freeze({
    async check(authority: NativePackageRuntimeAuthority): Promise<Inspection> {
      if (authority.operation.action !== 'check') throw new NativeDpkgTransactionError('native runtime check requires check authority');
      throwIfAborted(authority.context?.signal);
      const dispositions = await inspectAll(authority);
      return dispositions.every(value => value === 'configured') ? 'verified' : 'needed';
    },
    async apply(authority: NativePackageRuntimeAuthority): Promise<void> {
      if (authority.operation.action !== 'apply') throw new NativeDpkgTransactionError('native runtime apply requires apply authority');
      await mutate(authority);
    },
    async verify(authority: NativePackageRuntimeAuthority): Promise<Verification> {
      if (authority.operation.action !== 'verify') throw new NativeDpkgTransactionError('native runtime verify requires verify authority');
      throwIfAborted(authority.context?.signal);
      const dispositions = await inspectAll(authority);
      return dispositions.every(value => value === 'configured') ? 'verified' : 'pending';
    },
  });
}
