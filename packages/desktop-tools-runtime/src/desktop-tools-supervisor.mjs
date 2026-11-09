#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { initializeSessionEvidence, loadSessionContext, persistSessionContext } from './session-evidence.mjs';

const VERSION = '1';
const digestPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const safeTextPattern = /^[^\0\r\n]{1,4096}$/;
const PROVIDER_ID = 'projectsites';
const PROVIDER_BASE_URL = 'https://desktop.tools/api/ai/v1';
const PROVISIONING_PROMPT_VERSION = 'desktop-tools/provisioning/v1';
const PROVISIONING_PROMPT = `You are the Desktop Tools provisioning orchestrator.

Treat the attached canonical context as immutable authorization input. Discover and validate before planning. Use only the listed Desktop Tools typed tools and capabilities. Model-generated text is never mutation authority. Do not use ambient shell, edit files directly, broaden policy, or claim apply or verification results that the deterministic installer engine did not return. Stop on a profile revision, release, policy, capability, tool, or fact mismatch.`;
const PROVISIONING_SKILL = '---\nname: desktop-tools-provisioning\ndescription: Inspect, validate, plan, and report Desktop Tools desired state through approved typed tools.\nversion: 1.0.0\n---\n\nUse only the Desktop Tools typed tools exposed for this session. Discover before planning. Never use shell, edit files directly, access external directories, or claim mutation or verification that a typed tool did not report.\n';
const approvedSkills = Object.freeze([
  Object.freeze({ id: 'desktop-tools-provisioning', version: '1.0.0', sha256: '9cc5393b607af33a4ff9f73070f5ae87b6b9e6b5510d344ae93c3587672f71eb' })
]);
const approvedTools = Object.freeze([
  'desktop_tools_discover', 'desktop_tools_validate', 'desktop_tools_plan', 'desktop_tools_approve',
  'desktop_tools_apply', 'desktop_tools_verify', 'desktop_tools_status', 'desktop_tools_resume',
  'desktop_tools_rollback_config', 'desktop_tools_deprovision_preview'
]);

function fail(message, code = 64) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

async function validateInferenceCredential(stateDirectory) {
  const path = join(stateDirectory, 'config', 'inference-token');
  const info = await lstat(path).catch(error => {
    if (error?.code === 'ENOENT') fail('scoped inference credential is unavailable', 78);
    throw error;
  });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 32 || info.size > 4096
    || (info.mode & 0o077) !== 0 || (typeof info.uid === 'number' && info.uid !== process.getuid?.())) {
    fail('scoped inference credential state is unsafe', 77);
  }
  const value = await readFile(path, 'utf8');
  const token = value.endsWith('\n') ? value.slice(0, -1) : value;
  if (token.includes('\0') || /[\r\n]/.test(token) || token.length < 32 || token !== token.trim()) fail('scoped inference credential is malformed', 65);
  return path;
}

async function installPinnedSkills(stateDirectory) {
  for (const skill of approvedSkills) {
    const directory = join(stateDirectory, 'config', 'skills', skill.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const path = join(directory, 'SKILL.md');
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || await sha256(path) !== skill.sha256) {
        fail(`installed OpenCode skill is not the pinned artifact: ${skill.id}`, 65);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await atomicWrite(path, PROVISIONING_SKILL, 0o600);
      if (await sha256(path) !== skill.sha256) fail(`OpenCode skill digest mismatch: ${skill.id}`, 65);
    }
  }
}

