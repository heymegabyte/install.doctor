import { z } from 'zod';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const ReleaseId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const MAX_EVIDENCE_BYTES = 8_388_608;

type EvidenceInput = Readonly<{
  releaseId: string;
  manifest: Uint8Array;
  catalog: Uint8Array;
  sbom: Uint8Array;
  provenance: Uint8Array;
  spdx: Uint8Array;
  exploitability: Uint8Array;
}>;

const Assessment = z.object({
  component: z.string().min(1).max(512),
  vulnerabilityId: z.string().min(1).max(256),
  status: z.enum(['affected', 'not_affected', 'fixed', 'under_investigation']),
  rationale: z.string().max(4_096),
  evidence: z.array(z.string().max(2_048)).max(64),
}).strict();

function parseJson(bytes: Uint8Array, label: string): unknown {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EVIDENCE_BYTES) throw new Error(`${label} size is invalid`);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON`); }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}

function manifestMap(bytes: Uint8Array): Map<string, string> {
  if (bytes.byteLength === 0 || bytes.byteLength > 65_536) throw new Error('manifest size is invalid');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const fields = new Map<string, string>();
  for (const line of text.trimEnd().split('\n')) {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('manifest is malformed');
    const key = line.slice(0, separator); const value = line.slice(separator + 1);
    if (!/^[a-z0-9_]+$/.test(key) || fields.has(key)) throw new Error('manifest fields are ambiguous');
    fields.set(key, value);
  }
  return fields;
}

async function assertManifestArtifact(fields: Map<string, string>, prefix: string, filename: string, bytes: Uint8Array) {
  const digest = await sha256(bytes);
  if (fields.get(`${prefix}_url`) !== `https://desktop.tools/releases/${fields.get('release_id')}/${filename}`
    || fields.get(`${prefix}_sha256`) !== digest
    || fields.get(`${prefix}_size`) !== String(bytes.byteLength)) throw new Error(`${prefix} bytes do not match the signed manifest`);
  return digest;
}

function exactDigestMap(items: unknown, label: string): Map<string, string> {
  if (!Array.isArray(items)) throw new Error(`${label} closure is missing`);
  const result = new Map<string, string>();
  for (const item of items) {
    const parsed = z.object({ name: z.string().min(1).max(256), digest: z.object({ sha256: Digest }).passthrough() }).passthrough().safeParse(item);
    if (!parsed.success || result.has(parsed.data.name)) throw new Error(`${label} closure is ambiguous`);
    result.set(parsed.data.name, parsed.data.digest.sha256);
  }
  return result;
}

function mapsEqual(left: Map<string, string>, right: Map<string, string>): boolean {
  return JSON.stringify([...left.entries()].sort()) === JSON.stringify([...right.entries()].sort());
}

/**
 * Produce the only public release-evidence projection. All claims are derived
 * after re-hashing exact stored bytes; arbitrary source fields are never copied.
 */
