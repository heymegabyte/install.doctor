import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileArtifactLifecyclePlan, executeArtifactLifecyclePlan, resolveAdmittedUpstreamArtifact } from '../dist/index.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const binV1 = Buffer.from('tool-v1'); const binV2 = Buffer.from('tool-v2'); const docs = Buffer.from('docs');
const admission = ({ arch, version, bytes, provider = 'github-release', extra = [] }) => ({
  schemaVersion: 1, admissionId: hash(Buffer.from(`${arch}:${version}`)), package: 'tool', version,
  provider: provider === 'github-release'
    ? { kind: provider, repository: 'example/tool', tag: `v${version}`, asset: `tool-linux-${arch}.tar.gz` }
    : { kind: provider, authority: 'downloads.example.org', release: version, artifact: `tool-linux-${arch}.zip` },
  platform: { os: 'linux', arch }, format: provider === 'github-release' ? 'tar.gz' : 'zip',
  object: { path: `/admissions/${hash(bytes)}`, sha256: hash(bytes), sizeBytes: bytes.length },
  extraction: { stripComponents: 1, files: [{ archivePath: 'package/bin/tool', installPath: 'bin/tool', sha256: hash(bytes), sizeBytes: bytes.length, mode: '0755' }, ...extra] },
  evidence: { authenticated: true, signatureKeyId: 'a'.repeat(64), license: 'Apache-2.0', mirroredAt: '2026-01-01T00:00:00.000Z' },
});

const x64v1 = admission({ arch: 'x64', version: '1.0.0', bytes: binV1 });
const arm64v1 = admission({ arch: 'arm64', version: '1.0.0', bytes: binV1 });
const x64v2 = admission({ arch: 'x64', version: '2.0.0', bytes: binV2, provider: 'upstream-release', extra: [
  { archivePath: 'package/share/docs', installPath: 'share/tool/docs', sha256: hash(docs), sizeBytes: docs.length, mode: '0644' },
] });

test('resolves exact architecture across GitHub and other admitted upstream providers without fallback', () => {
  assert.equal(resolveAdmittedUpstreamArtifact({ package: 'tool', version: '1.0.0', platform: { os: 'linux', arch: 'arm64' }, candidates: [x64v1, arm64v1] }).admissionId, arm64v1.admissionId);
  assert.equal(resolveAdmittedUpstreamArtifact({ package: 'tool', version: '2.0.0', platform: { os: 'linux', arch: 'x64' }, candidates: [x64v2] }).provider.kind, 'upstream-release');
  assert.throws(() => resolveAdmittedUpstreamArtifact({ package: 'tool', version: '1.0.0', platform: { os: 'darwin', arch: 'x64' }, candidates: [x64v1] }), /no admitted artifact/);
  assert.throws(() => resolveAdmittedUpstreamArtifact({ package: 'tool', version: '1.0.0', platform: { os: 'linux', arch: 'x64' }, candidates: [x64v1, x64v1] }), /ambiguous/);
});

test('hermetic extraction, install, update, no-op, and uninstall use one immutable admitted lifecycle', async () => {
  const state = new Map(); let extractionCalls = 0;
  const extract = async ({ expectedFiles }) => { extractionCalls += 1; return expectedFiles.map(file => ({ archivePath: file.archivePath, bytes: file.archivePath.endsWith('docs') ? docs : file.sha256 === hash(binV1) ? binV1 : binV2, mode: file.mode })); };
  const install = {
    activate: async ({ files, removePaths }) => { for (const path of removePaths) state.delete(path); for (const file of files) state.set(file.path, Buffer.from(file.bytes)); },
    remove: async ({ paths }) => { for (const path of paths) state.delete(path); },
  };
  const installPlan = compileArtifactLifecyclePlan({ package: 'tool', root: '/opt/tool', target: x64v1 });
  assert.equal(installPlan.action, 'install');
  const receiptV1 = await executeArtifactLifecyclePlan({ plan: installPlan, extract, install });
  assert.equal(state.get('bin/tool').toString(), 'tool-v1');

  const noop = compileArtifactLifecyclePlan({ package: 'tool', root: '/opt/tool', target: x64v1, installed: receiptV1 });
  assert.equal(noop.action, 'noop'); await executeArtifactLifecyclePlan({ plan: noop, extract, install });
  assert.equal(extractionCalls, 1, 'offline reuse of an already-installed admission must not re-extract or fetch');

  const update = compileArtifactLifecyclePlan({ package: 'tool', root: '/opt/tool', target: x64v2, installed: receiptV1 });
  assert.equal(update.action, 'update');
  const receiptV2 = await executeArtifactLifecyclePlan({ plan: update, extract, install });
  assert.equal(state.get('bin/tool').toString(), 'tool-v2'); assert.equal(state.get('share/tool/docs').toString(), 'docs');

  const uninstall = compileArtifactLifecyclePlan({ package: 'tool', root: '/opt/tool', installed: receiptV2, uninstall: true });
  assert.equal(uninstall.action, 'uninstall'); await executeArtifactLifecyclePlan({ plan: uninstall, extract, install });
  assert.equal(state.size, 0);
});

test('extraction fails closed on surplus, digest, path, receipt, and plan substitution', async () => {
  const plan = compileArtifactLifecyclePlan({ package: 'tool', root: '/opt/tool', target: x64v1 });
  const install = { activate: async () => assert.fail('must not activate'), remove: async () => assert.fail('must not remove') };
  await assert.rejects(executeArtifactLifecyclePlan({ plan, install, extract: async () => [
    { archivePath: 'package/bin/tool', bytes: Buffer.from('tampered'), mode: '0755' },
  ] }), /failed admission/);
  await assert.rejects(executeArtifactLifecyclePlan({ plan, install, extract: async () => [
    { archivePath: 'package/bin/tool', bytes: binV1, mode: '0755' },
    { archivePath: 'surplus', bytes: binV1, mode: '0755' },
  ] }), /closure differs/);
  await assert.rejects(executeArtifactLifecyclePlan({ plan: { ...plan, root: '/substituted' }, install, extract: async () => [] }), /plan digest mismatch/);
  assert.throws(() => compileArtifactLifecyclePlan({ package: 'other', root: '/opt/tool', target: x64v1 }), /package does not match/);
  assert.throws(() => compileArtifactLifecyclePlan({ package: 'tool', root: '/other', target: x64v1, installed: {
    schemaVersion: 1, package: 'tool', version: '1.0.0', admissionId: x64v1.admissionId, platform: x64v1.platform, root: '/opt/tool', files: [{ path: 'bin/tool', sha256: hash(binV1), sizeBytes: binV1.length, mode: '0755' }],
  } }), /outside the requested/);
});