function generateOpenCodeConfig(credentialPath, promptPath, toolRuntime) {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: `${PROVIDER_ID}/dynamic/code`,
    update: 'disable',
    snapshots: false,
    ...(promptPath ? { instructions: [promptPath] } : {}),
    ...(toolRuntime ? { mcp: { servers: { 'desktop-tools': {
      type: 'local', enabled: true,
      command: ['/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'LANG=C.UTF-8', process.execPath,
        toolRuntime.server, '--engine', toolRuntime.engine, '--engine-sha256', toolRuntime.engineSha256,
        '--context', toolRuntime.context, '--state-root', toolRuntime.stateRoot, '--consent-dir', toolRuntime.consentDirectory],
    } } } } : {}),
    providers: {
      [PROVIDER_ID]: {
        package: '@opencode/ai/providers/openai-compatible',
        name: 'Desktop Tools / ProjectSites (DeepSeek preferred)',
        settings: { baseURL: PROVIDER_BASE_URL, apiKey: `{file:${credentialPath}}` },
        models: {
          'dynamic/code': { name: 'ProjectSites code (DeepSeek preferred)' },
          'dynamic/economy': { name: 'ProjectSites economy (DeepSeek preferred)' },
          'dynamic/restricted': { name: 'ProjectSites restricted' }
        }
      }
    },
    permissions: [
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'read', resource: '*', effect: 'allow' },
      { action: 'glob', resource: '*', effect: 'allow' },
      { action: 'grep', resource: '*', effect: 'allow' },
      { action: 'question', resource: '*', effect: 'allow' },
      { action: 'read', resource: '*.env', effect: 'deny' },
      { action: 'read', resource: '*.env.*', effect: 'deny' },
      { action: 'read', resource: '*/.ssh/*', effect: 'deny' },
      { action: 'skill', resource: '*', effect: 'deny' },
      ...approvedSkills.map(skill => ({ action: 'skill', resource: skill.id, effect: 'allow' })),
      ...approvedTools.map(tool => ({ action: tool, resource: '*', effect: 'allow' }))
    ],
    policies: [
      { action: 'provider.use', resource: '*', effect: 'deny' },
      { action: 'provider.use', resource: PROVIDER_ID, effect: 'allow' },
      { action: 'integration.connect', resource: '*', effect: 'deny' },
      { action: 'integration.use', resource: '*', effect: 'deny' },
      { action: 'mcp.use', resource: '*', effect: 'deny' },
      { action: 'mcp.use', resource: 'desktop-tools', effect: 'allow' },
      { action: 'skill.use', resource: '*', effect: 'deny' },
      ...approvedSkills.map(skill => ({ action: 'skill.use', resource: skill.id, effect: 'allow' })),
      { action: 'plugin.use', resource: '*', effect: 'deny' },
      { action: 'tool.use', resource: '*', effect: 'deny' },
      { action: 'tool.use', resource: 'read:*', effect: 'allow' },
      { action: 'tool.use', resource: 'glob:*', effect: 'allow' },
      { action: 'tool.use', resource: 'grep:*', effect: 'allow' },
      { action: 'tool.use', resource: 'question:*', effect: 'allow' },
      { action: 'tool.use', resource: 'skill:*', effect: 'allow' },
      ...approvedTools.map(tool => ({ action: 'tool.use', resource: `${tool}:*`, effect: 'allow' })),
      { action: 'tool.use', resource: 'shell:*', effect: 'deny' },
      { action: 'tool.use', resource: 'edit:*', effect: 'deny' },
      { action: 'tool.use', resource: 'execute:*', effect: 'deny' },
      { action: 'tool.use', resource: 'external_directory:*', effect: 'deny' }
    ]
  };
}

function parse(argv) {
  const [command, ...rest] = argv;
  if (!['install', 'validate', 'prepare', 'run', 'service', 'status'].includes(command)) fail('expected install, validate, prepare, run, service, or status');
  const values = Object.create(null);
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) fail('options must be --name value pairs');
    const name = flag.slice(2);
    if (!['runtime', 'runtime-archive', 'sha256', 'version', 'state-dir', 'port', 'output-dir', 'provisioning-context', 'session-context',
      'engine', 'engine-sha256', 'supervisor', 'supervisor-sha256', 'tools-archive', 'tools-sha256',
      'lock', 'lock-sha256', 'tool-context'].includes(name) || values[name] !== undefined) {
      fail(`unsupported or repeated option: ${flag}`);
    }
    values[name] = value;
  }
  return { command, values };
}

function defaultStateDirectory() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Desktop Tools');
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'desktop-tools');
}

function absoluteSafePath(input, label) {
  if (typeof input !== 'string' || !isAbsolute(input) || !safeTextPattern.test(input)) fail(`${label} must be a bounded absolute path`);
  return resolve(input);
}

async function protectedBase(input, label) {
  const target = absoluteSafePath(input, label);
  const root = resolve(sep);
  const segments = target.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      // Platform roots such as macOS /var -> /private/var are trusted existing
      // ancestors. The owned state directory itself and every child remain
      // non-symlink directories.
      if (info.isSymbolicLink() ? current === target : !info.isDirectory()) fail(`unsafe state path component: ${current}`, 73);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
  const info = await stat(target);
  if (typeof info.uid === 'number' && info.uid !== process.getuid?.()) fail('state directory is not owned by the current user', 77);
  await chmod(target, 0o700);
  return target;
}

async function protectedDirectory(input) {
  const target = await protectedBase(input || defaultStateDirectory(), 'state directory');
  for (const child of ['bin', 'run', 'runtime', 'config', 'data', 'history', 'recordings']) {
    await mkdir(join(target, child), { recursive: false, mode: 0o700 }).catch(error => { if (error?.code !== 'EEXIST') throw error; });
    const childInfo = await lstat(join(target, child));
    if (!childInfo.isDirectory() || childInfo.isSymbolicLink()) fail(`unsafe state child: ${child}`, 73);
    await chmod(join(target, child), 0o700);
  }
  return target;
}

async function sha256(path) {
  const hash = createHash('sha256');
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally { await handle.close(); }
  return hash.digest('hex');
}

