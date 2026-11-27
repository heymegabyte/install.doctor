import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const launcher = fileURLToPath(new URL('../../../home/dot_local/bin/executable_infisical-workload-run', import.meta.url));

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'infisical-workload-'));
  const bin = path.join(directory, 'bin');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
  const manifest = path.join(directory, 'manifest.json');
  await writeFile(manifest, JSON.stringify({
    schemaVersion: 1,
    workloads: [{
      id: 'demo', identityId: 'identity-demo', projectId: '00000000-0000-4000-8000-000000000002', environment: 'prod',
      secretPath: '/workloads/demo',
      principal: { kind: 'service', authMode: 'workload-identity', provider: 'infisical' },
      delivery: 'environment',
      secrets: [{ secretName: 'DEMO_PASSWORD', environmentVariable: 'APP_PASSWORD' }]
    }]
  }));
  await writeFile(path.join(bin, 'infisical'), `#!/bin/sh
[ "$1" = secrets ] && [ "$2" = get ] && [ "$3" = DEMO_PASSWORD ] || exit 7
[ "$4" = --projectId ] && [ "$5" = 00000000-0000-4000-8000-000000000002 ] && [ "$6" = --env ] && [ "$7" = prod ] || exit 8
[ "$8" = --path ] && [ "$9" = /workloads/demo ] && [ "\${10}" = --plain ] || exit 9
printf resolved-secret
`);
  await chmod(path.join(bin, 'infisical'), 0o755);
  return { directory, bin, manifest };
}

void test('injects only declared values and scrubs unrelated secret-shaped parent variables', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const output = path.join(f.directory, 'env.json');
  const result = spawnSync(process.execPath, [launcher, '--manifest', f.manifest, '--workload', 'demo', '--', process.execPath, '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({app:process.env.APP_PASSWORD,leak:process.env.UNRELATED_API_KEY,bootstrap:process.env.INFISICAL_TOKEN,plain:process.env.PLAIN_SETTING}))`], {
    env: { ...process.env, PATH: [f.bin, process.env.PATH ?? '/usr/bin:/bin'].join(path.delimiter), UNRELATED_API_KEY: 'must-not-leak', INFISICAL_TOKEN: 'bootstrap-only', PLAIN_SETTING: 'kept' },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { app: 'resolved-secret', plain: 'kept' });
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /resolved-secret|must-not-leak|bootstrap-only/);
});

void test('fails closed before starting the command when a declared secret is unavailable', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  await writeFile(path.join(f.bin, 'infisical'), '#!/bin/sh\nexit 1\n');
  const marker = path.join(f.directory, 'started');
  const result = spawnSync(process.execPath, [launcher, '--manifest', f.manifest, '--workload', 'demo', '--', process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`], {
    env: { ...process.env, PATH: [f.bin, process.env.PATH ?? '/usr/bin:/bin'].join(path.delimiter) }, encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  await assert.rejects(lstat(marker), { code: 'ENOENT' });
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /resolved-secret/);
});
