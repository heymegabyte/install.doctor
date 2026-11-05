import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const launcher = path.resolve('../../home/dot_local/bin/executable_infisical-workload-run');

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'infisical-workload-'));
  const bin = path.join(directory, 'bin');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
  const manifest = path.join(directory, 'manifest.json');
  await writeFile(manifest, JSON.stringify({
    schemaVersion: 1,
    workloads: [{
      id: 'demo', identityId: 'identity-demo', projectId: 'project-demo', environment: 'prod',
      secretPath: '/workloads/demo',
      principal: { kind: 'service', authMode: 'workload-identity', provider: 'infisical' },
      delivery: 'environment',
      secrets: [{ secretName: 'DEMO_PASSWORD', environmentVariable: 'APP_PASSWORD' }]
    }]
  }));
  await writeFile(path.join(bin, 'get-secret'), '#!/bin/sh\n[ "$1" = DEMO_PASSWORD ] || exit 7\nprintf resolved-secret\n');
  await chmod(path.join(bin, 'get-secret'), 0o755);
  return { directory, bin, manifest };
}

test('injects only declared values and scrubs unrelated secret-shaped parent variables', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  const output = path.join(f.directory, 'env.json');
  const result = spawnSync(process.execPath, [launcher, '--manifest', f.manifest, '--workload', 'demo', '--', process.execPath, '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({app:process.env.APP_PASSWORD,leak:process.env.UNRELATED_API_KEY,bootstrap:process.env.INFISICAL_TOKEN,plain:process.env.PLAIN_SETTING}))`], {
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, UNRELATED_API_KEY: 'must-not-leak', INFISICAL_TOKEN: 'bootstrap-only', PLAIN_SETTING: 'kept' },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { app: 'resolved-secret', plain: 'kept' });
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /resolved-secret|must-not-leak|bootstrap-only/);
});

test('fails closed before starting the command when a declared secret is unavailable', async (t) => {
  const f = await fixture();
  t.after(() => rm(f.directory, { recursive: true, force: true }));
  await writeFile(path.join(f.bin, 'get-secret'), '#!/bin/sh\nexit 1\n');
  const marker = path.join(f.directory, 'started');
  const result = spawnSync(process.execPath, [launcher, '--manifest', f.manifest, '--workload', 'demo', '--', process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`], {
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}` }, encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.throws(() => require('node:fs').statSync(marker));
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /resolved-secret/);
});