function minimalEnvironment(stateDirectory, serverPassword, opencodeConfig, promptBinding) {
  const environment = {
    HOME: homedir(),
    PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: process.env.LANG && safeTextPattern.test(process.env.LANG) ? process.env.LANG : 'C.UTF-8',
    TMPDIR: tmpdir(),
    XDG_CONFIG_HOME: join(stateDirectory, 'config'),
    XDG_DATA_HOME: join(stateDirectory, 'data'),
    XDG_STATE_HOME: stateDirectory,
    DESKTOP_TOOLS_STATE_DIR: stateDirectory,
    OPENCODE_CONFIG_DIR: join(stateDirectory, 'config'),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig || {
      $schema: 'https://opencode.ai/config.json',
      permissions: [{ action: '*', resource: '*', effect: 'deny' }],
      policies: [
        { action: 'provider.use', resource: '*', effect: 'deny' },
        { action: 'integration.use', resource: '*', effect: 'deny' },
        { action: 'tool.use', resource: '*', effect: 'deny' }
      ]
    })
  };
  if (serverPassword) {
    environment.OPENCODE_SERVER_USERNAME = 'desktop-tools';
    environment.OPENCODE_SERVER_PASSWORD = serverPassword;
  }
  if (promptBinding) {
    environment.DESKTOP_TOOLS_PROMPT_VERSION = promptBinding.context.promptVersion;
    environment.DESKTOP_TOOLS_PROMPT_DIGEST = promptBinding.context.promptDigest;
    environment.DESKTOP_TOOLS_CONTEXT_DIGEST = promptBinding.context.contextDigest;
    environment.DESKTOP_TOOLS_PROMPT_EVIDENCE = promptBinding.evidencePath;
  }
  return Object.freeze(environment);
}

async function serverPassword(stateDirectory) {
  const path = join(stateDirectory, 'config', 'server-password');
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${randomBytes(32).toString('base64url')}\n`);
    await handle.close();
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error?.code !== 'EEXIST') throw error;
  }
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 32 || info.size > 128
    || (info.mode & 0o077) !== 0 || (typeof info.uid === 'number' && info.uid !== process.getuid?.())) {
    fail('OpenCode server credential state is unsafe', 77);
  }
  return (await readFile(path, 'utf8')).trim();
}

function execute(file, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { shell: false, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; if (stdout.length > 65_536) child.kill('SIGKILL'); });
    child.stderr?.on('data', chunk => { stderr += chunk; if (stderr.length > 65_536) child.kill('SIGKILL'); });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

async function validateRuntime(values, stateDirectory) {
  const runtime = absoluteSafePath(values.runtime, 'runtime');
  if (!digestPattern.test(values.sha256 || '')) fail('sha256 must be a lowercase SHA-256 digest');
  if (!versionPattern.test(values.version || '')) fail('version must be a supported pinned OpenCode version');
  const info = await lstat(runtime);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > 268_435_456) fail('runtime must be one bounded regular file', 65);
  if ((info.mode & 0o111) === 0) fail('runtime is not executable', 65);
  if (await sha256(runtime) !== values.sha256) fail('runtime digest does not match the signed pin', 65);
  const result = await execute(runtime, ['--version'], { env: minimalEnvironment(stateDirectory), stdio: ['ignore', 'pipe', 'pipe'] });
  const observed = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code !== 0 || !new RegExp(`(?:^|[^0-9])${values.version.replaceAll('.', '\\.').replace('-', '\\-')}(?:$|[^0-9])`).test(observed)) {
    fail('runtime version does not match the signed pin', 65);
  }
  return runtime;
}

async function atomicWrite(path, contents, mode = 0o600) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, contents, { mode, flag: 'wx' });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

function compareKeys(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareKeys(left, right))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}
function objectWithExactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort(compareKeys)) !== JSON.stringify([...keys].sort(compareKeys))) {
    fail(`${label} has an invalid shape`, 65);
  }
}
function boundedIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)) fail(`${label} is invalid`, 65);
}
function assertNonsecretJson(value, depth = 0) {
  if (depth > 32) fail('provisioning context is too deeply nested', 65);
  if (Array.isArray(value)) { if (value.length > 2048) fail('provisioning context array is too large', 65); value.forEach(child => assertNonsecretJson(child, depth + 1)); return; }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!key || key.length > 256 || /(?:secret|token|password|credential|private.?key)/i.test(key)) fail('provisioning context contains secret-shaped data', 65);
      assertNonsecretJson(child, depth + 1);
    }
    return;
  }
  if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') fail('provisioning context contains unsupported data', 65);
  if (typeof value === 'string' && value.length > 16384) fail('provisioning context string is too large', 65);
  if (typeof value === 'number' && !Number.isFinite(value)) fail('provisioning context number is invalid', 65);
}

async function prepareProvisioningPrompt(contextPath, stateDirectory) {
  const path = absoluteSafePath(contextPath, 'provisioning context');
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > 262_144) {
    fail('provisioning context must be one bounded regular file', 65);
  }
  let context;
  try { context = JSON.parse(await readFile(path, 'utf8')); } catch { fail('provisioning context must be valid JSON', 65); }
  objectWithExactKeys(context, ['schemaVersion', 'promptVersion', 'promptDigest', 'profile', 'release', 'discoveredFacts', 'policy', 'capabilities', 'permittedTools', 'contextDigest'], 'provisioning context');
  objectWithExactKeys(context.profile, ['id', 'revision', 'digest'], 'profile binding');
  objectWithExactKeys(context.release, ['id', 'version', 'digest'], 'release binding');
  if (context.schemaVersion !== 1 || context.promptVersion !== PROVISIONING_PROMPT_VERSION) fail('unsupported provisioning prompt context version', 65);
  for (const [label, value] of [['profile id', context.profile.id], ['profile revision', context.profile.revision], ['release id', context.release.id], ['release version', context.release.version]]) boundedIdentifier(value, label);
  for (const value of [context.promptDigest, context.contextDigest, context.profile.digest, context.release.digest]) if (!digestPattern.test(value || '')) fail('provisioning context digest is invalid', 65);
  for (const [label, values] of [['capabilities', context.capabilities], ['permitted tools', context.permittedTools]]) {
    if (!Array.isArray(values) || values.length > 128 || values.some((value, index) => {
      try { boundedIdentifier(value, label); } catch { return true; }
      return index > 0 && values[index - 1] >= value;
    })) fail(`${label} must be a sorted unique bounded list`, 65);
  }
  if (context.permittedTools.some(tool => !approvedTools.includes(tool))) fail('provisioning context permits an unapproved tool', 77);
  assertNonsecretJson(context.discoveredFacts);
  assertNonsecretJson(context.policy);
  const promptDigest = createHash('sha256').update(PROVISIONING_PROMPT, 'utf8').digest('hex');
  if (context.promptDigest !== promptDigest) fail('provisioning prompt digest mismatch', 65);
  const unsigned = { ...context }; delete unsigned.contextDigest;
  const canonicalContext = `${JSON.stringify(canonical(unsigned))}\n`;
  const canonicalFullContext = `${JSON.stringify(canonical(context))}\n`;
  const contextDigest = createHash('sha256').update(canonicalContext, 'utf8').digest('hex');
  if (context.contextDigest !== contextDigest) fail('provisioning context digest mismatch', 65);
  const promptDirectory = join(stateDirectory, 'config', 'prompts', contextDigest);
  await mkdir(promptDirectory, { recursive: true, mode: 0o700 });
  await chmod(promptDirectory, 0o700);
  const promptPath = join(promptDirectory, 'provisioning.md');
  const contextOutputPath = join(promptDirectory, 'context.json');
  const promptBundle = `${PROVISIONING_PROMPT}\n\nCanonical nonsecret provisioning context (${contextDigest}):\n\n\`\`\`json\n${canonicalContext}\`\`\`\n`;
  await atomicWrite(promptPath, promptBundle);
  await atomicWrite(contextOutputPath, canonicalFullContext);
  const evidenceDirectory = join(stateDirectory, 'history', 'prompt-bindings');
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await chmod(evidenceDirectory, 0o700);
  const evidencePath = join(evidenceDirectory, `${contextDigest}.json`);
  const evidence = `${JSON.stringify(canonical({
    schemaVersion: 1, state: 'recorded-before-execution', promptVersion: context.promptVersion,
    promptDigest, contextDigest, profile: context.profile, release: context.release,
    capabilities: context.capabilities, permittedTools: context.permittedTools,
  }))}\n`;
  let evidenceHandle;
  try {
    evidenceHandle = await open(evidencePath, 'wx', 0o600);
    await evidenceHandle.writeFile(evidence);
    await evidenceHandle.sync();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    if (await readFile(evidencePath, 'utf8') !== evidence) fail('provisioning prompt evidence collision', 73);
  } finally { await evidenceHandle?.close(); }
  return { context, promptPath, contextOutputPath, evidencePath };
}

