import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { HostFactsSchema } from './contracts.js';
import type { HostFacts } from './contracts.js';

const MACHINE_ID_PATH = '/etc/machine-id';
const OS_RELEASE_PATHS = ['/etc/os-release', '/usr/lib/os-release'] as const;
const MAX_MACHINE_ID_BYTES = 128;
const MAX_OS_RELEASE_BYTES = 64 * 1024;
const MAX_PROBE_BYTES = 64 * 1024;

const SUPPORTED_DISTRIBUTIONS = new Set([
  'alpine', 'arch', 'debian', 'fedora', 'opensuse', 'opensuse-leap', 'rhel', 'ubuntu',
]);

const PACKAGE_MANAGER_PROBES = [
  { id: 'apk', paths: ['/sbin/apk', '/usr/sbin/apk'] },
  { id: 'apt', paths: ['/usr/bin/apt-get'] },
  { id: 'dnf', paths: ['/usr/bin/dnf', '/usr/bin/dnf5'] },
  { id: 'pacman', paths: ['/usr/bin/pacman'] },
  { id: 'rpm-ostree', paths: ['/usr/bin/rpm-ostree'] },
  { id: 'yum', paths: ['/usr/bin/yum'] },
  { id: 'zypper', paths: ['/usr/bin/zypper'] },
] as const;

const CAPABILITY_PROBES = [
  { id: 'containers.docker', paths: ['/usr/bin/docker', '/usr/local/bin/docker'] },
  { id: 'containers.podman', paths: ['/usr/bin/podman'] },
  { id: 'filesystem.zfs', paths: ['/usr/sbin/zfs', '/sbin/zfs'] },
  { id: 'qubes.integration', paths: ['/usr/bin/qubesdb-read'] },
  { id: 'service-manager.systemd', paths: ['/usr/bin/systemctl', '/bin/systemctl'] },
  { id: 'virtualization.proxmox', paths: ['/usr/sbin/qm', '/usr/sbin/pct'] },
] as const;

export interface LinuxHostReadOptions {
  readonly maxBytes: number;
  readonly requireProtected: boolean;
}

export interface LinuxOfflineHostFactDependencies {
  readonly platform?: NodeJS.Platform | string;
  readonly arch?: string;
  readonly now?: () => string;
  readonly readFile?: (path: string, options: LinuxHostReadOptions) => Promise<string>;
  readonly pathExists?: (path: string, expectation: 'protected' | 'protected-executable') => Promise<boolean>;
}

interface OsRelease {
  readonly [key: string]: string;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP');
}

async function defaultReadFile(path: string, options: LinuxHostReadOptions): Promise<string> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) throw new Error('read bound must be positive');
  // Node opens descriptors close-on-exec; O_NOFOLLOW prevents path substitution.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`host fact source is not a regular file: ${path}`);
    if (options.requireProtected
      && (before.uid !== 0 || (before.mode & 0o022) !== 0 || before.nlink !== 1)) {
      throw new Error(`host fact source is not a protected root-owned regular file: ${path}`);
    }
    if (before.size > options.maxBytes) throw new Error(`host fact source exceeds its read bound: ${path}`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= options.maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(8_192, options.maxBytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > options.maxBytes) throw new Error(`host fact source exceeds its read bound: ${path}`);
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode
      || before.uid !== after.uid || before.nlink !== after.nlink) {
      throw new Error(`host fact source changed while being read: ${path}`);
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function defaultPathExists(
  path: string,
  expectation: 'protected' | 'protected-executable',
): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) return false;
    if (metadata.uid !== 0 || (metadata.mode & 0o022) !== 0) return false;
    return expectation !== 'protected-executable'
      || (metadata.isFile() && (metadata.mode & 0o111) !== 0);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Matches the immutable identity derivation used by createLinuxOfflineHostAttestor. */
export function deriveLinuxImmutableHostId(rawMachineId: string): string {
  const value = rawMachineId.trim();
  if (!/^[a-f0-9]{32}$/.test(value) || /^0+$/.test(value)) {
    throw new Error('Linux machine identity source is invalid');
  }
  return `linux-${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function parseQuotedValue(value: string, lineNumber: number): string {
  if (value.length < 2 || value.at(-1) !== '"') {
    throw new Error(`unterminated quoted os-release value on line ${lineNumber}`);
  }
  const body = value.slice(1, -1);
  let parsed = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character !== '\\') {
      if (character === '\u0000' || character === '\n' || character === '\r') {
        throw new Error(`invalid control character in os-release line ${lineNumber}`);
      }
      parsed += character;
      continue;
    }
    const escaped = body[index + 1];
    if (escaped === undefined || !['\\', '"', '$', '`'].includes(escaped)) {
      throw new Error(`unsupported escape in os-release line ${lineNumber}`);
    }
    parsed += escaped;
    index += 1;
  }
  return parsed;
}

/** Parses os-release as bounded inert data; it never invokes or emulates a shell. */
export function parseLinuxOsRelease(input: string): OsRelease {
  if (Buffer.byteLength(input, 'utf8') > MAX_OS_RELEASE_BYTES) throw new Error('os-release exceeds its read bound');
  const result: Record<string, string> = {};
  const lines = input.split(/\r?\n/);
  if (lines.length > 1_024) throw new Error('os-release has too many lines');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line === '' || /^\s*#/.test(line)) continue;
    if (line.length > 4_096) throw new Error(`os-release line ${index + 1} exceeds its bound`);
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`invalid os-release assignment on line ${index + 1}`);
    const [, key, encodedValue] = match;
    if (key === undefined || encodedValue === undefined) throw new Error(`invalid os-release line ${index + 1}`);
    if (Object.hasOwn(result, key)) throw new Error(`duplicate os-release key: ${key}`);
    if (encodedValue.startsWith('"')) {
      result[key] = parseQuotedValue(encodedValue, index + 1);
    } else {
      if (!/^[A-Za-z0-9._+:/@%-]*$/.test(encodedValue)) {
        throw new Error(`invalid unquoted os-release value on line ${index + 1}`);
      }
      result[key] = encodedValue;
    }
  }
  return Object.freeze(result);
}

