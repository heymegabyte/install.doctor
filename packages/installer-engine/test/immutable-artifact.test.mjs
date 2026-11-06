import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ImmutableArtifactDescriptorSchema,
  ImmutableArtifactError,
  fetchImmutableArtifact,
} from '../dist/index.js';

const bytes = Buffer.from('#!/bin/sh\nprintf artifact-ok\\n\n');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const descriptor = {
  schemaVersion: 1,
  id: 'sysz',
  version: '1.4.3',
  platform: { os: 'linux', arch: 'x64' },
  source: {
    url: 'https://github.com/joehillen/sysz/releases/download/1.4.3/sysz',
    sha256,
    sizeBytes: bytes.length,
  },
  destination: { root: 'user-bin', filename: 'sysz', mode: '0700' },
};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'install-doctor-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cacheRoot = join(root, 'cache');
  await mkdir(cacheRoot, { mode: 0o700 });
  return { root, cacheRoot };
}

test('descriptor is strict, versioned, immutable, and path-contained', () => {
  assert.deepEqual(ImmutableArtifactDescriptorSchema.parse(descriptor), descriptor);
  assert.throws(() => ImmutableArtifactDescriptorSchema.parse({ ...descriptor, extra: true }), /unrecognized|invalid/i);
  assert.throws(() => ImmutableArtifactDescriptorSchema.parse({
    ...descriptor, source: { ...descriptor.source, url: 'https://github.com/joehillen/sysz/releases/latest/download/sysz' },
  }), /immutable release URL/i);
  assert.throws(() => ImmutableArtifactDescriptorSchema.parse({
    ...descriptor, destination: { ...descriptor.destination, filename: '../sysz' },
  }), /invalid|filename/i);
  assert.throws(() => ImmutableArtifactDescriptorSchema.parse({
    ...descriptor, source: { ...descriptor.source, sizeBytes: 67_108_865 },
  }), /too_big|invalid|less than or equal/i);
});

test('verified download follows only an allowed redirect and publishes a private content-addressed candidate', async t => {
  const state = await fixture(t);
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push([url, init.redirect]);
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/object' } });
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
  };
  const result = await fetchImmutableArtifact({ descriptor, cacheRoot: state.cacheRoot, fetcher });
  assert.equal(result.cacheHit, false);
  assert.equal(result.sha256, sha256);
  assert.equal(await readFile(result.candidatePath, 'utf8'), bytes.toString());
  assert.equal((await lstat(result.candidatePath)).mode & 0o777, 0o600);
  assert.deepEqual(calls, [
    [descriptor.source.url, 'manual'],
    ['https://release-assets.githubusercontent.com/object', 'manual'],
  ]);

  const cached = await fetchImmutableArtifact({
    descriptor, cacheRoot: state.cacheRoot,
    fetcher: async () => { throw new Error('cache hit must not use the network'); },
  });
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.candidatePath, result.candidatePath);
});

test('offline mode fails before transport and exact remediation is bounded', async t => {
  const state = await fixture(t);
  let called = false;
  await assert.rejects(fetchImmutableArtifact({
    descriptor, cacheRoot: state.cacheRoot, offline: true,
    fetcher: async () => { called = true; return new Response(bytes); },
  }), error => {
    assert.ok(error instanceof ImmutableArtifactError);
    assert.match(error.message, /offline bundle.*sysz/i);
    assert.equal(error.message.includes(descriptor.source.url), false);
    return true;
  });
  assert.equal(called, false);
});

test('digest, declared size, redirects, and response bounds fail closed without a published candidate', async t => {
  const state = await fixture(t);
  const cases = [
    {
      name: 'digest', value: { ...descriptor, source: { ...descriptor.source, sha256: 'a'.repeat(64) } },
      fetcher: async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }), pattern: /digest/,
    },
    {
      name: 'declared size', value: descriptor,
      fetcher: async () => new Response(bytes.subarray(1), { headers: { 'content-length': String(bytes.length - 1) } }), pattern: /size/,
    },
    {
      name: 'origin', value: descriptor,
      fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/payload' } }), pattern: /redirect origin/,
    },
    {
      name: 'oversize', value: descriptor,
      fetcher: async () => new Response(Buffer.concat([bytes, Buffer.from('x')]), { headers: { 'content-length': String(bytes.length + 1) } }), pattern: /size/,
    },
  ];
  for (const candidate of cases) {
    await assert.rejects(fetchImmutableArtifact({ descriptor: candidate.value, cacheRoot: state.cacheRoot, fetcher: candidate.fetcher }), candidate.pattern, candidate.name);
  }
  assert.deepEqual(await import('node:fs/promises').then(fs => fs.readdir(state.cacheRoot)), []);
});

test('unsafe cache roots and poisoned cache entries are rejected, never trusted or replaced', async t => {
  const state = await fixture(t);
  await chmod(state.cacheRoot, 0o777);
  await assert.rejects(fetchImmutableArtifact({ descriptor, cacheRoot: state.cacheRoot, fetcher: async () => new Response(bytes) }), /private|permissions/);
  await chmod(state.cacheRoot, 0o700);
  const poisoned = join(state.cacheRoot, sha256);
  await writeFile(poisoned, 'poison', { mode: 0o600 });
  await assert.rejects(fetchImmutableArtifact({ descriptor, cacheRoot: state.cacheRoot, fetcher: async () => new Response(bytes) }), /cached artifact.*mismatch/);
  assert.equal(await readFile(poisoned, 'utf8'), 'poison');
  await rm(poisoned);
  await symlink('/etc/passwd', poisoned);
  await assert.rejects(fetchImmutableArtifact({ descriptor, cacheRoot: state.cacheRoot, fetcher: async () => new Response(bytes) }), /cached artifact.*unsafe/);
});

test('a recognized interrupted publication link is recovered without network or duplicate download', async t => {
  const state = await fixture(t);
  const candidate = join(state.cacheRoot, sha256);
  const interruptedStage = join(state.cacheRoot, `.${sha256}.123e4567-e89b-42d3-a456-426614174000.tmp`);
  await writeFile(interruptedStage, bytes, { mode: 0o600 });
  await link(interruptedStage, candidate);
  assert.equal((await lstat(candidate)).nlink, 2);
  let transported = false;
  const result = await fetchImmutableArtifact({
    descriptor, cacheRoot: state.cacheRoot, offline: true,
    fetcher: async () => { transported = true; return new Response(bytes); },
  });
  assert.equal(result.cacheHit, true);
  assert.equal(transported, false);
  assert.deepEqual(await readdir(state.cacheRoot), [sha256]);
  assert.equal((await lstat(candidate)).nlink, 1);
  assert.equal(await readFile(candidate, 'utf8'), bytes.toString('utf8'));
});

test('an unknown hard link remains cache poisoning and is never removed automatically', async t => {
  const state = await fixture(t);
  const candidate = join(state.cacheRoot, sha256);
  const unknown = join(state.cacheRoot, 'unrecognized-hardlink');
  await writeFile(candidate, bytes, { mode: 0o600 });
  await link(candidate, unknown);
  await assert.rejects(fetchImmutableArtifact({ descriptor, cacheRoot: state.cacheRoot, offline: true }), /unsafe inode metadata/);
  assert.deepEqual((await readdir(state.cacheRoot)).sort(), [sha256, 'unrecognized-hardlink'].sort());
});