async function installPinnedFile(source, destination, expectedDigest, mode) {
  try {
    const info = await lstat(destination);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || await sha256(destination) !== expectedDigest) {
      fail(`installed runtime file is not the pinned artifact: ${destination}`, 65);
    }
    await chmod(destination, mode);
    return destination;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    await copyFile(source, temporary, fsConstants.COPYFILE_EXCL);
    if (await sha256(temporary) !== expectedDigest) fail('artifact changed while installing protected runtime state', 65);
    await chmod(temporary, mode);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return destination;
}

async function boundedPinnedSource(pathValue, digest, label, maximum) {
  const path = absoluteSafePath(pathValue, label);
  if (!digestPattern.test(digest || '')) fail(`${label} digest must be a lowercase SHA-256`, 65);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > maximum) {
    fail(`${label} must be one bounded regular file`, 65);
  }
  if (await sha256(path) !== digest) fail(`${label} digest does not match the signed release`, 65);
  return path;
}

function zipExecutable(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0 || end + 22 > bytes.length || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0
    || bytes.readUInt16LE(end + 8) !== 1 || bytes.readUInt16LE(end + 10) !== 1 || bytes.readUInt16LE(end + 20) !== 0) {
    fail('OpenCode zip must contain exactly one local entry without spanning or comments', 65);
  }
  const centralSize = bytes.readUInt32LE(end + 12); const centralOffset = bytes.readUInt32LE(end + 16);
  if (centralOffset + centralSize !== end || centralSize < 46 || bytes.readUInt32LE(centralOffset) !== 0x02014b50) fail('OpenCode zip central directory is malformed', 65);
  const flags = bytes.readUInt16LE(centralOffset + 8); const method = bytes.readUInt16LE(centralOffset + 10);
  const compressedSize = bytes.readUInt32LE(centralOffset + 20); const uncompressedSize = bytes.readUInt32LE(centralOffset + 24);
  const nameLength = bytes.readUInt16LE(centralOffset + 28); const extraLength = bytes.readUInt16LE(centralOffset + 30);
  const commentLength = bytes.readUInt16LE(centralOffset + 32); const localOffset = bytes.readUInt32LE(centralOffset + 42);
  if ((flags & 1) !== 0 || ![0, 8].includes(method) || uncompressedSize < 1 || uncompressedSize > 268_435_456
    || 46 + nameLength + extraLength + commentLength !== centralSize) fail('OpenCode zip entry policy is unsupported', 65);
  const name = bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');
  if (name !== 'opencode' || basename(name) !== name || bytes.readUInt32LE(localOffset) !== 0x04034b50) fail('OpenCode zip entry is not the exact executable', 65);
  const localFlags = bytes.readUInt16LE(localOffset + 6); const localMethod = bytes.readUInt16LE(localOffset + 8);
  const localNameLength = bytes.readUInt16LE(localOffset + 26); const localExtraLength = bytes.readUInt16LE(localOffset + 28);
  const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
  const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
  if (localFlags !== flags || localMethod !== method || localName !== name || dataOffset + compressedSize > centralOffset) fail('OpenCode zip local entry differs from its directory', 65);
  let executable;
  try { executable = method === 0 ? bytes.subarray(dataOffset, dataOffset + compressedSize) : inflateRawSync(bytes.subarray(dataOffset, dataOffset + compressedSize), { maxOutputLength: 268_435_456 }); }
  catch { fail('OpenCode zip executable cannot be safely expanded', 65); }
  if (executable.length !== uncompressedSize) fail('OpenCode zip expanded size mismatch', 65);
  return executable;
}

