#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTransaction, rollbackTransaction } from './mcp-host-manifest-consumer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceAdapter = join(root, 'scripts/openclaw-mcp-automation-adapter.mjs');
const sourceConsumer = join(root, 'scripts/mcp-host-manifest-consumer.mjs');
const sourceCanonical = join(root, 'config/mcp-portals');
const canonicalFiles = ['canonical-pin.json', 'canonical-profiles/index.json', 'canonical-profiles/macos-automation.json',
  'canonical-profiles/macos-human.json', 'canonical-profiles/ubuntu-automation.json', 'canonical-profiles/ubuntu-human.json'];
const unitName = 'openclaw-gateway.service';

function fail(message) { throw new Error(`openclaw-systemd-reconciler: ${message}`); }
function digest(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }

export function validateGatewayArgv(value) {
  if (!Array.isArray(value) || value.length < 3 || !value.every((item) => typeof item === 'string' && item.length > 0)) {
    fail('gateway argv must be a JSON string array with executable, OpenClaw entrypoint, and gateway command');
  }
  if (!value[0].startsWith('/') || basename(value[0]) !== 'node') fail('gateway argv must begin with an absolute Node executable');
  let entrypointIndex = 1;
  let sawHeapFlag = false;
  while (value[entrypointIndex]?.startsWith('--')) {
    const match = /^--max-old-space-size=(\d+)$/.exec(value[entrypointIndex]);
    const size = match ? Number(match[1]) : NaN;
    if (sawHeapFlag || !Number.isSafeInteger(size) || size < 128 || size > 65536) {
      fail(`gateway argv contains a disallowed Node runtime flag`);
    }
    sawHeapFlag = true;
    entrypointIndex += 1;
  }
  const entrypoint = value[entrypointIndex];
  if (!entrypoint?.startsWith('/') || !/(?:^|\/)openclaw(?:\/|$)/i.test(entrypoint)
    || value[entrypointIndex + 1] !== 'gateway') fail('gateway argv must identify an absolute OpenClaw entrypoint followed by gateway');
  for (const argument of value) {
    if (!/^[A-Za-z0-9_./:@+=,-]+$/.test(argument)) fail(`gateway argv contains an unsupported systemd character`);
  }
  return value;
}

function portFromArgv(argv) {
  const index = argv.findIndex((value) => value === '--port');
  if (index === -1) return null;
  if (!/^\d{1,5}$/.test(argv[index + 1] ?? '') || Number(argv[index + 1]) > 65535) fail('gateway --port is invalid');
  return Number(argv[index + 1]);
}

export function renderDropIn({ gatewayArgv, hostClass, adapterPath, pinPath, profilesPath }) {
  const argv = validateGatewayArgv(gatewayArgv);
  const command = [argv[0], adapterPath, 'exec', '--host-class', hostClass, '--pin', pinPath,
    '--source-directory', profilesPath, '--allowed-executable', argv[0], '--', ...argv];
  for (const argument of command) {
    if (!/^[A-Za-z0-9_./:@+=,-]+$/.test(argument)) fail('rendered ExecStart contains an unsupported systemd character');
  }
  return `[Service]\nExecStart=\nExecStart=${command.join(' ')}\nUMask=0077\n`;
}

function lifecycle(action, unit = unitName) {
  if (action === 'activate') {
    execFileSync('systemd-analyze', ['--user', 'verify', unit], { stdio: 'ignore' });
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    execFileSync('systemctl', ['--user', 'restart', unit], { stdio: 'ignore' });
    execFileSync('systemctl', ['--user', 'is-active', '--quiet', unit], { stdio: 'ignore' });
  }
}

