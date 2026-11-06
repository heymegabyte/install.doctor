import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { LaunchdServiceStateSchema, SystemdServiceStateSchema } from './config-transaction.js';
import type { ServiceState, ServiceStateAdapter, ServiceStateSnapshot } from './config-transaction.js';

const ServiceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}\.service$/);
const LaunchdLabel = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9])?$/);
const LaunchdDomain = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('system') }),
  z.strictObject({ kind: z.enum(['gui', 'user']), uid: z.number().int().nonnegative() }),
]);
const LaunchdEnrollment = z.strictObject({
  serviceId: LaunchdLabel,
  domain: LaunchdDomain,
  definitionPath: z.string().min(1).max(4096).refine(value => value === resolve(value), 'launchd definition path must be absolute and canonical'),
});
const NativeResult = z.strictObject({
  code: z.number().int().min(0).max(255),
  stdout: z.string().max(4096),
  stderr: z.string().max(4096).optional(),
});
export type NativeServiceCommand = (
  file: string,
  arguments_: readonly string[],
) => Promise<z.infer<typeof NativeResult>>;

function launchdDomainTarget(domain: z.infer<typeof LaunchdDomain>): string {
  return domain.kind === 'system' ? 'system' : `${domain.kind}/${domain.uid}`;
}

function launchdServiceTarget(domain: z.infer<typeof LaunchdDomain>, label: string): string {
  return `${launchdDomainTarget(domain)}/${label}`;
}

function parseLaunchdEnablement(output: string, label: string): 'default' | 'enabled' | 'disabled' {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`^[ \\t]*[\"']?${escaped}[\"']?[ \\t]*=>[ \\t]*(true|false)[ \\t]*[,]?[ \\t]*$`, 'gm');
  const matches = [...output.matchAll(expression)];
  if (matches.length === 0) return 'default';
  if (matches.length !== 1) throw new Error('launchd enablement has duplicate explicit overrides');
  return matches[0]?.[1] === 'true' ? 'disabled' : 'enabled';
}

function parseLaunchdActivity(output: string): 'running' | 'not-running' {
  const matches = [...output.matchAll(/^[ \t]*state[ \t]*=[ \t]*(running|not running|waiting)[ \t]*$/gm)];
  if (matches.length !== 1) throw new Error('launchd service state is ambiguous');
  return matches[0]?.[1] === 'running' ? 'running' : 'not-running';
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

async function launchdDefinition(path: string, expectedUid: number): Promise<z.infer<typeof LaunchdServiceStateSchema>['definition']> {
  const canonical = await realpath(path);
  if (canonical !== path) throw new Error('launchd definition must not traverse symbolic links');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== expectedUid || (info.mode & 0o022) !== 0) {
    throw new Error('launchd definition ownership or file safety is invalid');
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > 1024 * 1024) throw new Error('launchd definition exceeds its byte bound');
  return Object.freeze({ canonicalPath: path, sha256: createHash('sha256').update(bytes).digest('hex'), uid: info.uid, gid: info.gid, mode: info.mode & 0o7777 });
}

function oneLine(value: string): string {
  return value.trim().replace(/[\r\n\t]+/g, ' ').slice(0, 256);
}

async function executeNative(file: string, arguments_: readonly string[]): Promise<z.infer<typeof NativeResult>> {
  return await new Promise((accept, reject) => {
    const child = spawn(file, [...arguments_], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
        LC_ALL: 'C',
        SYSTEMD_COLORS: '0',
        SYSTEMD_PAGER: 'cat',
      },
    });
    let stdout = '';
    let stderr = '';
    let overflow = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 4096) { overflow = true; child.kill('SIGKILL'); }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4096) { overflow = true; child.kill('SIGKILL'); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (overflow) { reject(new Error('service-manager output exceeded its bound')); return; }
      if (signal !== null) { reject(new Error(`service-manager command terminated by ${signal}`)); return; }
      accept(NativeResult.parse({ code: code ?? 255, stdout, stderr }));
    });
  });
}

