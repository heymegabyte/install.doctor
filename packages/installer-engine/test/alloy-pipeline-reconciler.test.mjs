import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  admitAlloyRemoteModule,
  alloyPipelinePaths,
  readAlloyLastValidState,
} from '../dist/alloy-pipeline-reconciler.js';

const ALLOY = process.env.ALLOY_BINARY ?? '/opt/homebrew/bin/alloy';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = (revision, content) => {
  const bytes = Buffer.from(content);
  return { revision, content: bytes, sha256: sha256(bytes) };
};

function moduleConfig(revision) {
  return `declare "pipeline" {
  argument "source_path" {}

  local.file_match "events" {
    path_targets = [{
      __path__ = argument.source_path.value,
      job      = "desktop-tools-canary-remote",
    }]
  }

  loki.source.file "events" {
    targets    = local.file_match.events.targets
    forward_to = [loki.process.tag.receiver]
  }

  loki.process "tag" {
    forward_to = [loki.echo.remote.receiver]
    stage.static_labels {
      values = { module_revision = "${revision}" }
    }
  }

  loki.echo "remote" {}
}
`;
}

function localConfig(paths, eventPath) {
  return `logging {
  level  = "info"
  format = "logfmt"
}

// This local path remains useful even when every remote revision is unavailable or rejected.
local.file_match "recovery" {
  path_targets = [{
    __path__ = ${JSON.stringify(eventPath)},
    job      = "desktop-tools-canary-local",
  }]
}

loki.source.file "recovery" {
  targets    = local.file_match.recovery.targets
  forward_to = [loki.echo.recovery.receiver]
}

loki.echo "recovery" {}

// Remote bytes are copied here only after whole-config validation. Alloy never watches candidate files.
import.file "validated_remote" {
  filename = ${JSON.stringify(paths.effectiveModule)}
}

validated_remote.pipeline "active" {
  source_path = ${JSON.stringify(eventPath)}
}
`;
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise(resolve => server.close(resolve));
  return address.port;
}

async function waitFor(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

test('digest and revision policy reject untrusted candidates before invoking Alloy', async t => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-alloy-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = alloyPipelinePaths(root);
  await writeFile(paths.localConfig, `import.file "validated_remote" { filename = ${JSON.stringify(paths.effectiveModule)} }\n`);

  await assert.rejects(() => admitAlloyRemoteModule({
    alloyBinary: '/binary/must/not/run', root, localConfig: paths.localConfig,
    candidate: { revision: 'valid-r1', sha256: '0'.repeat(64), content: Buffer.from('declare "x" {}') },
  }), /digest mismatch/u);
  await assert.rejects(() => admitAlloyRemoteModule({
    alloyBinary: '/binary/must/not/run', root, localConfig: paths.localConfig,
    candidate: candidate('../escape', 'declare "x" {}'),
  }), /invalid remote module revision/u);
});

test('Alloy canary retains the last valid effective module after an invalid remote revision', { timeout: 30_000 }, async t => {
  await assert.doesNotReject(() => readFile(ALLOY), `Alloy binary is required at ${ALLOY}`);
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-alloy-canary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const paths = alloyPipelinePaths(root);
  const events = join(root, 'events.ndjson');
  await writeFile(events, '');
  await writeFile(paths.localConfig, localConfig(paths, events), { mode: 0o600 });

  const first = await admitAlloyRemoteModule({
    alloyBinary: ALLOY, root, localConfig: paths.localConfig,
    candidate: candidate('valid-r1', moduleConfig('valid-r1')),
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });
  assert.equal(first.status, 'activated');
  const validBytes = await readFile(paths.effectiveModule);
  const validState = await readAlloyLastValidState(root);
  assert.equal(validState?.revision, 'valid-r1');

  const port = await unusedPort();
  const alloy = spawn(ALLOY, [
    'run', '--disable-reporting', `--server.http.listen-addr=127.0.0.1:${port}`,
    `--storage.path=${join(root, 'storage')}`, paths.localConfig,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  alloy.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
  alloy.stderr.on('data', chunk => { output += chunk.toString('utf8'); });
  t.after(async () => {
    if (alloy.exitCode === null) alloy.kill('SIGTERM');
    await new Promise(resolve => alloy.once('close', resolve));
  });
  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/-/ready`)).ok; } catch { return false; }
  }, `Alloy canary did not become ready:\n${output}`);

  await writeFile(events, '{"probe":"before-invalid"}\n', { flag: 'a' });
  await waitFor(() => output.includes('before-invalid'), `local pipeline did not emit initial probe:\n${output}`);

  const secretSentinel = 'INLINE_SECRET_MUST_NOT_ENTER_EVIDENCE';
  const invalid = await admitAlloyRemoteModule({
    alloyBinary: ALLOY, root, localConfig: paths.localConfig,
    candidate: candidate('invalid-r2', `// ${secretSentinel}\ndeclare "pipeline" {\n  @\n}\n`),
    now: () => new Date('2026-11-10T12:01:00.000Z'),
  });
  assert.equal(invalid.status, 'rejected');
  assert.equal(invalid.retained?.revision, 'valid-r1');
  assert.equal(invalid.retained?.moduleSha256, validState?.moduleSha256);
  assert.deepEqual(await readFile(paths.effectiveModule), validBytes);
  assert.deepEqual(await readAlloyLastValidState(root), validState);

  const rejection = JSON.parse((await readFile(paths.rejectionLog, 'utf8')).trim());
  assert.equal(rejection.revision, 'invalid-r2');
  assert.equal(rejection.retainedRevision, 'valid-r1');
  assert.equal(rejection.retainedSha256, validState?.moduleSha256);
  assert.doesNotMatch(JSON.stringify(rejection), new RegExp(secretSentinel, 'u'));

  await writeFile(events, '{"probe":"after-invalid"}\n', { flag: 'a' });
  await waitFor(() => output.includes('after-invalid'), `last-valid pipeline stopped after rejection:\n${output}`);
  const readyAfterRejection = await fetch(`http://127.0.0.1:${port}/-/ready`);
  assert.equal(readyAfterRejection.status, 200);
});
