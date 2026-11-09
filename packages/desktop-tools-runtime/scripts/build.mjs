#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(root, '..', '..');
const output = join(root, 'dist');

function octal(value, length) { return `${value.toString(8).padStart(length - 1, '0')}\0`; }
function tarEntry(name, bytes, mode) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(mode, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(bytes.length, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write('root', 265, 4, 'ascii');
  header.write('root', 297, 4, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512);
  return Buffer.concat([header, bytes, padding]);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true, mode: 0o700 });
const supervisorSource = await readFile(join(root, 'src', 'desktop-tools-supervisor.mjs'), 'utf8');
const evidenceSource = await readFile(join(root, 'src', 'session-evidence.mjs'), 'utf8');
const bundledEvidence = evidenceSource
  .replace(/^import .*;\n/gm, '')
  .replaceAll('export ', '')
  .replace(/\bfail\(/g, 'evidenceFail(')
  .replaceAll('canonical', 'evidenceCanonical')
  .replaceAll('digestPattern', 'evidenceDigestPattern');
const supervisor = supervisorSource.replace("import { initializeSessionEvidence, loadSessionContext, persistSessionContext } from './session-evidence.mjs';", bundledEvidence.trim());
if (supervisor === supervisorSource) throw new Error('session evidence import was not bundled');
await writeFile(join(output, 'desktop-tools-supervisor.mjs'), supervisor, { mode: 0o700 });
await chmod(join(output, 'desktop-tools-supervisor.mjs'), 0o700);
const enginePackage = resolve(root, '..', 'installer-engine');
const mcpBuild = spawnSync('npm', ['run', 'bundle:mcp'], { cwd: enginePackage, stdio: 'inherit', shell: false });
if (mcpBuild.status !== 0) throw new Error('failed to build the Desktop Tools MCP server');
const entries = [];
for (const name of ['runtime-policy.json', 'supervisor-api.schema.json', 'typed-tools.json']) {
  const bytes = await readFile(join(root, 'contracts', name));
  entries.push(tarEntry(`contracts/${name}`, bytes, 0o600));
}
entries.push(tarEntry('bin/desktop-tools-mcp-server.mjs', await readFile(join(enginePackage, 'dist', 'desktop-tools-mcp-server.mjs')), 0o700));
entries.push(tarEntry('runtime/encrypted-recording.mjs', await readFile(join(root, 'src', 'encrypted-recording.mjs')), 0o600));
const provisioningBin = join(repositoryRoot, 'home', 'dot_local', 'bin');
const installx = await readFile(join(provisioningBin, 'executable_installx'));
if (installx.length < 1 || installx.length > 65_536) throw new Error('installx planning input is outside its bounded release policy');
entries.push(tarEntry('provisioning/home/dot_local/bin/executable_installx', installx, 0o700));
const systemIdentityProcessor = await readFile(join(repositoryRoot, 'home', 'dot_config', 'system', 'usr', 'local', 'bin', 'executable_process-software-groups'));
if (systemIdentityProcessor.length < 1 || systemIdentityProcessor.length > 1_048_576) throw new Error('software-groups planning input is outside its bounded release policy');
entries.push(tarEntry('provisioning/home/dot_config/system/usr/local/bin/executable_process-software-groups', systemIdentityProcessor, 0o700));
const hookRoot = join(provisioningBin, 'post-installx');
for (const name of (await readdir(hookRoot)).sort()) {
  if (!/^executable_post-[a-z0-9][a-z0-9._+-]{0,127}\.sh$/.test(name)) continue;
  const bytes = await readFile(join(hookRoot, name));
  if (bytes.length < 1 || bytes.length > 1_048_576) throw new Error(`post-installx planning input is outside its bounded release policy: ${name}`);
  entries.push(tarEntry(`provisioning/home/dot_local/bin/post-installx/${name}`, bytes, 0o700));
}
const brokerPath = process.env.DESKTOP_TOOLS_PRIVILEGED_BROKER;
const workerPath = process.env.DESKTOP_TOOLS_PRIVILEGED_WORKER;
const controllerPath = process.env.DESKTOP_TOOLS_PRIVILEGED_CONTROLLER;
const requireBroker = process.env.DESKTOP_TOOLS_REQUIRE_PRIVILEGED_BROKER === 'true';
if (new Set([brokerPath, workerPath, controllerPath].map(value => value === undefined)).size !== 1
  || requireBroker && (!brokerPath || !workerPath || !controllerPath)) {
  throw new Error('privileged broker, worker, and controller must be supplied together for the production tools closure');
}
if (brokerPath && workerPath && controllerPath) {
  entries.push(tarEntry('bin/linux-x64/desktop-tools-privileged-broker', await readFile(resolve(brokerPath)), 0o700));
  entries.push(tarEntry('lib/desktop-tools-privileged-worker.mjs', await readFile(resolve(workerPath)), 0o600));
  entries.push(tarEntry('lib/desktop-tools-privileged-controller.mjs', await readFile(resolve(controllerPath)), 0o600));
}
entries.push(Buffer.alloc(1024));
await writeFile(join(output, 'desktop-tools-tools.tar.gz'), gzipSync(Buffer.concat(entries), { level: 9, mtime: 0 }), { mode: 0o600 });
