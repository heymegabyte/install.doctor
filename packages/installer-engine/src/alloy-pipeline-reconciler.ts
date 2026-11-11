import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DEFAULT_MAX_MODULE_BYTES = 1_048_576;
const MAX_DIAGNOSTIC_BYTES = 16_384;

export interface AlloyModuleCandidate {
  readonly revision: string;
  readonly sha256: string;
  readonly content: Uint8Array;
}

export interface AlloyPipelinePaths {
  readonly root: string;
  readonly localConfig: string;
  readonly effectiveModule: string;
  readonly lastValidState: string;
  readonly rejectionLog: string;
}

export interface AlloyModuleAdmissionOptions {
  readonly alloyBinary: string;
  readonly root: string;
  readonly localConfig: string;
  readonly candidate: AlloyModuleCandidate;
  readonly maxModuleBytes?: number;
  readonly now?: () => Date;
}

export interface AlloyLastValidState {
  readonly schemaVersion: 1;
  readonly revision: string;
  readonly moduleSha256: string;
  readonly activatedAt: string;
  readonly alloyBinary: string;
}

export type AlloyModuleAdmission =
  | { readonly status: 'activated'; readonly state: AlloyLastValidState }
  | {
      readonly status: 'rejected';
      readonly revision: string;
      readonly candidateSha256: string;
      readonly retained: AlloyLastValidState | null;
      readonly diagnostics: string;
    };

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function digest(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function assertInside(root: string, candidate: string): void {
  const normalizedRoot = `${resolve(root)}/`;
  if (!resolve(candidate).startsWith(normalizedRoot)) {
    throw new Error(`managed Alloy path escapes root: ${candidate}`);
  }
}

async function assertRegularOrAbsent(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`managed Alloy path is not a regular file: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function atomicWrite(path: string, content: Uint8Array | string, mode: number): Promise<void> {
  await assertRegularOrAbsent(path);
  const temporary = join(dirname(path), `.${path.split('/').at(-1) ?? 'alloy'}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { mode, flag: 'wx' });
    const handle = await open(temporary, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await chmod(path, mode);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function run(binary: string, args: readonly string[]): Promise<CommandResult> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', code => resolvePromise({
      code: code ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

function cleanDiagnostics(result: CommandResult): string {
  // Alloy prints offending source lines after diagnostics. Persist only bounded error headings so remote content or credentials
  // cannot be copied into operational evidence.
  const headings = `${result.stderr}${result.stdout}`.split(/\r?\n/u)
    .filter(line => /^(Error:|error\b)/iu.test(line.trim()))
    .map(line => line.replace(/[\u0000-\u001f\u007f]/gu, '').trim());
  return (headings.length > 0 ? headings.join('\n') : 'Alloy validation failed')
    .slice(0, MAX_DIAGNOSTIC_BYTES);
}

export function alloyPipelinePaths(root: string): AlloyPipelinePaths {
  const resolvedRoot = resolve(root);
  return {
    root: resolvedRoot,
    localConfig: join(resolvedRoot, 'config.alloy'),
    effectiveModule: join(resolvedRoot, 'remote.effective.alloy'),
    lastValidState: join(resolvedRoot, 'last-valid.json'),
    rejectionLog: join(resolvedRoot, 'rejections.ndjson'),
  };
}

export async function readAlloyLastValidState(root: string): Promise<AlloyLastValidState | null> {
  const { lastValidState } = alloyPipelinePaths(root);
  try {
    const value = JSON.parse(await readFile(lastValidState, 'utf8')) as Partial<AlloyLastValidState>;
    if (value.schemaVersion !== 1 || typeof value.revision !== 'string'
      || typeof value.moduleSha256 !== 'string' || !SHA256_PATTERN.test(value.moduleSha256)
      || typeof value.activatedAt !== 'string' || typeof value.alloyBinary !== 'string') {
      throw new Error('invalid Alloy last-valid state');
    }
    return value as AlloyLastValidState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function appendRejection(path: string, evidence: object): Promise<void> {
  await assertRegularOrAbsent(path);
  const handle = await open(path, 'a', 0o600);
  try {
    await handle.write(`${JSON.stringify(evidence)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

export async function admitAlloyRemoteModule(options: AlloyModuleAdmissionOptions): Promise<AlloyModuleAdmission> {
  const paths = alloyPipelinePaths(options.root);
  const localConfig = resolve(options.localConfig);
  assertInside(paths.root, localConfig);
  if (localConfig !== paths.localConfig) throw new Error('local Alloy configuration must be the managed root config');
  if (!REVISION_PATTERN.test(options.candidate.revision)) throw new Error('invalid remote module revision');
  if (!SHA256_PATTERN.test(options.candidate.sha256)) throw new Error('invalid remote module SHA-256');
  if (options.candidate.content.byteLength === 0
    || options.candidate.content.byteLength > (options.maxModuleBytes ?? DEFAULT_MAX_MODULE_BYTES)) {
    throw new Error('remote Alloy module violates size policy');
  }
  const candidateSha256 = digest(options.candidate.content);
  if (candidateSha256 !== options.candidate.sha256) throw new Error('remote Alloy module digest mismatch');

  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(paths.root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('managed Alloy root is not a real directory');
  await chmod(paths.root, 0o700);
  await Promise.all([paths.localConfig, paths.effectiveModule, paths.lastValidState, paths.rejectionLog]
    .map(assertRegularOrAbsent));

  const stagedModule = join(paths.root, `.remote.${options.candidate.revision}.${randomUUID()}.alloy`);
  const stagedConfig = join(paths.root, `.config.${options.candidate.revision}.${randomUUID()}.alloy`);
  const localBytes = await readFile(paths.localConfig);
  const effectiveReference = JSON.stringify(paths.effectiveModule);
  const stagedReference = JSON.stringify(stagedModule);
  const localText = localBytes.toString('utf8');
  if (!localText.includes(effectiveReference)) {
    throw new Error('local Alloy configuration does not reference the managed effective module');
  }

  try {
    await writeFile(stagedModule, options.candidate.content, { mode: 0o600, flag: 'wx' });
    await writeFile(stagedConfig, localText.replaceAll(effectiveReference, stagedReference), { mode: 0o600, flag: 'wx' });
    // Alloy's root-config validator resolves the imported namespace but does not reliably surface parser failures in the
    // imported file on every supported release. Validate both the module itself and the composed root explicitly.
    const moduleValidation = await run(options.alloyBinary, [
      'validate', '--stability.level=generally-available', stagedModule,
    ]);
    const validation = moduleValidation.code === 0 ? await run(options.alloyBinary, [
      'validate', '--stability.level=generally-available', stagedConfig,
    ]) : moduleValidation;
    if (validation.code !== 0) {
      const retained = await readAlloyLastValidState(paths.root);
      const diagnostics = cleanDiagnostics(validation);
      await appendRejection(paths.rejectionLog, {
        schemaVersion: 1,
        rejectedAt: (options.now ?? (() => new Date()))().toISOString(),
        revision: options.candidate.revision,
        candidateSha256,
        retainedRevision: retained?.revision ?? null,
        retainedSha256: retained?.moduleSha256 ?? null,
        reason: 'alloy-validation-failed',
        diagnostics,
      });
      return { status: 'rejected', revision: options.candidate.revision, candidateSha256, retained, diagnostics };
    }

    // Validation precedes the sole mutation of the effective module. Invalid remote bytes never enter Alloy's watched path.
    await atomicWrite(paths.effectiveModule, options.candidate.content, 0o600);
    const state: AlloyLastValidState = {
      schemaVersion: 1,
      revision: options.candidate.revision,
      moduleSha256: candidateSha256,
      activatedAt: (options.now ?? (() => new Date()))().toISOString(),
      alloyBinary: options.alloyBinary,
    };
    await atomicWrite(paths.lastValidState, `${JSON.stringify(state, null, 2)}\n`, 0o600);
    return { status: 'activated', state };
  } finally {
    await Promise.all([rm(stagedModule, { force: true }), rm(stagedConfig, { force: true })]);
  }
}
