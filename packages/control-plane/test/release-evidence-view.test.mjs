import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { projectPublicReleaseEvidence, readReleaseEvidenceObject } from '../src/release-evidence-view.ts';

const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : `${JSON.stringify(value)}\n`);
const digest = value => createHash('sha256').update(value).digest('hex');

function fixture() {
  const releaseId = 'release-evidence-1';
  const catalog = bytes([{ name: 'safe', tenant: 'must-not-leak', secret: 'must-not-leak' }]);
  const payloads = new Map([['catalog.json', digest(catalog)], ['desktop-tools-engine.mjs', 'a'.repeat(64)]]);
  const components = [...payloads].map(([name, content]) => ({ type: 'file', name, hashes: [{ alg: 'SHA-256', content }] }));
  const sbom = bytes({ bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: { component: { name: 'desktop-tools-release', version: releaseId } }, components });
  const provenance = bytes({ _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1',
    subject: [...payloads].map(([name, sha256]) => ({ name, digest: { sha256 } })),
    predicate: { buildDefinition: { buildType: 'https://desktop.tools/build-types/release-closure/v1',
      externalParameters: { releaseId, sourceCommit: 'b'.repeat(40), tenant: 'must-not-leak' } },
      runDetails: { builder: { id: 'https://desktop.tools/builders/release-closure/v1', secret: 'must-not-leak' } } } });
  const graph = [...payloads].map(([name, hashValue], index) => ({ type: 'software_File', spdxId: `file-${index}`, name,
    verifiedUsing: [{ type: 'Hash', algorithm: 'sha256', hashValue }] }));
  const spdx = bytes({ '@context': 'https://spdx.org/rdf/3.0.1/spdx-context.jsonld', '@graph': graph });
  const artifacts = Object.fromEntries([...payloads].sort());
  const exploitability = bytes({ schemaVersion: 1, kind: 'desktop-tools-release-exploitability', releaseId,
    createdAt: '2026-11-10T00:00:00.000Z', spdx: { specVersion: '3.0.1', sha256: digest(spdx) },
    releaseClosure: { sha256: digest(bytes(artifacts)), artifacts }, assessments: [
      { component: 'safe', vulnerabilityId: 'CVE-2026-0001', status: 'not_affected',
        rationale: 'private analyst detail', evidence: ['private://source'] },
    ] });
  const objects = { catalog, sbom, provenance, spdx, exploitability };
  const prefixes = { catalog: ['catalog', 'catalog.json'], sbom: ['sbom', 'release.sbom.json'],
    provenance: ['provenance', 'release.provenance.json'], spdx: ['spdx', 'release.spdx.json'],
    exploitability: ['exploitability', 'release.exploitability.json'] };
  const lines = ['schema_version=10', 'product_id=desktop-tools', `release_id=${releaseId}`,
    `source_commit=${'b'.repeat(40)}`];
  for (const [key, [prefix, filename]] of Object.entries(prefixes)) lines.push(
    `${prefix}_url=https://desktop.tools/releases/${releaseId}/${filename}`,
    `${prefix}_sha256=${digest(objects[key])}`, `${prefix}_size=${objects[key].byteLength}`);
  return { releaseId, manifest: bytes(`${lines.join('\n')}\n`), ...objects };
}

test('projects exact byte-bound SBOM, VEX, and catalog provenance without tenant or source-field leakage', async () => {
  const input = fixture(); const view = await projectPublicReleaseEvidence(input);
  assert.equal(view.exactReleaseBytes, true);
  assert.equal(view.catalog.sha256, digest(input.catalog));
  assert.equal(view.catalog.provenance.closureArtifacts, 2);
  assert.equal(view.sbom.spdx.sha256, digest(input.spdx));
  assert.deepEqual(view.exploitability.statuses, { affected: 0, not_affected: 1, fixed: 0, under_investigation: 0 });
  assert.deepEqual(view.exploitability.assessments, [{ component: 'safe', vulnerabilityId: 'CVE-2026-0001', status: 'not_affected' }]);
  const serialized = JSON.stringify(view);
  assert.doesNotMatch(serialized, /must-not-leak|private analyst|private:\/\/|tenant|secret/i);
});

test('rejects substituted release bytes and exploitability evidence bound to another closure', async () => {
  const catalogTamper = fixture(); catalogTamper.catalog = bytes([{ name: 'substituted' }]);
  await assert.rejects(projectPublicReleaseEvidence(catalogTamper), /signed manifest/);
  const vexTamper = fixture();
  const statement = JSON.parse(new TextDecoder().decode(vexTamper.exploitability));
  statement.releaseClosure.artifacts['catalog.json'] = 'f'.repeat(64);
  vexTamper.exploitability = bytes(statement);
  const manifestText = new TextDecoder().decode(vexTamper.manifest)
    .replace(/exploitability_sha256=[a-f0-9]{64}/, `exploitability_sha256=${digest(vexTamper.exploitability)}`)
    .replace(/exploitability_size=\d+/, `exploitability_size=${vexTamper.exploitability.byteLength}`);
  vexTamper.manifest = bytes(manifestText);
  await assert.rejects(projectPublicReleaseEvidence(vexTamper), /exact release closure/);
});

test('bounded object reader rejects declared and streamed oversize or mismatched objects', async () => {
  const small = bytes('ok');
  assert.deepEqual(await readReleaseEvidenceObject(new Blob([small]).stream(), small.byteLength), small);
  await assert.rejects(readReleaseEvidenceObject(new Blob([small]).stream(), small.byteLength + 1), /mismatch/);
  await assert.rejects(readReleaseEvidenceObject(new Blob([small]).stream(), 9_000_000), /size/);
});
