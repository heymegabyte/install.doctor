import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVerifiedArtifactMaterializer } from '../dist/verified-artifact-materializer.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('transport-specific candidate resolvers share one sealed verified artifact materializer', async t => {
  const root = await mkdtemp(join(tmpdir(), 'verified-materializer-')); t.after(() => rm(root, { recursive: true, force: true })); await chmod(root, 0o700);
  let onlineRoot = join(root, 'online'); let offlineRoot = join(root, 'offline');
  await Promise.all([mkdtemp(`${onlineRoot}-`), mkdtemp(`${offlineRoot}-`)]).then(async ([online, offline]) => {
    onlineRoot = online; offlineRoot = offline;
  });
  const bytes = Buffer.from('exact signed Debian artifact\n'); const artifactId = 'tree-deb-bookworm-amd64';
  const onlinePath = join(onlineRoot, artifactId); const offlinePath = join(offlineRoot, artifactId);
  await Promise.all([writeFile(onlinePath, bytes, { mode: 0o600 }), writeFile(offlinePath, bytes, { mode: 0o600 })]);
  const expected = { sha256: sha(bytes), sizeBytes: bytes.length, mode: '0600' };
  const onlineMaterializer = createVerifiedArtifactMaterializer(async id => ({ sourcePath: join(onlineRoot, id), authority: expected }));
  const offlineMaterializer = createVerifiedArtifactMaterializer(async id => ({ sourcePath: join(offlineRoot, id), authority: expected }));
  const online = await onlineMaterializer(artifactId); const offline = await offlineMaterializer(artifactId);
  await Promise.all([writeFile(onlinePath, 'substituted after admission\n', { mode: 0o600 }), writeFile(offlinePath, 'substituted after admission\n', { mode: 0o600 })]);
  try { assert.deepEqual(await online.readFile(), bytes); assert.deepEqual(await offline.readFile(), bytes); }
  finally { await online.close(); await offline.close(); }
  await assert.rejects(onlineMaterializer(artifactId), /unsafe|size|digest|changed/);
  assert.equal((await readFile(onlinePath, 'utf8')).includes('substituted'), true);
});