function parseEnabled(result: z.infer<typeof NativeResult>): boolean {
  const state = oneLine(result.stdout);
  if (result.code === 0 && state === 'enabled') return true;
  if (result.code !== 0 && state === 'disabled') return false;
  throw new Error(`cannot represent systemd enabled state: ${state || `exit-${result.code}`}`);
}

function parseRunning(result: z.infer<typeof NativeResult>): boolean {
  const state = oneLine(result.stdout);
  if (result.code === 0 && state === 'active') return true;
  if (result.code !== 0 && state === 'inactive') return false;
  throw new Error(`cannot represent systemd active state: ${state || `exit-${result.code}`}`);
}

export function createSystemdServiceStateAdapter(input: {
  readonly systemctlPath: string;
  readonly execute?: NativeServiceCommand;
}): ServiceStateAdapter {
  const systemctlPath = z.string().refine(value => value === resolve(value), 'systemctl path must be absolute and canonical').parse(input.systemctlPath);
  const execute = input.execute ?? executeNative;
  const capture = async (serviceIdInput: string): Promise<{ readonly enabled: boolean; readonly running: boolean }> => {
    const serviceId = ServiceId.parse(serviceIdInput, { error: () => 'invalid systemd service identifier' });
    const enabled = parseEnabled(NativeResult.parse(await execute(systemctlPath, ['is-enabled', '--', serviceId])));
    const running = parseRunning(NativeResult.parse(await execute(systemctlPath, ['is-active', '--', serviceId])));
    return Object.freeze({ enabled, running });
  };
  return Object.freeze({
    manager: 'systemd' as const,
    capture,
    restore: async (serviceIdInput: string, stateInput: ServiceState) => {
      const serviceId = ServiceId.parse(serviceIdInput, { error: () => 'invalid systemd service identifier' });
      const state = SystemdServiceStateSchema.parse(stateInput, { error: () => 'invalid systemd service state' });
      const enableVerb = state.enabled ? 'enable' : 'disable';
      const activityVerb = state.running ? 'start' : 'stop';
      for (const verb of [enableVerb, activityVerb]) {
        const result = NativeResult.parse(await execute(systemctlPath, [verb, '--', serviceId]));
        if (result.code !== 0) throw new Error(`systemctl ${verb} failed: ${oneLine(result.stderr ?? '') || `exit-${result.code}`}`);
      }
      const observed = await capture(serviceId);
      if (observed.enabled !== state.enabled || observed.running !== state.running) {
        throw new Error('systemd service restoration postcondition failed');
      }
    },
  });
}

