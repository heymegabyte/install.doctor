import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { renderDropIn, validateGatewayArgv } from './openclaw-systemd-reconciler.mjs';

const scripts = dirname(new URL(import.meta.url).pathname);
const reconciler = join(scripts, 'openclaw-systemd-reconciler.mjs');
const temp = mkdtempSync(join(tmpdir(), 'openclaw-systemd-reconciler-'));
const runtime = join(temp, 'runtime');
const canonical = join(temp, 'canonical');
const dropIn = join(temp, 'systemd/openclaw-gateway.service.d/40-mcp-automation.conf');
const receipt = join(temp, 'state/receipt.json');
const node = '/home/runner/.volta/tools/image/node/24.1.0/bin/node';
const entrypoint = '/home/runner/.volta/tools/image/packages/openclaw/lib/node_modules/openclaw/dist/index.js';
const argv = [node, entrypoint, 'gateway', '--port', '18789'];

assert.deepEqual(validateGatewayArgv(argv), argv);
assert.throws(() => validateGatewayArgv(['/usr/bin/node', '/tmp/not-the-product.js', 'gateway']), /OpenClaw/);
assert.throws(() => validateGatewayArgv([node, entrypoint, 'gateway', 'bad value']), /unsupported/);
const rendered = renderDropIn({ gatewayArgv: argv, hostClass: 'ubuntu-runner', adapterPath: '/home/runner/.local/lib/adapter.mjs',
  pinPath: '/home/runner/.local/share/pin.json', profilesPath: '/home/runner/.local/share/profiles' });
assert.match(rendered, /^\[Service\]\nExecStart=\n/);
assert.match(rendered, new RegExp(`${node} .* --allowed-executable ${node} -- ${node} ${entrypoint} gateway --port 18789`));
assert.equal((rendered.match(/18789/g) ?? []).length, 1);

const bin = join(temp, 'bin');
const log = join(temp, 'lifecycle.log');
const failMarker = join(temp, 'fail-verify');
mkdirSync(bin);
writeFileSync(join(bin, 'systemctl'), `#!/bin/sh\nprintf '%s\\n' "systemctl $*" >>"${log}"\ncase "$*" in *'--property=ExecStart --value'*) printf '%s\\n' '{ path=${node} ; argv[]=${node} ${entrypoint} gateway --port 18789 ; }' ;; esac\nexit 0\n`);
writeFileSync(join(bin, 'systemd-analyze'), `#!/bin/sh\nprintf '%s\\n' "systemd-analyze $*" >>"${log}"\n[ ! -f "${failMarker}" ]\n`);
chmodSync(join(bin, 'systemctl'), 0o700);
chmodSync(join(bin, 'systemd-analyze'), 0o700);
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
const common = ['--host-class', 'ubuntu-runner', '--gateway-argv-json', JSON.stringify(argv), '--runtime-directory', runtime,
  '--canonical-directory', canonical, '--drop-in', dropIn];

const planText = execFileSync(process.execPath, [reconciler, 'plan', ...common], { encoding: 'utf8', env });
const plan = JSON.parse(planText);
assert.equal(plan.gatewayPort, 18789);
assert.match(plan.gatewayArgvDigest, /^sha256:/);
assert.match(plan.unitExecStartDigest, /^sha256:/);
assert.equal(planText.includes(entrypoint), false, 'plan must report only the argv digest');
assert.equal(existsSync(dropIn), false);

const applied = JSON.parse(execFileSync(process.execPath, [reconciler, 'apply', ...common, '--receipt', receipt,
  '--expected-exec-start-digest', plan.unitExecStartDigest], { encoding: 'utf8', env }));
assert.equal(applied.health, 'active');
assert.equal(statSync(dropIn).mode & 0o777, 0o600);
assert.equal(statSync(join(runtime, 'openclaw-mcp-automation-adapter.mjs')).mode & 0o777, 0o600);
assert.equal(statSync(receipt).mode & 0o777, 0o600);
const installed = readFileSync(dropIn, 'utf8');
assert.match(installed, new RegExp(`${node} .* -- ${node} ${entrypoint} gateway --port 18789`));
assert.equal(readFileSync(receipt, 'utf8').includes(entrypoint), false);
const lifecycle = readFileSync(log, 'utf8');
assert.match(lifecycle, /systemctl --user daemon-reload/);
assert.match(lifecycle, /systemd-analyze --user verify openclaw-gateway.service/);
assert.match(lifecycle, /systemctl --user restart openclaw-gateway.service/);
assert.match(lifecycle, /systemctl --user is-active --quiet openclaw-gateway.service/);
assert.ok(lifecycle.indexOf('systemd-analyze --user verify') < lifecycle.indexOf('systemctl --user daemon-reload'));

const rolledBack = JSON.parse(execFileSync(process.execPath, [reconciler, 'rollback', '--receipt', receipt], { encoding: 'utf8', env }));
assert.equal(rolledBack.health, 'active');
assert.equal(existsSync(dropIn), false);

const failedDropIn = join(temp, 'failed/systemd/40-mcp-automation.conf');
const failedReceipt = join(temp, 'failed/state/receipt.json');
writeFileSync(failMarker, 'fail');
assert.throws(() => execFileSync(process.execPath, [reconciler, 'apply', ...common.slice(0, -2), '--drop-in', failedDropIn,
  '--receipt', failedReceipt, '--expected-exec-start-digest', plan.unitExecStartDigest], { encoding: 'utf8', env, stdio: 'pipe' }), /service activation failed/);
assert.equal(existsSync(failedDropIn), false, 'failed activation must restore the absent predecessor');

console.log('openclaw systemd reconciler: ok');
