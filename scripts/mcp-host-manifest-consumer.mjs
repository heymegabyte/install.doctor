#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPinPath = join(root, 'config/mcp-portals/canonical-pin.json');
const defaultSourceDirectory = join(root, 'config/mcp-portals/canonical-profiles');
const profileIdsByHost = {
  'macos-workstation': ['macos-human', 'macos-automation'],
  'ubuntu-runner': ['ubuntu-human', 'ubuntu-automation'],
};

function fail(message) {
  throw new Error(`mcp-host-manifest-consumer: ${message}`);
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

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(`${label} is not valid JSON`); }
}

export function validatePin(pin) {
  if (pin?.schemaVersion !== 1 || !/^heymegabyte\/mcp\.megabyte\.space$/.test(pin.repository ?? '')
    || !/^[a-f0-9]{40}$/.test(pin.revision ?? '') || !/^https:\/\//.test(pin.baseUrl ?? '')
    || !/^sha256:[a-f0-9]{64}$/.test(pin.sourceDigest ?? '') || typeof pin.artifacts !== 'object') fail('invalid canonical pin');
  for (const name of ['index.json', ...Object.values(profileIdsByHost).flat().map((id) => `${id}.json`)]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(pin.artifacts[name] ?? '')) fail(`canonical pin is missing ${name}`);
  }
  return pin;
}