async function optionalRead(
  readFile: (path: string, options: LinuxHostReadOptions) => Promise<string>,
  path: string,
): Promise<string | undefined> {
  try {
    return await readFile(path, { maxBytes: MAX_PROBE_BYTES, requireProtected: false });
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function firstExecutable(
  pathExists: LinuxOfflineHostFactDependencies['pathExists'] & {},
  paths: readonly string[],
): Promise<boolean> {
  for (const path of paths) if (await pathExists(path, 'protected-executable')) return true;
  return false;
}

async function detectEnvironment(
  readFile: (path: string, options: LinuxHostReadOptions) => Promise<string>,
  pathExists: LinuxOfflineHostFactDependencies['pathExists'] & {},
): Promise<HostFacts['environment']> {
  const [kernelRelease, kernelVersion, systemdContainer, cgroup, proxmox, qubes, containerMarker] = await Promise.all([
    optionalRead(readFile, '/proc/sys/kernel/osrelease'),
    optionalRead(readFile, '/proc/version'),
    optionalRead(readFile, '/run/systemd/container'),
    optionalRead(readFile, '/proc/1/cgroup'),
    pathExists('/etc/pve', 'protected'),
    Promise.all([
      pathExists('/etc/qubes-release', 'protected'),
      pathExists('/usr/share/qubes/marker-vm', 'protected'),
    ]).then(values => values.some(Boolean)),
    Promise.all([
      pathExists('/.dockerenv', 'protected'),
      pathExists('/run/.containerenv', 'protected'),
    ]).then(values => values.some(Boolean)),
  ]);
  const evidence: Array<HostFacts['environment']> = [];
  if (/microsoft|wsl/i.test(`${kernelRelease ?? ''}\n${kernelVersion ?? ''}`)) evidence.push('wsl');
  if (proxmox) evidence.push('proxmox');
  if (qubes) evidence.push('qubes');
  if (containerMarker
    || (systemdContainer !== undefined && !/^\s*(?:|none)\s*$/i.test(systemdContainer))
    || /(?:docker|kubepods|containerd|lxc|podman)/i.test(cgroup ?? '')) evidence.push('container');
  const distinct = [...new Set(evidence)];
  if (distinct.length > 1) throw new Error(`ambiguous Linux environment evidence: ${distinct.sort().join(', ')}`);
  return distinct[0] ?? 'native';
}

/** Collects current Linux facts without network access, PATH lookup, or shell evaluation. */
export async function collectLinuxOfflineHostFacts(
  dependencies: LinuxOfflineHostFactDependencies = {},
): Promise<HostFacts> {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'linux') throw new Error(`Offline host-facts collector requires Linux, not ${platform}`);
  const arch = dependencies.arch ?? process.arch;
  if (arch !== 'x64' && arch !== 'arm64') throw new Error(`unsupported Linux architecture: ${arch}`);
  const readFile = dependencies.readFile ?? defaultReadFile;
  const pathExists = dependencies.pathExists ?? defaultPathExists;
  const machineId = await readFile(MACHINE_ID_PATH, {
    maxBytes: MAX_MACHINE_ID_BYTES, requireProtected: true,
  });
  const hostId = deriveLinuxImmutableHostId(machineId);

  let osReleaseRaw: string | undefined;
  for (const path of OS_RELEASE_PATHS) {
    try {
      osReleaseRaw = await readFile(path, { maxBytes: MAX_OS_RELEASE_BYTES, requireProtected: true });
      break;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  if (osReleaseRaw === undefined) throw new Error('no protected Linux os-release authority is available');
  const osRelease = parseLinuxOsRelease(osReleaseRaw);
  const distribution = osRelease.ID?.toLowerCase();
  if (!distribution || !SUPPORTED_DISTRIBUTIONS.has(distribution)) {
    throw new Error(`unsupported Linux distribution: ${distribution ?? 'missing ID'}`);
  }
  const osVersion = osRelease.VERSION_ID;
  if (!osVersion) throw new Error('Linux os-release requires VERSION_ID');

  const environment = await detectEnvironment(readFile, pathExists);
  const packageManagers: string[] = [];
  for (const probe of PACKAGE_MANAGER_PROBES) {
    if (await firstExecutable(pathExists, probe.paths)) packageManagers.push(probe.id);
  }
  const capabilities: string[] = [];
  for (const probe of CAPABILITY_PROBES) {
    if (await firstExecutable(pathExists, probe.paths)) capabilities.push(probe.id);
  }
  const roles = [distribution, ...(environment === 'native' ? [] : [environment])];
  return HostFactsSchema.parse({
    schemaVersion: 1,
    hostId,
    collectedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    os: 'linux',
    osVersion,
    arch,
    environment,
    roles: [...new Set(roles)].sort(),
    packageManagers: [...new Set(packageManagers)].sort(),
    capabilities: [...new Set(capabilities)].sort(),
  });
}