export function createLaunchdServiceStateAdapter(input: {
  readonly launchctlPath: string;
  readonly plutilPath: string;
  readonly authorizedDefinitions: readonly unknown[];
  readonly authorizedUserHome?: string;
  readonly effectiveUid?: number;
  readonly execute?: NativeServiceCommand;
}): ServiceStateAdapter {
  const launchctlPath = z.string().refine(value => value === resolve(value), 'launchctl path must be absolute and canonical').parse(input.launchctlPath);
  const plutilPath = z.string().refine(value => value === resolve(value), 'plutil path must be absolute and canonical').parse(input.plutilPath);
  const effectiveUid = z.number().int().nonnegative().parse(input.effectiveUid ?? process.geteuid?.());
  const currentUser = userInfo();
  const authorizedUserHome = z.string().refine(value => value === resolve(value), 'authorized user home must be absolute and canonical')
    .parse(input.authorizedUserHome ?? currentUser.homedir);
  if (input.authorizedUserHome === undefined && currentUser.uid !== effectiveUid) throw new Error('effective user does not match the authoritative user home');
  const enrollments = z.array(LaunchdEnrollment).min(1).max(256).parse(input.authorizedDefinitions);
  const byId = new Map(enrollments.map(enrollment => [enrollment.serviceId, enrollment]));
  if (byId.size !== enrollments.length) throw new Error('launchd enrollment contains duplicate labels');
  const execute = input.execute ?? executeNative;

  const enrollmentFor = (serviceIdInput: string) => {
    const serviceId = LaunchdLabel.parse(serviceIdInput, { error: () => 'invalid launchd service identifier' });
    const enrollment = byId.get(serviceId);
    if (enrollment === undefined) throw new Error('launchd service is not enrolled for rollback');
    if (enrollment.domain.kind === 'system') {
      if (effectiveUid !== 0 || !enrollment.definitionPath.startsWith('/Library/LaunchDaemons/')) throw new Error('launchd system enrollment is not authorized');
    } else if (enrollment.domain.uid !== effectiveUid || !enrollment.definitionPath.startsWith(`${authorizedUserHome}/Library/LaunchAgents/`)) {
      throw new Error('launchd user enrollment is not authorized');
    }
    return enrollment;
  };

  const capture = async (serviceIdInput: string) => {
    const enrollment = enrollmentFor(serviceIdInput);
    const expectedUid = enrollment.domain.kind === 'system' ? 0 : enrollment.domain.uid;
    const definition = await launchdDefinition(enrollment.definitionPath, expectedUid);
    const labelResult = NativeResult.parse(await execute(plutilPath, ['-extract', 'Label', 'raw', '-o', '-', '--', definition.canonicalPath]));
    if (labelResult.code !== 0 || oneLine(labelResult.stdout) !== enrollment.serviceId) throw new Error('launchd plist Label does not match its enrollment');
    const keepAliveResult = NativeResult.parse(await execute(plutilPath, ['-extract', 'KeepAlive', 'raw', '-o', '-', '--', definition.canonicalPath]));
    if (keepAliveResult.code !== 0 || oneLine(keepAliveResult.stdout) !== 'false') {
      throw new Error('launchd rollback requires an explicit KeepAlive=false definition');
    }
    const domainTarget = launchdDomainTarget(enrollment.domain);
    const disabled = NativeResult.parse(await execute(launchctlPath, ['print-disabled', domainTarget]));
    if (disabled.code !== 0) throw new Error(`launchctl print-disabled failed: ${oneLine(disabled.stderr ?? '') || `exit-${disabled.code}`}`);
    const enablementOverride = parseLaunchdEnablement(disabled.stdout, enrollment.serviceId);
    const printed = NativeResult.parse(await execute(launchctlPath, ['print', launchdServiceTarget(enrollment.domain, enrollment.serviceId)]));
    if (printed.code === 0) {
      return LaunchdServiceStateSchema.parse({ domain: enrollment.domain, definition, enablementOverride, loaded: true, activity: parseLaunchdActivity(printed.stdout) });
    }
    if (!/could not find service|service not found/i.test(oneLine(printed.stderr ?? ''))) {
      throw new Error(`launchctl print failed ambiguously: ${oneLine(printed.stderr ?? '') || `exit-${printed.code}`}`);
    }
    return LaunchdServiceStateSchema.parse({ domain: enrollment.domain, definition, enablementOverride, loaded: false, activity: 'not-running' });
  };

  const mutate = async (arguments_: readonly string[]): Promise<void> => {
    const result = NativeResult.parse(await execute(launchctlPath, arguments_));
    if (result.code !== 0) throw new Error(`launchctl ${arguments_[0] ?? 'mutation'} failed: ${oneLine(result.stderr ?? '') || `exit-${result.code}`}`);
  };

  return Object.freeze({
    manager: 'launchd' as const,
    capture,
    restore: async (serviceIdInput: string, stateInput: ServiceState) => {
      const enrollment = enrollmentFor(serviceIdInput);
      const state = LaunchdServiceStateSchema.parse(stateInput, { error: () => 'invalid launchd service state' });
      if (JSON.stringify(state.domain) !== JSON.stringify(enrollment.domain)) throw new Error('launchd rollback domain differs from enrollment');
      const currentDefinition = await launchdDefinition(enrollment.definitionPath, enrollment.domain.kind === 'system' ? 0 : enrollment.domain.uid);
      if (JSON.stringify(currentDefinition) !== JSON.stringify(state.definition)) throw new Error('launchd definition identity changed after capture');
      const target = launchdServiceTarget(enrollment.domain, enrollment.serviceId);
      const domain = launchdDomainTarget(enrollment.domain);
      let current = await capture(enrollment.serviceId);
      if (state.enablementOverride === 'default' && current.enablementOverride !== 'default') {
        throw new Error('launchd default enablement override changed after capture');
      }
      if (!state.loaded) {
        if (current.loaded) await mutate(['bootout', target]);
        if (state.enablementOverride !== 'default') await mutate([state.enablementOverride === 'enabled' ? 'enable' : 'disable', target]);
      } else {
        if (current.enablementOverride === 'disabled' || state.enablementOverride === 'enabled') await mutate(['enable', target]);
        current = await capture(enrollment.serviceId);
        if (!current.loaded) await mutate(['bootstrap', domain, state.definition.canonicalPath]);
        current = await capture(enrollment.serviceId);
        if (state.activity === 'running' && current.activity !== 'running') await mutate(['kickstart', target]);
        if (state.activity === 'not-running' && current.activity === 'running') {
          await mutate(['kill', 'SIGTERM', target]);
          for (let attempt = 0; attempt < 40; attempt += 1) {
            current = await capture(enrollment.serviceId);
            if (current.activity === 'not-running') break;
            await delay(250);
          }
        }
        if (state.enablementOverride === 'disabled') await mutate(['disable', target]);
      }
      const observed = await capture(enrollment.serviceId);
      if (JSON.stringify(observed) !== JSON.stringify(state)) throw new Error('launchd service restoration postcondition failed');
    },
  });
}