async function readArtifact(pin, name, sourceDirectory) {
  let bytes;
  if (sourceDirectory) bytes = readFileSync(join(sourceDirectory, name));
  else {
    const response = await fetch(`${pin.baseUrl}/${name}`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) fail(`could not fetch pinned artifact ${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (digest(bytes) !== pin.artifacts[name]) fail(`digest mismatch for pinned artifact ${name}`);
  return bytes;
}

function validateProfile(profile, id, hostClass, pin) {
  if (profile?.schemaVersion !== 1 || profile.id !== id || profile.sourceDigest !== pin.sourceDigest
    || profile.selector?.hostClass !== hostClass || profile.merge?.atomic !== true
    || profile.merge?.predecessorSnapshotRequired !== true || profile.merge?.preserveUnknownEntries !== true
    || profile.merge?.ownershipPrefix !== 'megabyte-' || !profile.remote?.managedName?.startsWith('megabyte-')
    || !/^https:\/\/[^/]+\/mcp(?:\?.*)?$/.test(profile.remote?.endpoint ?? '')) fail(`invalid canonical profile ${id}`);
  if (id.endsWith('-automation')) {
    const refs = profile.remote.runtimeSecretRefs;
    if (profile.remote.authMode !== 'service-token' || !refs?.clientId || !refs?.clientSecret
      || refs.clientId.project !== (hostClass === 'macos-workstation' ? 'macos.megabyte.space' : 'ubuntu.megabyte.space')
      || refs.clientSecret.project !== refs.clientId.project) fail(`invalid runtime secret references for ${id}`);
  } else if (profile.remote.runtimeSecretRefs !== null) fail(`human profile ${id} unexpectedly contains runtime secret references`);
  return profile;
}

export async function loadPinnedProfiles({ pinPath = defaultPinPath, sourceDirectory, hostClass }) {
  const ids = profileIdsByHost[hostClass];
  if (!ids) fail(`unsupported host class ${hostClass}`);
  const pin = validatePin(JSON.parse(readFileSync(pinPath, 'utf8')));
  const index = parseJson(await readArtifact(pin, 'index.json', sourceDirectory), 'index.json');
  if (index?.schemaVersion !== 1 || index.sourceDigest !== pin.sourceDigest) fail('canonical index source digest mismatch');
  const indexed = new Map((index.assignments ?? []).map((entry) => [entry.id, entry]));
  const profiles = [];
  for (const id of ids) {
    if (indexed.get(id)?.path !== `./${id}.json`) fail(`canonical index does not bind ${id}`);
    profiles.push(validateProfile(parseJson(await readArtifact(pin, `${id}.json`, sourceDirectory), id), id, hostClass, pin));
  }
  return { pin, profiles };
}

function readObject(path) {
  if (!existsSync(path)) return {};
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') fail(`${path} must contain a JSON object`);
  return value;
}

export function buildHostDescriptor(existing, { pin, profiles }, hostClass) {
  const priorProfiles = existing.profiles && !Array.isArray(existing.profiles) && typeof existing.profiles === 'object' ? existing.profiles : {};
  const managedByUs = existing.managedBy?.repository === pin.repository;
  for (const profile of profiles) {
    if (priorProfiles[profile.id] && !managedByUs && json(priorProfiles[profile.id]) !== json(profile)) {
      fail(`profile collision for ${profile.id}`);
    }
  }
  return {
    ...existing,
    schemaVersion: 1,
    managedBy: { repository: pin.repository, revision: pin.revision, sourceDigest: pin.sourceDigest },
    hostClass,
    profiles: { ...priorProfiles, ...Object.fromEntries(profiles.map((profile) => [profile.id, profile])) },
  };
}

export function mergeClientConfig(existing, { pin, profiles }) {
  const servers = existing.mcpServers && !Array.isArray(existing.mcpServers) && typeof existing.mcpServers === 'object' ? existing.mcpServers : {};
  const merged = { ...servers };
  for (const profile of profiles) {
    const name = profile.remote.managedName;
    const entry = {
      url: profile.remote.endpoint,
      'x-managedBy': { repository: pin.repository, revision: pin.revision, profileId: profile.id },
      ...(profile.remote.runtimeSecretRefs ? {
        'x-runtimeSecretRefs': profile.remote.runtimeSecretRefs,
        'x-headerBindings': profile.remote.headers,
      } : {}),
    };
    if (merged[name] && merged[name]['x-managedBy']?.repository !== pin.repository && json(merged[name]) !== json(entry)) {
      fail(`managed MCP server collision for ${name}`);
    }
    merged[name] = entry;
  }
  return { ...existing, mcpServers: merged };
}

function atomicWrite(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, content, { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, path);
}

function snapshot(path, rollbackDirectory, ordinal) {
  const existed = existsSync(path);
  const previous = existed ? readFileSync(path) : null;
  const backupPath = existed ? join(rollbackDirectory, `${ordinal}-${basename(path)}.previous`) : null;
  if (backupPath) {
    copyFileSync(path, backupPath);
    chmodSync(backupPath, 0o600);
  }
  return { path, existed, previousDigest: previous ? digest(previous) : null, backupPath };
}

export function applyTransaction({ outputs, receiptPath }) {
  if (!receiptPath) fail('apply requires a receipt path');
  const rollbackDirectory = `${receiptPath}.d`;
  if (existsSync(receiptPath) || existsSync(rollbackDirectory)) fail('rollback receipt already exists');
  mkdirSync(rollbackDirectory, { recursive: true, mode: 0o700 });
  chmodSync(rollbackDirectory, 0o700);
  const records = outputs.map(({ path, content }, index) => ({
    ...snapshot(path, rollbackDirectory, index), installedDigest: digest(content), content,
  }));
  const written = [];
  try {
    for (const record of records) {
      atomicWrite(record.path, record.content);
      written.push(record);
    }
    const receipt = {
      schemaVersion: 1,
      operation: 'install-pinned-mcp-host-manifests',
      records: records.map(({ content: _content, ...record }) => record),
    };
    atomicWrite(receiptPath, json(receipt));
    return receipt;
  } catch (error) {
    for (const record of written.reverse()) {
      if (record.existed) atomicWrite(record.path, readFileSync(record.backupPath));
      else rmSync(record.path, { force: true });
    }
    rmSync(rollbackDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function rollbackTransaction(receiptPath) {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt?.schemaVersion !== 1 || !Array.isArray(receipt.records)) fail('invalid rollback receipt');
  for (const record of receipt.records) {
    if (!existsSync(record.path) || digest(readFileSync(record.path)) !== record.installedDigest) fail(`installed output drift blocks rollback for ${record.path}`);
  }
  for (const record of [...receipt.records].reverse()) {
    if (record.existed) {
      if (!record.backupPath || !existsSync(record.backupPath) || digest(readFileSync(record.backupPath)) !== record.previousDigest) fail(`rollback predecessor is invalid for ${record.path}`);
      atomicWrite(record.path, readFileSync(record.backupPath));
    } else rmSync(record.path, { force: true });
  }
  return { schemaVersion: 1, operation: 'rollback-pinned-mcp-host-manifests', status: 'restored', recordCount: receipt.records.length };
}

function parseArguments(args) {
  const options = {
    command: 'plan', pinPath: defaultPinPath, sourceDirectory: defaultSourceDirectory,
    destination: join(homedir(), '.config/mcp-portals/host-profile.json'),
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (['plan', 'apply', 'rollback'].includes(value)) options.command = value;
    else if (value === '--host-class') options.hostClass = args[++index];
    else if (value === '--pin') options.pinPath = resolve(args[++index]);
    else if (value === '--source-directory') options.sourceDirectory = resolve(args[++index]);
    else if (value === '--destination') options.destination = resolve(args[++index]);
    else if (value === '--client-config') options.clientConfig = resolve(args[++index]);
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
  if (!options.hostClass) fail('plan and apply require --host-class');
  const loaded = await loadPinnedProfiles(options);
  const descriptorContent = json(buildHostDescriptor(readObject(options.destination), loaded, options.hostClass));
  const outputs = [{ path: options.destination, content: descriptorContent }];
  if (options.clientConfig) outputs.push({ path: options.clientConfig, content: json(mergeClientConfig(readObject(options.clientConfig), loaded)) });
  if (options.command === 'plan') {
    process.stdout.write(json({
      schemaVersion: 1,
      operation: 'plan-pinned-mcp-host-manifests',
      hostClass: options.hostClass,
      revision: loaded.pin.revision,
      sourceDigest: loaded.pin.sourceDigest,
      profileIds: loaded.profiles.map(({ id }) => id),
      outputs: outputs.map(({ path, content }) => ({ path, digest: digest(content), exists: existsSync(path) })),
    }));
    return;
  }
  if (!options.receiptPath) fail('apply requires --receipt');
  const receipt = applyTransaction({ outputs, receiptPath: options.receiptPath });
  process.stdout.write(json({ schemaVersion: 1, operation: receipt.operation, status: 'installed', recordCount: receipt.records.length }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
