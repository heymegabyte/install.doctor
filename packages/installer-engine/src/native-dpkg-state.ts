import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { z } from 'zod';

const DPKG_QUERY = '/usr/bin/dpkg-query';
const packageName = z.string().regex(/^[a-z0-9][a-z0-9+.-]{0,127}(?::(?:amd64|arm64|all))?$/);
const version = z.string().min(1).max(256).refine(value => !/[\0\r\n\x1f]/.test(value), 'invalid Debian version');
const architecture = z.enum(['amd64', 'arm64', 'all']);
const want = z.enum(['unknown', 'install', 'hold', 'deinstall', 'purge']);
const eflag = z.enum(['ok', 'reinstreq']);
const status = z.enum(['not-installed', 'config-files', 'half-installed', 'unpacked', 'half-configured', 'triggers-awaited', 'triggers-pending', 'installed']);

export class NativeDpkgStateError extends Error {
  constructor(message: string) { super(message); this.name = 'NativeDpkgStateError'; }
}

export interface DpkgPackageState {
  readonly packageName: string;
  readonly version: string;
  readonly architecture: 'amd64' | 'arm64' | 'all';
  readonly want: z.infer<typeof want>;
  readonly errorFlag: z.infer<typeof eflag>;
  readonly status: z.infer<typeof status>;
}

export type DpkgPackageAssessment =
  | { readonly disposition: 'verified'; readonly observed: DpkgPackageState }
  | { readonly disposition: 'needed'; readonly reason: 'absent' | 'version-drift'; readonly observed: DpkgPackageState | null }
  | { readonly disposition: 'blocked'; readonly reason: 'held-version-drift' | 'repair-required'; readonly observed: DpkgPackageState };

export interface DpkgQueryRunner {
  readonly query: (name: string, signal?: AbortSignal) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
}

export function parseDpkgQueryState(stdout: string): DpkgPackageState {
  if (stdout.length === 0 || stdout.length > 4096 || /[\0\r]/.test(stdout)) throw new NativeDpkgStateError('dpkg-query output is empty, oversized, or contains unsafe controls');
  const lines = stdout.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 1) throw new NativeDpkgStateError('dpkg-query must return exactly one package record');
  const fields = lines[0]!.split('\x1f');
  if (fields.length !== 6) throw new NativeDpkgStateError('dpkg-query record has an unexpected field count');
  return Object.freeze({
    packageName: packageName.parse(fields[0]), version: version.parse(fields[1]), architecture: architecture.parse(fields[2]),
    want: want.parse(fields[3]), errorFlag: eflag.parse(fields[4]), status: status.parse(fields[5]),
  });
}

export function assessDpkgPackageState(input: {
  readonly observed: DpkgPackageState | null;
  readonly expectedName: string;
  readonly expectedVersion: string;
  readonly expectedArchitecture: 'amd64' | 'arm64' | 'all';
}): DpkgPackageAssessment {
  const expectedName = packageName.parse(input.expectedName);
  const expectedVersion = version.parse(input.expectedVersion);
  const expectedArchitecture = architecture.parse(input.expectedArchitecture);
  const observed = input.observed;
  if (observed === null || observed.status === 'not-installed' || observed.status === 'config-files') {
    return Object.freeze({ disposition: 'needed', reason: 'absent', observed });
  }
  if (observed.packageName !== expectedName || observed.architecture !== expectedArchitecture) {
    throw new NativeDpkgStateError('dpkg-query returned a different package identity than requested');
  }
  if (observed.errorFlag !== 'ok' || observed.status !== 'installed' || !['install', 'hold'].includes(observed.want)) {
    return Object.freeze({ disposition: 'blocked', reason: 'repair-required', observed });
  }
  if (observed.version !== expectedVersion) {
    return observed.want === 'hold'
      ? Object.freeze({ disposition: 'blocked', reason: 'held-version-drift', observed })
      : Object.freeze({ disposition: 'needed', reason: 'version-drift', observed });
  }
  return Object.freeze({ disposition: 'verified', observed });
}

async function assertTrustedDpkgQuery(): Promise<void> {
  let metadata: Awaited<ReturnType<typeof lstat>>; let canonical: string;
  try {
    [metadata, canonical] = await Promise.all([lstat(DPKG_QUERY), realpath(DPKG_QUERY)]);
    await access(DPKG_QUERY, constants.X_OK);
  } catch { throw new NativeDpkgStateError('fixed dpkg-query executable is unavailable'); }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0 || canonical !== DPKG_QUERY) {
    throw new NativeDpkgStateError('fixed dpkg-query executable is not trusted');
  }
}

export function createNativeDpkgQueryRunner(): DpkgQueryRunner {
  return Object.freeze({
    query: async (nameInput: string, signal?: AbortSignal) => {
      const name = packageName.parse(nameInput);
      await assertTrustedDpkgQuery();
      return await new Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>((resolve, reject) => {
        const child = spawn(DPKG_QUERY, [
          '--show', `--showformat=\${Package}\x1f\${Version}\x1f\${Architecture}\x1f\${db:Status-Want}\x1f\${db:Status-Eflag}\x1f\${db:Status-Status}\n`, '--', name,
        ], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' }, signal });
        let stdout = ''; let stderr = ''; let overflow = false;
        const timer = setTimeout(() => { overflow = true; child.kill('SIGKILL'); }, 10_000); timer.unref();
        const append = (current: string, chunk: Buffer): string => {
          const next = current + chunk.toString('utf8');
          if (next.length > 4096) { overflow = true; child.kill('SIGKILL'); }
          return next.slice(0, 4097);
        };
        child.stdout!.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
        child.stderr!.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => {
          clearTimeout(timer);
          if (overflow) return reject(new NativeDpkgStateError('dpkg-query timed out or exceeded its output bound'));
          resolve(Object.freeze({ code: code ?? 255, stdout, stderr }));
        });
      });
    },
  });
}

export async function inspectDpkgPackage(input: {
  readonly runner: DpkgQueryRunner;
  readonly packageName: string;
  readonly version: string;
  readonly architecture: 'amd64' | 'arm64' | 'all';
  readonly signal?: AbortSignal;
}): Promise<DpkgPackageAssessment> {
  const result = await input.runner.query(input.packageName, input.signal);
  if (result.code === 1 && result.stdout.length === 0) {
    return assessDpkgPackageState({ observed: null, expectedName: input.packageName, expectedVersion: input.version, expectedArchitecture: input.architecture });
  }
  if (result.code !== 0) throw new NativeDpkgStateError(`dpkg-query failed with exit ${result.code}`);
  return assessDpkgPackageState({
    observed: parseDpkgQueryState(result.stdout), expectedName: input.packageName,
    expectedVersion: input.version, expectedArchitecture: input.architecture,
  });
}