function archiveExecutable(bytes) {
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) return zipExecutable(bytes);
  let expanded;
  try { expanded = gunzipSync(bytes, { maxOutputLength: 268_435_456 }); } catch { fail('OpenCode tar archive cannot be safely expanded', 65); }
  const entries = tarEntries(expanded);
  if (entries.size !== 1 || !entries.has('opencode')) fail('OpenCode tar archive must contain exactly one executable', 65);
  return entries.get('opencode');
}

async function installRuntimeClosure(values, stateDirectory) {
  for (const name of ['runtime-archive', 'sha256', 'version', 'supervisor', 'supervisor-sha256', 'tools-archive', 'tools-sha256', 'lock', 'lock-sha256']) {
    if (!values[name]) fail(`install requires --${name}`, 64);
  }
  if (!versionPattern.test(values.version)) fail('version must be a supported pinned OpenCode version', 65);
  const archive = await boundedPinnedSource(values['runtime-archive'], values.sha256, 'OpenCode archive', 268_435_456);
  const supervisorSource = await boundedPinnedSource(values.supervisor, values['supervisor-sha256'], 'supervisor', 8_388_608);
  const toolsSource = await boundedPinnedSource(values['tools-archive'], values['tools-sha256'], 'tools archive', 33_554_432);
  const lockSource = await boundedPinnedSource(values.lock, values['lock-sha256'], 'OpenCode lock', 8_388_608);
  let lock;
  try { lock = JSON.parse(await readFile(lockSource, 'utf8')); } catch { fail('OpenCode lock must be valid JSON', 65); }
  const platform = `${process.platform === 'darwin' ? 'macos' : process.platform}_${process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch}`;
  const binding = lock?.artifacts?.[platform];
  if (lock?.schemaVersion !== 1 || lock?.name !== 'opencode' || lock?.version !== values.version || !binding
    || binding.sha256 !== values.sha256 || !['macos_x64', 'macos_arm64', 'linux_x64', 'linux_arm64'].includes(platform)) {
    fail('OpenCode lock does not bind this platform, version, and archive', 65);
  }
  const executableBytes = archiveExecutable(await readFile(archive));
  const runtimeDigest = createHash('sha256').update(executableBytes).digest('hex');
  const runtime = join(stateDirectory, 'runtime', `opencode-${runtimeDigest}`);
  const executable = join(stateDirectory, 'bin', 'desktop-tools');
  const supervisor = join(stateDirectory, 'bin', `desktop-tools-supervisor-${values['supervisor-sha256']}.mjs`);
  const toolsArchive = join(stateDirectory, 'runtime', `desktop-tools-tools-${values['tools-sha256']}.tar.gz`);
  const installedLock = join(stateDirectory, 'runtime', `opencode-lock-${values['lock-sha256']}.json`);
  const targets = [runtime, executable, supervisor, toolsArchive, installedLock];
  const changed = (await Promise.all(targets.map(path => lstat(path).then(() => false, error => error?.code === 'ENOENT' ? true : Promise.reject(error))))).some(Boolean);
  if (!(await lstat(runtime).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error)))) await atomicWrite(runtime, executableBytes, 0o700);
  else if (await sha256(runtime) !== runtimeDigest) fail('installed OpenCode runtime is not the pinned artifact', 65);
  await chmod(runtime, 0o700);
  const executableInfo = await lstat(executable).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (executableInfo && (!executableInfo.isFile() || executableInfo.isSymbolicLink() || executableInfo.nlink !== 1 || await sha256(executable) !== runtimeDigest)) {
    if (!executableInfo.isFile() || executableInfo.isSymbolicLink()) fail('Desktop Tools executable path is unsafe', 73);
    await atomicWrite(executable, executableBytes, 0o700);
  } else if (!executableInfo) {
    await atomicWrite(executable, executableBytes, 0o700);
  }
  await installPinnedFile(supervisorSource, supervisor, values['supervisor-sha256'], 0o700);
  await installPinnedFile(toolsSource, toolsArchive, values['tools-sha256'], 0o600);
  await installPinnedFile(lockSource, installedLock, values['lock-sha256'], 0o600);
  await validateRuntime({ runtime, sha256: runtimeDigest, version: values.version }, stateDirectory);
  const closure = canonical({ schemaVersion: 1, version: values.version, archiveSha256: values.sha256, executable, runtime, runtimeSha256: runtimeDigest,
    supervisor, supervisorSha256: values['supervisor-sha256'], toolsArchive, toolsSha256: values['tools-sha256'], lock: installedLock, lockSha256: values['lock-sha256'] });
  const closureDigest = createHash('sha256').update(`${JSON.stringify(closure)}\n`).digest('hex');
  const receipt = join(stateDirectory, 'runtime', `closure-${closureDigest}.json`); const receiptBytes = `${JSON.stringify(closure)}\n`;
  const existingReceipt = await readFile(receipt, 'utf8').catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (existingReceipt === null) await atomicWrite(receipt, receiptBytes);
  else if (existingReceipt !== receiptBytes) fail('runtime closure receipt collision', 73);
  return { ...closure, closureDigest, receipt, changed };
}

