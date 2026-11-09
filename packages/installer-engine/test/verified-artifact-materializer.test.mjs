import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createMaterializedArtifactResolver,
  createOnlineReleaseArtifactResolver,
  createVerifiedArtifactMaterializer,
} from '../dist/verified-artifact-materializer.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const releaseId = 'desktop-parity-1';
const releaseObjects = new Map([
  ['debian-bookworm-inrelease', Buffer.from('signed bookworm InRelease\n')],
  ['debian-bookworm-archive-keyring', Buffer.from('pinned Debian archive keyring\n')],
  ['debian-bookworm-main-amd64-packages', Buffer.from('compressed Packages.xz fixture\n')],
  ['tree-deb-bookworm-amd64', Buffer.from('exact tree_2.1.0-1_amd64.deb fixture\n')],
]);
const releaseFilename = new Map([
  ['debian-bookworm-inrelease', 'debian-bookworm-inrelease'],
  ['debian-bookworm-archive-keyring', 'debian-bookworm-archive-keyring.gpg'],
  ['debian-bookworm-main-amd64-packages', 'debian-bookworm-main-amd64-Packages.xz'],
  ['tree-deb-bookworm-amd64', 'tree_2.1.0-1_amd64.deb'],
]);
const releaseArtifacts = [...releaseObjects].map(([artifactId, bytes]) => ({
  artifactId,
  url: `https://desktop.tools/releases/${releaseId}/${releaseFilename.get(artifactId)}`,
  authority: { sha256: sha(bytes), sizeBytes: bytes.length, mode: '0600' },
}));

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

test('four signed Debian release objects fetch once and materialize identically online and offline', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'release-materializer-parity-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const cacheRoot = join(root, 'cache'); const materializedRoot = join(root, 'materialized');
  await Promise.all([mkdir(cacheRoot, { mode: 0o700 }), mkdir(materializedRoot, { mode: 0o700 })]);
  for (const [artifactId, bytes] of releaseObjects) await writeFile(join(materializedRoot, artifactId), bytes, { mode: 0o600 });
  const fetchCalls = [];
  const onlineResolver = await createOnlineReleaseArtifactResolver({
    releaseId, artifacts: releaseArtifacts, cacheRoot,
    fetcher: async (url, init) => {
      fetchCalls.push([url, init.redirect]);
      const filename = new URL(url).pathname.split('/').at(-1);
      const artifactId = [...releaseFilename].find(([, value]) => value === filename)?.[0];
      const bytes = releaseObjects.get(artifactId);
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
    },
  });
  const authority = Object.fromEntries(releaseArtifacts.map(item => [item.artifactId, item.authority]));
  const offlineResolver = await createMaterializedArtifactResolver({ materializedRoot, artifacts: authority });
  const onlineMaterialize = createVerifiedArtifactMaterializer(onlineResolver);
  const offlineMaterialize = createVerifiedArtifactMaterializer(offlineResolver);
  for (const [artifactId, expected] of releaseObjects) {
    const online = await onlineMaterialize(artifactId); const offline = await offlineMaterialize(artifactId);
    try {
      assert.deepEqual(await online.readFile(), expected);
      assert.deepEqual(await offline.readFile(), expected);
    } finally { await online.close(); await offline.close(); }
  }
  assert.equal(fetchCalls.length, 4);
  assert.ok(fetchCalls.every(([, redirect]) => redirect === 'manual'));

  const cachedResolver = await createOnlineReleaseArtifactResolver({ releaseId, artifacts: releaseArtifacts, cacheRoot,
    fetcher: async () => { throw new Error('cache hit must not fetch'); } });
  for (const artifactId of releaseObjects.keys()) {
    const candidate = await cachedResolver(artifactId);
    assert.equal(candidate.authority.sha256, authority[artifactId].sha256);
  }
  assert.equal((await readdir(cacheRoot)).filter(name => !name.startsWith('.')).length, 4);
});

test('online release resolver rejects namespace drift and never publishes redirect, truncation, or digest failures', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'release-materializer-reject-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const one = releaseArtifacts[0]; const expected = releaseObjects.get(one.artifactId);
  for (const [index, url] of [
    one.url.replace('desktop.tools', 'example.invalid'),
    one.url.replace(`/releases/${releaseId}/`, '/releases/other-release/'),
    `${one.url}?mutable=1`,
  ].entries()) {
    const cacheRoot = join(root, `namespace-${index}`); await mkdir(cacheRoot, { mode: 0o700 });
    await assert.rejects(createOnlineReleaseArtifactResolver({ releaseId, artifacts: [{ ...one, url }], cacheRoot }), /immutable Desktop Tools namespace/);
    assert.deepEqual(await readdir(cacheRoot), []);
  }
  const failures = [
    async () => new Response(null, { status: 302, headers: { location: one.url } }),
    async () => new Response(expected.subarray(1), { status: 200 }),
    async () => new Response(Buffer.alloc(expected.length, 0x78), { status: 200, headers: { 'content-length': String(expected.length) } }),
  ];
  for (const [index, fetcher] of failures.entries()) {
    const cacheRoot = join(root, `failure-${index}`); await mkdir(cacheRoot, { mode: 0o700 });
    const resolver = await createOnlineReleaseArtifactResolver({ releaseId, artifacts: [one], cacheRoot, fetcher });
    await assert.rejects(resolver(one.artifactId), /redirect|truncated|digest/);
    assert.deepEqual(await readdir(cacheRoot), [], 'failed transport must not leave a candidate or stage');
  }
});

test('online release resolver recovers only its linked interrupted publication', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'release-materializer-recovery-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const one = releaseArtifacts[0]; const bytes = releaseObjects.get(one.artifactId);
  const candidate = join(root, one.authority.sha256);
  const interrupted = join(root, `.${one.authority.sha256}.123e4567-e89b-42d3-a456-426614174000.tmp`);
  const unrelated = join(root, `.${one.authority.sha256}.123e4567-e89b-42d3-a456-426614174001.tmp`);
  await writeFile(candidate, bytes, { mode: 0o600 });
  await link(candidate, interrupted);
  await writeFile(unrelated, bytes, { mode: 0o600 });
  assert.equal((await lstat(candidate)).nlink, 2);

  const resolver = await createOnlineReleaseArtifactResolver({
    releaseId, artifacts: [one], cacheRoot: root,
    fetcher: async () => { throw new Error('recovered cache hit must not fetch'); },
  });
  const resolved = await resolver(one.artifactId);
  assert.equal(resolved.sourcePath, candidate);
  assert.equal((await lstat(candidate)).nlink, 1);
  assert.deepEqual((await readdir(root)).sort(), [unrelated.split('/').at(-1), one.authority.sha256].sort());
});
