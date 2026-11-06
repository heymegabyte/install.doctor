import { lstat, readlink, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { runProcess } from './process-runner.js';

const BUBBLEWRAP = '/usr/bin/bwrap';
const READLINK = '/usr/bin/readlink';
const namespaceIdentity = z.string().regex(/^net:\[[0-9]+\]$/);

type ExecutableInspection = {
  regular: boolean;
  symbolicLink: boolean;
  uid: number;
  mode: number;
};

type SandboxRunRequest = {
  purpose: 'probe' | 'operation';
  argv: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput?: (stream: 'stdout' | 'stderr', line: string) => void;
  fileDescriptors?: number[];
};

export type SandboxRunResult = { exitCode: number; stdout: string; stderr: string };

export type OfflineSandboxDependencies = {
  platform: NodeJS.Platform | string;
  effectiveUserId: number;
  effectiveGroupId: number;
  inspectExecutable(path: string): Promise<ExecutableInspection>;
  hostNetworkNamespace(): Promise<string>;
  run(request: SandboxRunRequest): Promise<SandboxRunResult>;
};

export type OfflineSandboxCapability =
  | { supported: false; platform: string; reason: string }
  | {
    supported: true;
    platform: 'linux';
    kind: 'linux-bubblewrap-network-namespace';
    executablePath: typeof BUBBLEWRAP;
    hostNetworkNamespace: string;
    isolatedNetworkNamespace: string;
  };

export class OfflineSandboxUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'OfflineSandboxUnavailableError'; }
}

function trustedSystemExecutable(metadata: ExecutableInspection): boolean {
  return metadata.regular && !metadata.symbolicLink && metadata.uid === 0 && (metadata.mode & 0o022) === 0;
}

const defaultDependencies: OfflineSandboxDependencies = {
  platform: process.platform,
  effectiveUserId: process.geteuid?.() ?? 0,
  effectiveGroupId: process.getegid?.() ?? 0,
  inspectExecutable: async path => {
    const metadata = await lstat(path);
    return {
      regular: metadata.isFile(), symbolicLink: metadata.isSymbolicLink(), uid: metadata.uid, mode: metadata.mode,
    };
  },
  hostNetworkNamespace: async () => readlink('/proc/self/ns/net'),
  run: async request => {
    let stdout = '';
    let stderr = '';
    const append = (stream: 'stdout' | 'stderr', line: string): void => {
      if (stream === 'stdout' && stdout.length < 65_536) stdout += `${line}\n`;
      if (stream === 'stderr' && stderr.length < 65_536) stderr += `${line}\n`;
      request.onOutput?.(stream, line);
    };
    const exitCode = await runProcess({
      argv: request.argv, timeoutMs: request.timeoutMs, terminationGraceMs: 1_000,
      cwd: '/', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.fileDescriptors ? { inheritedFileDescriptors: request.fileDescriptors } : {}),
      onOutput: (stream, line) => append(stream, line),
    });
    return { exitCode, stdout, stderr };
  },
};

export async function probeOfflineSandbox(
  dependencies: OfflineSandboxDependencies = defaultDependencies,
): Promise<OfflineSandboxCapability> {
  if (dependencies.platform !== 'linux') {
    return {
      supported: false, platform: dependencies.platform,
      reason: `offline execution sandbox is unsupported on ${dependencies.platform}`,
    };
  }
  if (dependencies.effectiveUserId === 0) {
    return { supported: false, platform: 'linux', reason: 'offline user operations refuse a root effective user' };
  }
  try {
    const [bubblewrap, readlinkExecutable] = await Promise.all([
      dependencies.inspectExecutable(BUBBLEWRAP), dependencies.inspectExecutable(READLINK),
    ]);
    if (!trustedSystemExecutable(bubblewrap) || !trustedSystemExecutable(readlinkExecutable)) {
      return { supported: false, platform: 'linux', reason: 'offline sandbox requires trusted root-owned Bubblewrap and readlink executables' };
    }
    const hostNetworkNamespace = namespaceIdentity.parse((await dependencies.hostNetworkNamespace()).trim());
    const probe = await dependencies.run({
      purpose: 'probe', timeoutMs: 5_000,
      argv: [
        BUBBLEWRAP, '--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-uts', '--unshare-cgroup', '--unshare-net',
        '--uid', String(dependencies.effectiveUserId), '--gid', String(dependencies.effectiveGroupId), '--cap-drop', 'ALL',
        '--die-with-parent', '--new-session', '--ro-bind-try', '/usr', '/usr', '--ro-bind-try', '/bin', '/bin',
        '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev',
        '--tmpfs', '/tmp', '--', READLINK, '/proc/self/ns/net',
      ],
    });
    if (probe.exitCode !== 0) {
      return { supported: false, platform: 'linux', reason: 'Bubblewrap network namespace probe failed' };
    }
    const isolatedNetworkNamespace = namespaceIdentity.parse(probe.stdout.trim());
    if (isolatedNetworkNamespace === hostNetworkNamespace) {
      return { supported: false, platform: 'linux', reason: 'Bubblewrap did not isolate the host network namespace' };
    }
    return {
      supported: true, platform: 'linux', kind: 'linux-bubblewrap-network-namespace', executablePath: BUBBLEWRAP,
      hostNetworkNamespace, isolatedNetworkNamespace,
    };
  } catch (error) {
    return {
      supported: false, platform: 'linux',
      reason: `offline sandbox capability could not be proven: ${error instanceof Error ? error.message : 'unknown failure'}`,
    };
  }
}