function tarEntries(bytes) {
  const entries = new Map();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      if (offset + 512 > bytes.length || !bytes.subarray(offset, offset + 512).every(byte => byte === 0)
        || !bytes.subarray(offset + 512).every(byte => byte === 0)) fail('tools archive has invalid trailing structure', 65);
      return entries;
    }
    const name = header.subarray(0, 100).toString('utf8').split('\0', 1)[0];
    const sizeText = header.subarray(124, 136).toString('ascii').replaceAll('\0', '').trim();
    const checksumText = header.subarray(148, 156).toString('ascii').replaceAll('\0', '').trim();
    const checksumHeader = Buffer.from(header); checksumHeader.fill(0x20, 148, 156);
    if (!name || !/^[0-7]+$/.test(sizeText) || !/^[0-7]+$/.test(checksumText)
      || Number.parseInt(checksumText, 8) !== checksumHeader.reduce((sum, byte) => sum + byte, 0)
      || (header[156] !== 0 && header[156] !== 0x30) || name.startsWith('/') || name.split('/').includes('..') || entries.has(name)) fail('tools archive is malformed', 65);
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length) fail('tools archive entry is malformed', 65);
    entries.set(name, bytes.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  fail('tools archive lacks its two-block terminator', 65);
}

async function prepareToolRuntime(values, stateDirectory, promptBinding, session) {
  for (const name of ['engine', 'engine-sha256', 'tools-archive', 'tools-sha256', 'tool-context']) {
    if (!values[name]) fail(`run and service require --${name}`, 64);
  }
  if (!digestPattern.test(values['engine-sha256']) || !digestPattern.test(values['tools-sha256'])) fail('tool runtime digests must be lowercase SHA-256', 65);
  const engineSource = absoluteSafePath(values.engine, 'installer engine');
  const toolsSource = absoluteSafePath(values['tools-archive'], 'tools archive');
  const contextSource = absoluteSafePath(values['tool-context'], 'tool context');
  for (const [path, label, maximum] of [[engineSource, 'installer engine', 67_108_864], [toolsSource, 'tools archive', 33_554_432], [contextSource, 'tool context', 4_194_304]]) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > maximum) fail(`${label} must be one bounded regular file`, 65);
  }
  if (await sha256(engineSource) !== values['engine-sha256'] || await sha256(toolsSource) !== values['tools-sha256']) fail('tool runtime digest mismatch', 65);
  const engine = await installPinnedFile(engineSource, join(stateDirectory, 'runtime', `desktop-tools-engine-${values['engine-sha256']}.mjs`), values['engine-sha256'], 0o700);
  const toolsArchive = await installPinnedFile(toolsSource, join(stateDirectory, 'runtime', `desktop-tools-tools-${values['tools-sha256']}.tar.gz`), values['tools-sha256'], 0o600);
  let expanded;
  try { expanded = gunzipSync(await readFile(toolsArchive), { maxOutputLength: 64 * 1024 * 1024 }); } catch { fail('tools archive cannot be safely expanded', 65); }
  const entries = tarEntries(expanded);
  const legacyEntries = ['bin/desktop-tools-mcp-server.mjs', 'contracts/runtime-policy.json', 'contracts/supervisor-api.schema.json', 'contracts/typed-tools.json'];
  const baseEntries = ['bin/desktop-tools-mcp-server.mjs', 'contracts/runtime-policy.json', 'contracts/supervisor-api.schema.json',
    'contracts/typed-tools.json', 'runtime/encrypted-recording.mjs'];
  const brokerEntries = [...baseEntries, 'bin/linux-x64/desktop-tools-privileged-broker',
    'lib/desktop-tools-privileged-controller.mjs', 'lib/desktop-tools-privileged-worker.mjs'];
  const actualEntries = [...entries.keys()].sort();
  const provisioningPrefix = 'provisioning/home/dot_local/bin/';
  const provisioningEntries = actualEntries.filter(name => name.startsWith(provisioningPrefix));
  const coreEntries = actualEntries.filter(name => !name.startsWith(provisioningPrefix));
  const installxPlanningEntry = `${provisioningPrefix}executable_installx`;
  const planningClosureValid = provisioningEntries.length === 0 || provisioningEntries.includes(installxPlanningEntry)
    && provisioningEntries.every(name => name === installxPlanningEntry
      || /^provisioning\/home\/dot_local\/bin\/post-installx\/executable_post-[a-z0-9][a-z0-9._+-]{0,127}\.sh$/.test(name));
  if (!planningClosureValid || ![legacyEntries, baseEntries, brokerEntries].some(expected => JSON.stringify(coreEntries) === JSON.stringify([...expected].sort()))) {
    fail('tools archive contains an unexpected closure', 65);
  }
  const serverBytes = entries.get('bin/desktop-tools-mcp-server.mjs');
  if (!serverBytes || serverBytes.length < 1 || serverBytes.length > 8 * 1024 * 1024) fail('signed tools archive lacks the MCP server', 65);
  const serverDigest = createHash('sha256').update(serverBytes).digest('hex');
  const server = join(stateDirectory, 'bin', `desktop-tools-mcp-server-${serverDigest}.mjs`);
  try {
    const info = await lstat(server);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || await sha256(server) !== serverDigest) fail('installed MCP server is not the signed artifact', 65);
    await chmod(server, 0o700);
  } catch (error) { if (error?.code === 'ENOENT') await atomicWrite(server, serverBytes, 0o700); else throw error; }
  const contextDigest = await sha256(contextSource);
  let toolContext;
  try { toolContext = JSON.parse(await readFile(contextSource, 'utf8')); } catch { fail('tool context must be valid JSON', 65); }
  objectWithExactKeys(toolContext, ['schemaVersion', 'sessionId', 'runId', 'authorizationId', 'releaseId', 'releaseDigest', 'profileRevision', 'profileDigest',
    'facts', 'desiredState', 'plan', 'operations'], 'tool context');
  if (toolContext.schemaVersion !== 1 || toolContext.sessionId !== session.sessionId || toolContext.runId !== session.runId
    || toolContext.authorizationId !== session.authorization.id
    || toolContext.releaseId !== promptBinding.context.release.id || toolContext.releaseDigest !== promptBinding.context.release.digest
    || toolContext.profileRevision !== promptBinding.context.profile.revision || toolContext.profileDigest !== promptBinding.context.profile.digest
    || promptBinding.context.policy?.toolContextDigest !== contextDigest) fail('tool context is not bound to the verified provisioning session', 77);
  const context = await installPinnedFile(contextSource, join(stateDirectory, 'config', `tool-context-${contextDigest}.json`), contextDigest, 0o600);
  const consentDirectory = join(stateDirectory, 'run', 'consents');
  await mkdir(consentDirectory, { recursive: true, mode: 0o700 }); await chmod(consentDirectory, 0o700);
  return Object.freeze({ server, engine, engineSha256: values['engine-sha256'], toolsArchive, context, stateRoot: stateDirectory, consentDirectory });
}