async function trustedNativeExecutable(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) !== 0) return false;
    if (resolve(await realpath(path)) !== path) return false;
    await access(path, constants.X_OK);
    return true;
  } catch { return false; }
}

export async function discoverNativeServiceStateAdapters(
  snapshots: readonly ServiceStateSnapshot[] = [],
): Promise<Partial<Record<ServiceStateSnapshot['manager'], ServiceStateAdapter>>> {
  if (process.platform === 'linux') {
    const systemctlPath = '/usr/bin/systemctl';
    if (!await trustedNativeExecutable(systemctlPath)) return Object.freeze({});
    return Object.freeze({ systemd: createSystemdServiceStateAdapter({ systemctlPath }) });
  }
  if (process.platform === 'darwin') {
    const launchctlPath = '/bin/launchctl';
    const plutilPath = '/usr/bin/plutil';
    if (!await trustedNativeExecutable(launchctlPath) || !await trustedNativeExecutable(plutilPath)) return Object.freeze({});
    const launchd = snapshots.filter((snapshot): snapshot is Extract<ServiceStateSnapshot, { manager: 'launchd' }> => snapshot.manager === 'launchd');
    if (launchd.length === 0) return Object.freeze({});
    const definitions = new Map<string, { serviceId: string; domain: z.infer<typeof LaunchdDomain>; definitionPath: string }>();
    for (const snapshot of launchd) {
      const definition = { serviceId: snapshot.serviceId, domain: snapshot.domain, definitionPath: snapshot.definition.canonicalPath };
      const prior = definitions.get(snapshot.serviceId);
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(definition)) throw new Error('launchd rollback evidence has conflicting enrollments');
      definitions.set(snapshot.serviceId, definition);
    }
    const adapter = createLaunchdServiceStateAdapter({
      launchctlPath,
      plutilPath,
      authorizedDefinitions: [...definitions.values()],
    });
    // Preflight every enrolled domain and definition before the rollback
    // executor can mutate its first file. This makes mixed-privilege or stale
    // enrollment evidence fail as one admission decision, not mid-plan.
    for (const definition of definitions.values()) await adapter.capture(definition.serviceId);
    return Object.freeze({ launchd: adapter });
  }
  return Object.freeze({});
}