export type OfflineSandboxOperation = {
  materializedRoot: string;
  executableFileDescriptor: number;
  artifactFileDescriptors: Array<{ argumentIndex: number; fileDescriptor: number }>;
  arguments: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput?: (stream: 'stdout' | 'stderr', line: string) => void;
};

export type OfflineSandboxRuntime = {
  probe(): Promise<OfflineSandboxCapability>;
  execute(operation: OfflineSandboxOperation): Promise<SandboxRunResult>;
};

export function createOfflineSandboxRuntime(dependencies: OfflineSandboxDependencies = defaultDependencies): OfflineSandboxRuntime {
  return {
    probe: async () => probeOfflineSandbox(dependencies),
    execute: async operation => {
      if (dependencies.platform !== 'linux') {
        throw new OfflineSandboxUnavailableError(`offline execution sandbox is unsupported on ${dependencies.platform}`);
      }
      if (!isAbsolute(operation.materializedRoot)) {
        throw new OfflineSandboxUnavailableError('offline sandbox paths must be absolute');
      }
      const rootMetadata = await lstat(operation.materializedRoot);
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
        throw new OfflineSandboxUnavailableError('materialized bundle root must be a real directory');
      }
      await realpath(operation.materializedRoot);
      if (!Number.isInteger(operation.executableFileDescriptor) || operation.executableFileDescriptor < 0) {
        throw new OfflineSandboxUnavailableError('offline executable requires an already verified file descriptor');
      }
      const argumentsList = z.array(z.string().max(4096).refine(value => !value.includes('\0'))).max(128).parse(operation.arguments);
      const artifactDescriptors = z.array(z.strictObject({
        argumentIndex: z.number().int().nonnegative(), fileDescriptor: z.number().int().nonnegative(),
      })).max(128).parse(operation.artifactFileDescriptors);
      if (new Set(artifactDescriptors.map(item => item.argumentIndex)).size !== artifactDescriptors.length
        || artifactDescriptors.some(item => item.argumentIndex >= argumentsList.length)) {
        throw new OfflineSandboxUnavailableError('offline artifact descriptor mapping is invalid');
      }
      const timeoutMs = z.number().int().min(100).max(86_400_000).parse(operation.timeoutMs);
      const capability = await probeOfflineSandbox(dependencies);
      if (!capability.supported) throw new OfflineSandboxUnavailableError(capability.reason);
      const fileDescriptors = [operation.executableFileDescriptor, ...artifactDescriptors.map(item => item.fileDescriptor)];
      const sandboxArguments = [...argumentsList];
      artifactDescriptors.forEach((item, index) => { sandboxArguments[item.argumentIndex] = `/run/install-doctor/artifact-${index}`; });
      const descriptorBinds = fileDescriptors.flatMap((_, index) => [
        '--ro-bind', `/proc/self/fd/${index + 3}`, index === 0 ? '/run/install-doctor/operation' : `/run/install-doctor/artifact-${index - 1}`,
      ]);
      return dependencies.run({
        purpose: 'operation', timeoutMs,
        argv: [
          capability.executablePath, '--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-uts', '--unshare-cgroup', '--unshare-net',
          '--uid', String(dependencies.effectiveUserId), '--gid', String(dependencies.effectiveGroupId), '--cap-drop', 'ALL',
          '--die-with-parent', '--new-session', '--ro-bind-try', '/usr', '/usr', '--ro-bind-try', '/bin', '/bin',
          '--ro-bind-try', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev',
          '--tmpfs', '/tmp', '--dir', '/run', '--dir', '/run/install-doctor', ...descriptorBinds,
          '--preserve-fds', String(fileDescriptors.length), '--chdir', '/run/install-doctor',
          '--', '/run/install-doctor/operation', ...sandboxArguments,
        ],
        fileDescriptors,
        ...(operation.signal ? { signal: operation.signal } : {}),
        ...(operation.onOutput ? { onOutput: operation.onOutput } : {}),
      });
    },
  };
}

const defaultRuntime = createOfflineSandboxRuntime();

export async function runOfflineSandboxedOperation(operation: OfflineSandboxOperation): Promise<SandboxRunResult> {
  return defaultRuntime.execute(operation);
}