async function acquireLock(stateDirectory) {
  const path = join(stateDirectory, 'run', 'supervisor.pid');
  try {
    const handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${process.pid}\n`);
    await handle.close();
    return async () => rm(path, { force: true });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const pid = Number.parseInt(await readFile(path, 'utf8').catch(() => ''), 10);
    if (Number.isSafeInteger(pid) && pid > 1) {
      try { process.kill(pid, 0); fail(`supervisor is already running as pid ${pid}`, 75); }
      catch (checkError) { if (checkError?.exitCode) throw checkError; if (checkError?.code === 'EPERM') fail('another supervisor owns the lock', 77); }
    }
    await rm(path, { force: true });
    return acquireLock(stateDirectory);
  }
}

function systemdEscape(value) { return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`; }
function xml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }

async function writeService(values, stateDirectory, runtime) {
  const output = await protectedBase(values['output-dir'], 'output directory');
  const port = portValue(values.port);
  const supervisorSource = fileURLToPath(import.meta.url);
  const supervisorDigest = await sha256(supervisorSource);
  const supervisor = await installPinnedFile(supervisorSource, join(stateDirectory, 'bin', 'desktop-tools-supervisor.mjs'), supervisorDigest, 0o700);
  const evidenceSource = fileURLToPath(new URL('./session-evidence.mjs', import.meta.url));
  try {
    const evidenceDigest = await sha256(evidenceSource);
    await installPinnedFile(evidenceSource, join(stateDirectory, 'bin', 'session-evidence.mjs'), evidenceDigest, 0o600);
  } catch (error) {
    // Release builds inline this module into the signed supervisor. Source-tree
    // execution retains the adjacent module and installs it for restart parity.
    if (error?.code !== 'ENOENT') throw error;
  }
  const installedRuntime = await installPinnedFile(runtime, join(stateDirectory, 'runtime', `opencode-${values.sha256}`), values.sha256, 0o700);
  if (!values['provisioning-context']) fail('service requires --provisioning-context', 64);
  if (!values['session-context']) fail('service requires --session-context', 64);
  const promptBinding = await prepareProvisioningPrompt(values['provisioning-context'], stateDirectory);
  const session = await loadSessionContext(values['session-context']);
  const sessionContextPath = await persistSessionContext(stateDirectory, session);
  const toolRuntime = await prepareToolRuntime(values, stateDirectory, promptBinding, session);
  const fixed = [supervisor, 'run', '--runtime', installedRuntime, '--sha256', values.sha256, '--version', values.version,
    '--state-dir', stateDirectory, '--port', String(port), '--provisioning-context', promptBinding.contextOutputPath,
    '--session-context', sessionContextPath, '--engine', toolRuntime.engine, '--engine-sha256', toolRuntime.engineSha256,
    '--tools-archive', toolRuntime.toolsArchive, '--tools-sha256', values['tools-sha256'], '--tool-context', toolRuntime.context];
  const unit = `[Unit]\nDescription=Desktop Tools private OpenCode supervisor\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=${fixed.map(systemdEscape).join(' ')}\nRestart=on-failure\nRestartSec=5s\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=read-only\nReadWritePaths=${systemdEscape(stateDirectory)}\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
  const argumentsXml = fixed.map(value => `      <string>${xml(value)}</string>`).join('\n');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>tools.desktop.supervisor</string>\n  <key>ProgramArguments</key><array>\n${argumentsXml}\n  </array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n  <key>ProcessType</key><string>Background</string>\n  <key>Umask</key><integer>63</integer>\n</dict></plist>\n`;
  await atomicWrite(join(output, 'desktop-tools-supervisor.service'), unit);
  await atomicWrite(join(output, 'tools.desktop.supervisor.plist'), plist);
  return output;
}