function observedExecStartDigest() {
  const value = execFileSync('systemctl', ['--user', 'show', unitName, '--property=ExecStart', '--value'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (!value.trim()) fail(`cannot observe ${unitName} ExecStart`);
  return digest(value);
}

function parseArguments(args) {
  const stateRoot = join(homedir(), '.local');
  const options = {
    command: 'plan', hostClass: 'ubuntu-runner',
    runtimeDirectory: join(stateRoot, 'lib/install.doctor/openclaw-mcp-automation'),
    canonicalDirectory: join(stateRoot, 'share/install.doctor/mcp-portals'),
    dropInPath: join(homedir(), '.config/systemd/user', `${unitName}.d/40-mcp-automation.conf`),
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (['plan', 'apply', 'rollback'].includes(value)) options.command = value;
    else if (value === '--host-class') options.hostClass = args[++index];
    else if (value === '--gateway-argv-json') options.gatewayArgv = JSON.parse(args[++index]);
    else if (value === '--runtime-directory') options.runtimeDirectory = resolve(args[++index]);
    else if (value === '--canonical-directory') options.canonicalDirectory = resolve(args[++index]);
    else if (value === '--drop-in') options.dropInPath = resolve(args[++index]);
    else if (value === '--receipt') options.receiptPath = resolve(args[++index]);
    else if (value === '--expected-exec-start-digest') options.expectedExecStartDigest = args[++index];
    else fail(`unknown argument ${value}`);
  }
  return options;
}

function buildOutputs(options) {
  if (!['ubuntu-runner', 'macos-workstation'].includes(options.hostClass)) fail('unsupported host class');
  const adapterPath = join(options.runtimeDirectory, 'openclaw-mcp-automation-adapter.mjs');
  const consumerPath = join(options.runtimeDirectory, 'mcp-host-manifest-consumer.mjs');
  const pinPath = join(options.canonicalDirectory, 'canonical-pin.json');
  const profilesPath = join(options.canonicalDirectory, 'canonical-profiles');
  const outputs = [
    { path: adapterPath, content: readFileSync(sourceAdapter) },
    { path: consumerPath, content: readFileSync(sourceConsumer) },
    ...canonicalFiles.map((name) => ({ path: join(options.canonicalDirectory, name), content: readFileSync(join(sourceCanonical, name)) })),
    { path: options.dropInPath, content: renderDropIn({ gatewayArgv: options.gatewayArgv, hostClass: options.hostClass, adapterPath, pinPath, profilesPath }) },
  ];
  return outputs;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === 'rollback') {
    if (!options.receiptPath) fail('rollback requires --receipt');
    const result = rollbackTransaction(options.receiptPath);
    lifecycle('activate');
    process.stdout.write(json({ ...result, service: unitName, health: 'active' }));
    return;
  }
  if (!options.gatewayArgv) fail(`${options.command} requires --gateway-argv-json`);
  const outputs = buildOutputs(options);
  const gatewayArgvDigest = digest(json(options.gatewayArgv));
  if (options.command === 'plan') {
    const unitExecStartDigest = observedExecStartDigest();
    process.stdout.write(json({
      schemaVersion: 1, operation: 'plan-openclaw-systemd-mcp-automation', service: unitName,
      hostClass: options.hostClass, gatewayArgvDigest, gatewayPort: portFromArgv(options.gatewayArgv),
      unitExecStartDigest,
      outputs: outputs.map(({ path, content }) => ({ path, exists: existsSync(path), digest: digest(content) })),
    }));
    return;
  }
  if (!options.receiptPath) fail('apply requires --receipt');
  if (!/^sha256:[a-f0-9]{64}$/.test(options.expectedExecStartDigest ?? '')) fail('apply requires --expected-exec-start-digest from plan');
  if (observedExecStartDigest() !== options.expectedExecStartDigest) fail(`${unitName} ExecStart drifted after plan`);
  applyTransaction({ outputs, receiptPath: options.receiptPath, operation: 'install-openclaw-systemd-mcp-automation' });
  try {
    lifecycle('activate');
  } catch (error) {
    rollbackTransaction(options.receiptPath);
    try { lifecycle('activate'); } catch { /* report the original activation failure without hiding rollback attempt */ }
    fail(`service activation failed; installed files were restored: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.stdout.write(json({ schemaVersion: 1, operation: 'install-openclaw-systemd-mcp-automation', status: 'installed',
    service: unitName, health: 'active', gatewayArgvDigest, gatewayPort: portFromArgv(options.gatewayArgv) }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