export async function projectPublicReleaseEvidence(input: EvidenceInput) {
  const releaseId = ReleaseId.parse(input.releaseId);
  const fields = manifestMap(input.manifest);
  if (fields.get('schema_version') !== '10' || fields.get('product_id') !== 'desktop-tools'
    || fields.get('release_id') !== releaseId) throw new Error('release identity is invalid');

  const catalogSha256 = await assertManifestArtifact(fields, 'catalog', 'catalog.json', input.catalog);
  const sbomSha256 = await assertManifestArtifact(fields, 'sbom', 'release.sbom.json', input.sbom);
  const provenanceSha256 = await assertManifestArtifact(fields, 'provenance', 'release.provenance.json', input.provenance);
  const spdxSha256 = await assertManifestArtifact(fields, 'spdx', 'release.spdx.json', input.spdx);
  const exploitabilitySha256 = await assertManifestArtifact(fields, 'exploitability', 'release.exploitability.json', input.exploitability);

  const catalog = z.array(z.object({ name: z.string().min(1).max(256) }).passthrough()).parse(parseJson(input.catalog, 'catalog'));
  const sbom = z.object({ bomFormat: z.literal('CycloneDX'), specVersion: z.literal('1.6'), version: z.literal(1),
    metadata: z.object({ component: z.object({ name: z.literal('desktop-tools-release'), version: z.string() }).passthrough() }).passthrough(),
    components: z.array(z.object({ name: z.string(), hashes: z.array(z.object({ alg: z.string(), content: Digest }).passthrough()) }).passthrough()),
  }).passthrough().parse(parseJson(input.sbom, 'SBOM'));
  if (sbom.metadata.component.version !== releaseId) throw new Error('SBOM release identity mismatch');
  const sbomClosure = new Map<string, string>();
  for (const component of sbom.components) {
    const hashes = component.hashes.filter(hash => hash.alg === 'SHA-256');
    if (hashes.length !== 1 || sbomClosure.has(component.name)) throw new Error('SBOM closure is ambiguous');
    sbomClosure.set(component.name, hashes[0].content);
  }

  const provenance = z.object({ _type: z.literal('https://in-toto.io/Statement/v1'),
    predicateType: z.literal('https://slsa.dev/provenance/v1'),
    subject: z.array(z.unknown()), predicate: z.object({ buildDefinition: z.object({
      buildType: z.string(), externalParameters: z.object({ releaseId: z.string(), sourceCommit: z.string() }).passthrough(),
    }).passthrough(), runDetails: z.object({ builder: z.object({ id: z.string() }).passthrough() }).passthrough() }).passthrough(),
  }).passthrough().parse(parseJson(input.provenance, 'provenance'));
  if (provenance.predicate.buildDefinition.externalParameters.releaseId !== releaseId
    || provenance.predicate.buildDefinition.externalParameters.sourceCommit !== fields.get('source_commit')) {
    throw new Error('provenance release identity mismatch');
  }
  const provenanceClosure = exactDigestMap(provenance.subject, 'provenance');
  if (!mapsEqual(sbomClosure, provenanceClosure) || provenanceClosure.get('catalog.json') !== catalogSha256) {
    throw new Error('catalog provenance does not bind the exact release closure');
  }

  const spdx = z.object({ '@context': z.literal('https://spdx.org/rdf/3.0.1/spdx-context.jsonld'), '@graph': z.array(z.unknown()) })
    .passthrough().parse(parseJson(input.spdx, 'SPDX'));
  const spdxFiles = new Map<string, string>();
  for (const raw of spdx['@graph']) {
    const file = z.object({ type: z.string(), name: z.string().optional(), verifiedUsing: z.array(z.object({
      type: z.string(), algorithm: z.string(), hashValue: Digest,
    }).passthrough()).optional() }).passthrough().parse(raw);
    if (file.type !== 'software_File') continue;
    const hashes = (file.verifiedUsing ?? []).filter(hash => hash.type === 'Hash' && hash.algorithm === 'sha256');
    if (!file.name || hashes.length !== 1 || spdxFiles.has(file.name)) throw new Error('SPDX closure is ambiguous');
    spdxFiles.set(file.name, hashes[0].hashValue);
  }
  if (!mapsEqual(spdxFiles, provenanceClosure)) throw new Error('SPDX does not bind the exact release closure');

  const vex = z.object({ schemaVersion: z.literal(1), kind: z.literal('desktop-tools-release-exploitability'),
    releaseId: ReleaseId, createdAt: z.string().datetime(), spdx: z.object({ specVersion: z.literal('3.0.1'), sha256: Digest }).strict(),
    releaseClosure: z.object({ sha256: Digest, artifacts: z.record(z.string(), Digest) }).strict(), assessments: z.array(Assessment).max(10_000),
  }).strict().parse(parseJson(input.exploitability, 'exploitability'));
  if (vex.releaseId !== releaseId || vex.spdx.sha256 !== spdxSha256
    || !mapsEqual(new Map(Object.entries(vex.releaseClosure.artifacts)), provenanceClosure)) {
    throw new Error('exploitability evidence does not bind the exact release closure');
  }
  const closureBytes = new TextEncoder().encode(`${JSON.stringify(Object.fromEntries([...provenanceClosure.entries()].sort()))}\n`);
  if (vex.releaseClosure.sha256 !== await sha256(closureBytes)) throw new Error('exploitability closure digest mismatch');

  const statuses = { affected: 0, not_affected: 0, fixed: 0, under_investigation: 0 };
  for (const assessment of vex.assessments) statuses[assessment.status]++;
  const artifact = (name: string, digest: string) => Object.freeze({
    sha256: digest, url: `https://desktop.tools/releases/${releaseId}/${name}`,
  });
  return Object.freeze({
    schemaVersion: 1, kind: 'desktop-tools-public-release-evidence', releaseId,
    sourceCommit: fields.get('source_commit'), exactReleaseBytes: true,
    catalog: { entries: catalog.length, ...artifact('catalog.json', catalogSha256),
      provenance: { statementSha256: provenanceSha256, builderId: provenance.predicate.runDetails.builder.id,
        buildType: provenance.predicate.buildDefinition.buildType, closureArtifacts: provenanceClosure.size } },
    sbom: { format: 'CycloneDX', specVersion: '1.6', components: sbomClosure.size,
      ...artifact('release.sbom.json', sbomSha256), spdx: artifact('release.spdx.json', spdxSha256) },
    exploitability: { currentAsOf: vex.createdAt, statementSha256: exploitabilitySha256,
      statementUrl: `https://desktop.tools/releases/${releaseId}/release.exploitability.json`, statuses,
      assessments: vex.assessments.map(({ component, vulnerabilityId, status }) => ({ component, vulnerabilityId, status })) },
  });
}

export async function readReleaseEvidenceObject(body: ReadableStream<Uint8Array>, declaredSize?: number): Promise<Uint8Array> {
  if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > MAX_EVIDENCE_BYTES)) {
    throw new Error('release evidence object size is invalid');
  }
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > MAX_EVIDENCE_BYTES) { await reader.cancel(); throw new Error('release evidence object exceeds limit'); }
    chunks.push(value);
  }
  if (declaredSize !== undefined && size !== declaredSize) throw new Error('release evidence object size mismatch');
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
