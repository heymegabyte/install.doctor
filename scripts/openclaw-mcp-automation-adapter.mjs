#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyTransaction, loadPinnedProfiles, rollbackTransaction,
} from './mcp-host-manifest-consumer.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPinPath = join(root, 'config/mcp-portals/canonical-pin.json');
const defaultSourceDirectory = join(root, 'config/mcp-portals/canonical-profiles');
const managedName = 'megabyte-automation';
const repository = 'heymegabyte/install.doctor';

function fail(message) {
  throw new Error(`openclaw-mcp-automation-adapter: ${message}`);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function json(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function readObject(path) {
  if (!existsSync(path)) return {};
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { fail(`${path} is not valid JSON`); }
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(`${path} must contain a JSON object`);
  return value;
}

function automationProfile(loaded, hostClass) {
  const profile = loaded.profiles.find(({ id }) => id === (hostClass === 'macos-workstation' ? 'macos-automation' : 'ubuntu-automation'));
  if (!profile) fail(`canonical automation profile is absent for ${hostClass}`);
  const { remote } = profile;
  const refs = remote.runtimeSecretRefs;
  const expectedProject = hostClass === 'macos-workstation' ? 'macos.megabyte.space' : 'ubuntu.megabyte.space';
  const expectedNames = ['CF_ACCESS_MCP_AUTOMATION_CLIENT_ID', 'CF_ACCESS_MCP_AUTOMATION_CLIENT_SECRET'];
  if (remote.managedName !== managedName || remote.workloadId !== expectedProject
    || refs?.clientId?.project !== expectedProject || refs?.clientSecret?.project !== expectedProject
    || refs.clientId.name !== expectedNames[0] || refs.clientSecret.name !== expectedNames[1]
    || refs.clientId.environment !== 'prod' || refs.clientSecret.environment !== 'prod'
    || refs.clientId.path !== '/' || refs.clientSecret.path !== '/') {
    fail(`canonical automation identity does not match ${hostClass}`);
  }
  const bindings = Object.entries(remote.headers ?? {});
  if (bindings.length !== 2
    || remote.headers['CF-Access-Client-Id']?.secretRef !== 'clientId'
    || remote.headers['CF-Access-Client-Secret']?.secretRef !== 'clientSecret') {
    fail('canonical automation header bindings are not the exact Cloudflare Access pair');
  }
  return profile;
}

export function mergeOpenClawConfig(existing, loaded, hostClass) {
  const profile = automationProfile(loaded, hostClass);
  const servers = existing.mcp?.servers && !Array.isArray(existing.mcp.servers) && typeof existing.mcp.servers === 'object'
    ? existing.mcp.servers : {};
  const prior = servers[managedName];
  if (prior && prior['x-installDoctor']?.repository !== repository) fail(`MCP server collision for ${managedName}`);
  const names = profile.remote.runtimeSecretRefs;
  const entry = {
    enabled: true,
    url: profile.remote.endpoint,
    transport: 'streamable-http',
    headers: {
      'CF-Access-Client-Id': `\${${names.clientId.name}}`,
      'CF-Access-Client-Secret': `\${${names.clientSecret.name}}`,
    },
    'x-installDoctor': {
      repository,
      canonicalRepository: loaded.pin.repository,
      canonicalRevision: loaded.pin.revision,
      profileId: profile.id,
      sourceDigest: loaded.pin.sourceDigest,
    },
  };
  return {
    ...existing,
    mcp: { ...(existing.mcp ?? {}), servers: { ...servers, [managedName]: entry } },
  };
}

function resolveSecret(name) {
  try {
    const value = execFileSync('get-secret', [name], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000, maxBuffer: 1024 * 1024,
    }).trim();
    if (!value) fail(`get-secret returned an empty value for ${name}`);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('openclaw-mcp-automation-adapter:')) throw error;
    fail(`unable to resolve ${name} with get-secret`);
  }
}

export function buildRuntimeEnvironment(profile, environment = process.env) {
  const refs = profile.remote.runtimeSecretRefs;
  return {
    ...environment,
    [refs.clientId.name]: resolveSecret(refs.clientId.name),
    [refs.clientSecret.name]: resolveSecret(refs.clientSecret.name),
  };
}

function parseArguments(args) {
  const options = {
    command: 'plan', pinPath: defaultPinPath, sourceDirectory: defaultSourceDirectory,
    configPath: join(homedir(), '.openclaw', 'openclaw.json'), child: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--') { options.child = args.slice(index + 1); break; }
    if (['plan', 'apply', 'rollback', 'exec'].includes(value)) options.command = value;
    else if (value === '--host-class') options.hostClass = args[++index];
    else if (value === '--pin') options.pinPath = resolve(args[++index]);
    else if (value === '--source-directory') options.sourceDirectory = resolve(args[++index]);
    else if (value === '--config') options.configPath = resolve(args[++index]);
    else if (value === '--receipt') options.receiptPath = resolve(args[++index]);
    else fail(`unknown argument ${value}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === 'rollback') {
    if (!options.receiptPath) fail('rollback requires --receipt');
    process.stdout.write(json(rollbackTransaction(options.receiptPath)));
    return;
  }
  if (!options.hostClass) fail(`${options.command} requires --host-class`);
  const loaded = await loadPinnedProfiles(options);
  const profile = automationProfile(loaded, options.hostClass);
  if (options.command === 'exec') {
    if (options.child.length === 0 || basename(options.child[0]) !== 'openclaw') fail('exec accepts only an openclaw child command');
    const child = spawn(options.child[0], options.child.slice(1), {
      env: buildRuntimeEnvironment(profile), stdio: 'inherit', shell: false,
    });
    child.once('error', (error) => { process.stderr.write(`openclaw-mcp-automation-adapter: cannot start openclaw: ${error.message}\n`); process.exitCode = 1; });
    child.once('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
    return;
  }
  const existing = readObject(options.configPath);
  const content = json(mergeOpenClawConfig(existing, loaded, options.hostClass));
  if (options.command === 'plan') {
    process.stdout.write(json({
      schemaVersion: 1,
      operation: 'plan-openclaw-mcp-automation',
      hostClass: options.hostClass,
      profileId: profile.id,
      canonicalRevision: loaded.pin.revision,
      output: { path: options.configPath, exists: existsSync(options.configPath), digest: digest(content) },
      preservation: {
        topLevelKeys: Object.keys(existing).length,
        existingMcpServers: Object.keys(existing.mcp?.servers ?? {}).filter((name) => name !== managedName).length,
      },
      runtimeSecretNames: [profile.remote.runtimeSecretRefs.clientId.name, profile.remote.runtimeSecretRefs.clientSecret.name],
    }));
    return;
  }
  if (!options.receiptPath) fail('apply requires --receipt');
  const receipt = applyTransaction({
    outputs: [{ path: options.configPath, content }], receiptPath: options.receiptPath,
    operation: 'install-openclaw-mcp-automation',
  });
  process.stdout.write(json({ schemaVersion: 1, operation: receipt.operation, status: 'installed', recordCount: receipt.records.length }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
