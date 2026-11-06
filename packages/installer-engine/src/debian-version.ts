import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';

import { z } from 'zod';

import type { DebianVersionComparator } from './debian-relationships.js';

const DPKG = '/usr/bin/dpkg' as const;
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 16_384;
const debianVersion = z.string().min(1).max(128).regex(/^[0-9][A-Za-z0-9.+:~-]*$/);

type DpkgRunOptions = SpawnSyncOptions & {
  readonly encoding?: undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly timeout: number;
  readonly maxBuffer: number;
};

export interface DebianVersionProcessResult {
  readonly status: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly error?: Error;
  readonly stdout?: Buffer;
  readonly stderr?: Buffer;
}

export interface TrustedDebianVersionComparatorOptions {
  /** Injectable only so the fixed authority and process contract can be unit tested. */
  readonly assertTrustedExecutable?: (executable: typeof DPKG) => Promise<void>;
  readonly run?: (
    executable: typeof DPKG,
    arguments_: readonly string[],
    options: DpkgRunOptions,
  ) => DebianVersionProcessResult;
  readonly timeoutMilliseconds?: number;
  readonly maximumOutputBytes?: number;
}

export class DebianVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebianVersionError';
  }
}

function positiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new DebianVersionError(`${label} must be a positive safe integer`);
  }
  return value;
}

async function assertTrustedDpkgExecutable(executable: typeof DPKG): Promise<void> {
  try {
    const [metadata, canonical] = await Promise.all([lstat(executable), realpath(executable)]);
    await access(executable, constants.X_OK);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink < 1
      || metadata.uid !== 0 || (metadata.mode & 0o022) !== 0 || canonical !== executable) {
      throw new Error('unsafe executable metadata');
    }
  } catch {
    throw new DebianVersionError(`${executable} is not a trusted fixed root-owned executable`);
  }
}

function defaultRun(
  executable: typeof DPKG,
  arguments_: readonly string[],
  options: DpkgRunOptions,
): SpawnSyncReturns<Buffer> {
  return spawnSync(executable, [...arguments_], options);
}

function validatedVersion(input: string, side: 'left' | 'right'): string {
  const result = debianVersion.safeParse(input);
  if (!result.success) throw new DebianVersionError(`${side} Debian version is malformed or exceeds its bound`);
  return result.data;
}

function comparePredicate(input: {
  readonly run: NonNullable<TrustedDebianVersionComparatorOptions['run']>;
  readonly left: string;
  readonly relation: 'lt' | 'gt';
  readonly right: string;
  readonly options: DpkgRunOptions;
}): boolean {
  let result: DebianVersionProcessResult;
  try {
    result = input.run(DPKG, ['--compare-versions', input.left, input.relation, input.right], input.options);
  } catch {
    throw new DebianVersionError('fixed dpkg version comparison could not start');
  }
  if (result.error) {
    const code = 'code' in result.error && typeof result.error.code === 'string' ? result.error.code : '';
    if (code === 'ETIMEDOUT') throw new DebianVersionError('fixed dpkg version comparison timed out');
    throw new DebianVersionError('fixed dpkg version comparison could not start');
  }
  if (result.signal !== undefined && result.signal !== null) {
    throw new DebianVersionError('fixed dpkg version comparison was terminated by a signal');
  }
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  if (result.status === 2) throw new DebianVersionError('fixed dpkg version comparison reported an invocation error');
  throw new DebianVersionError('fixed dpkg version comparison returned an impossible status');
}

/**
 * Establish trust in the host's canonical dpkg once, then expose Debian's own
 * synchronous version ordering primitive to the pure dependency validator.
 */
export async function createTrustedDebianVersionComparator(
  input: TrustedDebianVersionComparatorOptions = {},
): Promise<DebianVersionComparator> {
  const timeout = positiveBound(input.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS, 'timeoutMilliseconds');
  const maxBuffer = positiveBound(input.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES, 'maximumOutputBytes');
  const assertTrustedExecutable = input.assertTrustedExecutable ?? assertTrustedDpkgExecutable;
  try {
    await assertTrustedExecutable(DPKG);
  } catch (error) {
    if (error instanceof DebianVersionError) throw error;
    throw new DebianVersionError(`${DPKG} is not a trusted fixed root-owned executable`);
  }
  const run = input.run ?? defaultRun;
  const processOptions: DpkgRunOptions = Object.freeze({
    env: Object.freeze({ LANG: 'C', LC_ALL: 'C' }),
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer,
  });

  return (leftInput: string, rightInput: string): number => {
    const left = validatedVersion(leftInput, 'left');
    const right = validatedVersion(rightInput, 'right');
    if (comparePredicate({ run, left, relation: 'lt', right, options: processOptions })) return -1;
    if (comparePredicate({ run, left, relation: 'gt', right, options: processOptions })) return 1;
    return 0;
  };
}