function portValue(input) {
  const port = Number(input ?? 4096);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) fail('port must be an unprivileged TCP port');
  return port;
}

async function main(argv) {
  const { command, values } = parse(argv);
  const stateDirectory = await protectedDirectory(values['state-dir']);
  if (command === 'prepare') return { stateDirectory };
  if (command === 'install') return installRuntimeClosure(values, stateDirectory);
  if (command === 'status') {
    const pid = Number.parseInt(await readFile(join(stateDirectory, 'run', 'supervisor.pid'), 'utf8').catch(() => ''), 10);
    let running = false;
    if (Number.isSafeInteger(pid) && pid > 1) try { process.kill(pid, 0); running = true; } catch {}
    return { stateDirectory, running, pid: running ? pid : null };
  }
  const runtime = await validateRuntime(values, stateDirectory);
  if (command === 'validate') return { runtime, version: values.version, sha256: values.sha256 };
  if (command === 'service') return { outputDirectory: await writeService(values, stateDirectory, runtime) };
  const port = portValue(values.port);
  const password = await serverPassword(stateDirectory);
  const inferenceCredential = await validateInferenceCredential(stateDirectory);
  await installPinnedSkills(stateDirectory);
  if (!values['provisioning-context']) fail('run requires --provisioning-context', 64);
  if (!values['session-context']) fail('run requires --session-context', 64);
  const promptBinding = await prepareProvisioningPrompt(values['provisioning-context'], stateDirectory);
  const session = await loadSessionContext(values['session-context']);
  const toolRuntime = await prepareToolRuntime(values, stateDirectory, promptBinding, session);
  const opencodeConfig = generateOpenCodeConfig(inferenceCredential, promptBinding.promptPath, toolRuntime);
  const evidence = await initializeSessionEvidence({
    stateDirectory,
    session,
    promptBinding,
    runtime: { version: values.version, digest: values.sha256 },
    skills: approvedSkills,
    tools: promptBinding.context.permittedTools,
  });
  const releaseLock = await acquireLock(stateDirectory);
  const child = spawn(runtime, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    shell: false, env: minimalEnvironment(stateDirectory, password, opencodeConfig, promptBinding), stdio: 'inherit'
  });
  let receivedSignal = null;
  const forward = signal => { receivedSignal = signal; if (!child.killed) child.kill(signal); };
  process.once('SIGINT', forward); process.once('SIGTERM', forward);
  const result = await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  }).finally(async () => {
    process.removeListener('SIGINT', forward);
    process.removeListener('SIGTERM', forward);
    await releaseLock();
  });
  const finalized = await execute(process.execPath, [toolRuntime.server, '--finalize-events', '--context', toolRuntime.context,
    '--state-root', stateDirectory, '--status', receivedSignal || result.signal ? 'cancellation' : 'failure'], {
    env: { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (finalized.code !== 0 || finalized.signal) fail('session event finalization failed', 74);
  if (result.signal) fail(`OpenCode stopped by ${result.signal}`, 1);
  if (result.code !== 0) fail(`OpenCode exited with status ${result.code}`, result.code || 1);
  return { stopped: true, evidence };
}

export { PROVISIONING_PROMPT, PROVISIONING_PROMPT_VERSION, VERSION, approvedSkills, approvedTools, generateOpenCodeConfig, initializeSessionEvidence, installRuntimeClosure, loadSessionContext, main, minimalEnvironment, persistSessionContext, prepareProvisioningPrompt, protectedDirectory, validateInferenceCredential, validateRuntime };

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then(result => process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...result })}\n`))
    .catch(error => { process.stderr.write(`desktop-tools-supervisor: ${error instanceof Error ? error.message : 'unknown failure'}\n`); process.exitCode = error?.exitCode || 1; });
}
