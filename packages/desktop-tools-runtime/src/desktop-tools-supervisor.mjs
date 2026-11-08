#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1';
const digestPattern = /^[a-f0-9]{64}$/;
const versionPattern = /^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const safeTextPattern = /^[^\0\r\n]{1,4096}$/;
const PROVIDER_ID = 'projectsites';
const PROVIDER_BASE_URL = 'https://desktop.tools/api/ai/v1';
const PROVISIONING_SKILL = '---\nname: desktop-tools-provisioning\ndescription: Inspect, validate, plan, and report Desktop Tools desired state through approved typed tools.\nversion: 1.0.0\n---\n\nUse only the Desktop Tools typed tools exposed for this session. Discover before planning. Never use shell, edit files directly, access external directories, or claim mutation or verification that a typed tool did not report.\n';
const approvedSkills = Object.freeze([
  Object.freeze({ id: 'desktop-tools-provisioning', version: '1.0.0', sha256: '9cc5393b607af33a4ff9f73070f5ae87b6b9e6b5510d344ae93c3587672f71eb' })
]);
const approvedTools = Object.freeze([
  'desktop_tools_discover', 'desktop_tools_validate', 'desktop_tools_plan', 'desktop_tools_status'
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

function generateOpenCodeConfig(credentialPath) {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: `${PROVIDER_ID}/dynamic/code`,
    update: 'disable',
    snapshots: false,
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
  if (!['validate', 'prepare', 'run', 'service', 'status'].includes(command)) fail('expected validate, prepare, run, service, or status');
  const values = Object.create(null);
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) fail('options must be --name value pairs');
    const name = flag.slice(2);
    if (!['runtime', 'sha256', 'version', 'state-dir', 'port', 'output-dir'].includes(name) || values[name] !== undefined) {
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

function minimalEnvironment(stateDirectory, serverPassword, opencodeConfig) {
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
  const installedRuntime = await installPinnedFile(runtime, join(stateDirectory, 'runtime', `opencode-${values.sha256}`), values.sha256, 0o700);
  const fixed = [supervisor, 'run', '--runtime', installedRuntime, '--sha256', values.sha256, '--version', values.version,
    '--state-dir', stateDirectory, '--port', String(port)];
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
  const opencodeConfig = generateOpenCodeConfig(inferenceCredential);
  const releaseLock = await acquireLock(stateDirectory);
  const child = spawn(runtime, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    shell: false, env: minimalEnvironment(stateDirectory, password, opencodeConfig), stdio: 'inherit'
  });
  const forward = signal => { if (!child.killed) child.kill(signal); };
  process.once('SIGINT', forward); process.once('SIGTERM', forward);
  const result = await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  }).finally(async () => {
    process.removeListener('SIGINT', forward);
    process.removeListener('SIGTERM', forward);
    await releaseLock();
  });
  if (result.signal) fail(`OpenCode stopped by ${result.signal}`, 1);
  if (result.code !== 0) fail(`OpenCode exited with status ${result.code}`, result.code || 1);
  return { stopped: true };
}

export { VERSION, approvedSkills, approvedTools, generateOpenCodeConfig, main, minimalEnvironment, protectedDirectory, validateInferenceCredential, validateRuntime };

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then(result => process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...result })}\n`))
    .catch(error => { process.stderr.write(`desktop-tools-supervisor: ${error instanceof Error ? error.message : 'unknown failure'}\n`); process.exitCode = error?.exitCode || 1; });
}
