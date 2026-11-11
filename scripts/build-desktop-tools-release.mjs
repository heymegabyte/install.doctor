#!/usr/bin/env node
import { createHash, createPublicKey } from 'node:crypto';
import { chmod, copyFile, lstat, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { TextDecoder } from 'node:util';
import { renderBootstrap } from '../packages/control-plane/src/bootstrap.ts';
import { BrokerApprovalSignerDelegation } from '../packages/aid-core/src/broker-approval-contracts.ts';

const { z } = createRequire(new URL('../packages/control-plane/package.json', import.meta.url))('zod');

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const regularPath = z.string().min(1).max(4096);
const version = z.string().regex(/^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/);
const platforms = ['macos_x64', 'macos_arm64', 'linux_x64', 'linux_arm64'];
const Configuration = z.strictObject({
  releaseId: id, sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  createdAt: z.number().int().positive().safe(), expiresAt: z.number().int().positive().safe(),
  signerId: z.string().regex(/^desktop-[a-z0-9][a-z0-9._-]{0,119}$/),
  signerPublicKey: z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/),
  releaseChannel: z.literal('stable'),
  brokerApprovalSignerDelegation: regularPath,
  brokerApprovalMinimumRevocationEpoch: z.number().int().nonnegative().safe(),
  runtimeNodeVersion: z.string().regex(/^24\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/),
  opencodeVersion: version,
  opencodeLock: regularPath,
  provisioner: regularPath, engine: regularPath, catalog: regularPath, supervisor: regularPath,
  tools: regularPath, licenses: regularPath,
  debian: z.strictObject({ archiveKeyring: regularPath, inRelease: regularPath, packagesIndex: regularPath,
    treePayload: regularPath, trustPolicy: regularPath, compositionReceipt: regularPath }),
  runtimes: z.strictObject(Object.fromEntries(platforms.map(name => [name, regularPath]))),
  opencode: z.strictObject(Object.fromEntries(platforms.map(name => [name, regularPath]))),
  outputDirectory: regularPath
});
const limits = Object.freeze({
  executable: 8_388_608, metadata: 8_388_608, runtime: 100_663_296,
  opencode: 167_772_160, tools: 33_554_432, debian: 268_435_456, delegation: 65_536, manifest: 32_768
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)])) : value;
const semanticDigest = (domain, value) => sha256(`${domain}\0${JSON.stringify(canonical(value))}`);
const outputPlatform = name => name.replace('_', '-');
const opencodeFilename = platform => platform.startsWith('macos_')
  ? `opencode-${outputPlatform(platform)}.zip` : `opencode-${outputPlatform(platform)}.tar.gz`;
const OpenCodeLock = z.strictObject({
  schemaVersion: z.literal(1), name: z.literal('opencode'), version,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), license: z.literal('MIT'),
  sourceVerification: z.strictObject({ tagCommit: z.string().regex(/^[a-f0-9]{40}$/),
    gitHubVerified: z.boolean(), assetDigestSource: z.literal('github-release-api') }),
  artifacts: z.strictObject(Object.fromEntries(platforms.map(platform => [platform, z.strictObject({
    releaseFilename: z.literal(opencodeFilename(platform)), upstreamUrl: z.string().url().startsWith('https://'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().positive().max(limits.opencode)
  })])))
});

async function input(pathInput, maximum, label) {
  const path = resolve(pathInput);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > maximum) {
    throw new Error(`${label} is not one safe bounded regular file`);
  }
  return { path, bytes: await readFile(path) };
}

function jsonObject(source, label) {
  let value;
  try { value = JSON.parse(source.bytes.toString('utf8')); } catch { throw new Error(`${label} is not valid JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function expectedPayloads(sources) {
  return new Map([...sources.entries()]
    .filter(([name]) => !['release.sbom.json', 'release.provenance.json', 'release.spdx.json',
      'release.exploitability.json', 'THIRD_PARTY_LICENSES.txt'].includes(name))
    .map(([name, source]) => [name, sha256(source.bytes)]));
}

function spdxReleaseEvidence(expected, config) {
  const createdAt = new Date(config.createdAt * 1_000).toISOString().replace('.000Z', 'Z');
  const namespace = `https://desktop.tools/spdx/releases/${encodeURIComponent(config.releaseId)}`;
  const creation = '_:creationinfo';
  const supplier = `${namespace}#organization-desktop-tools`;
  const bomId = `${namespace}#sbom`;
  const packageId = `${namespace}#package`;
  const files = [...expected.entries()].sort().map(([name, digest]) => ({
    type: 'software_File', spdxId: `${namespace}#file-${digest}-${encodeURIComponent(name)}`,
    creationInfo: creation, name, software_primaryPurpose: name.endsWith('.json') ? 'source' : 'other',
    builtTime: createdAt, originatedBy: [supplier],
    verifiedUsing: [{ type: 'Hash', algorithm: 'sha256', hashValue: digest }],
  }));
  const fileIds = files.map(({ spdxId }) => spdxId);
  const relationshipId = `${namespace}#relationship-contains`;
  const spdx = { '@context': 'https://spdx.org/rdf/3.0.1/spdx-context.jsonld', '@graph': [
    { type: 'CreationInfo', '@id': creation, createdBy: [supplier], specVersion: '3.0.1', created: createdAt },
    { type: 'Organization', spdxId: supplier, creationInfo: creation, name: 'Desktop Tools' },
    { type: 'SpdxDocument', spdxId: namespace, creationInfo: creation, rootElement: [bomId],
      element: [bomId, supplier, packageId, relationshipId, ...fileIds], profileConformance: ['core', 'software'],
      comment: 'AI and Dataset profiles are not applicable: this closure contains no model weights or training datasets.' },
    { type: 'software_Sbom', spdxId: bomId, creationInfo: creation, rootElement: [packageId],
      element: [packageId, relationshipId, ...fileIds], software_sbomType: ['build'] },
    { type: 'software_Package', spdxId: packageId, creationInfo: creation, name: 'desktop-tools-release',
      software_packageVersion: config.releaseId, software_downloadLocation: `https://desktop.tools/releases/${config.releaseId}/`,
      software_primaryPurpose: 'application', builtTime: createdAt, releaseTime: createdAt, suppliedBy: supplier,
      originatedBy: [supplier], software_sourceInfo: `git+https://github.com/heymegabyte/install.doctor@${config.sourceCommit}` },
    ...files,
    { type: 'Relationship', spdxId: relationshipId, creationInfo: creation, from: packageId,
      relationshipType: 'contains', to: fileIds, completeness: 'complete' },
  ] };
  const spdxBytes = Buffer.from(`${JSON.stringify(spdx)}\n`);
  const artifacts = Object.fromEntries([...expected.entries()].sort());
  const closureSha256 = sha256(Buffer.from(`${JSON.stringify(artifacts)}\n`));
  const exploitability = { schemaVersion: 1, kind: 'desktop-tools-release-exploitability',
    releaseId: config.releaseId, createdAt, spdx: { specVersion: '3.0.1', sha256: sha256(spdxBytes) },
    releaseClosure: { sha256: closureSha256, artifacts }, assessments: [] };
  return { spdx, spdxBytes, exploitability,
    exploitabilityBytes: Buffer.from(`${JSON.stringify(exploitability)}\n`) };
}

function validateSbom(value, expected, config) {
  if (value.bomFormat !== 'CycloneDX' || value.specVersion !== '1.6' || value.version !== 1
    || value.metadata?.component?.name !== 'desktop-tools-release'
    || value.metadata.component.version !== config.releaseId) throw new Error('SBOM identity is invalid');
  const properties = new Map((value.metadata.component.properties ?? []).map(item => [item?.name, item?.value]));
  if (properties.get('desktop.tools:source-commit') !== config.sourceCommit
    || properties.get('desktop.tools:opencode-version') !== config.opencodeVersion
    || properties.get('desktop.tools:broker-approval-delegation-sha256') !== config.brokerApprovalDelegationSha256
    || properties.get('desktop.tools:broker-approval-minimum-revocation-epoch') !== String(config.brokerApprovalMinimumRevocationEpoch)
    || properties.get('desktop.tools:debian-trust-policy-sha256') !== config.debianTrustPolicySha256
    || properties.get('desktop.tools:debian-composition-sha256') !== config.debianCompositionSha256) throw new Error('SBOM release pins are invalid');
  const actual = new Map();
  for (const component of value.components ?? []) {
    const digest = component?.hashes?.find(item => item?.alg === 'SHA-256')?.content;
    if (typeof component?.name !== 'string' || typeof digest !== 'string' || actual.has(component.name)) throw new Error('SBOM components are ambiguous');
    actual.set(component.name, digest);
  }
  if (JSON.stringify([...actual.entries()].sort()) !== JSON.stringify([...expected.entries()].sort())) {
    throw new Error('SBOM does not bind the exact release payload closure');
  }
}

function validateProvenance(value, expected, config, lock) {
  if (value._type !== 'https://in-toto.io/Statement/v1' || value.predicateType !== 'https://slsa.dev/provenance/v1') {
    throw new Error('provenance statement type is invalid');
  }
  const parameters = value.predicate?.buildDefinition?.externalParameters;
  if (parameters?.releaseId !== config.releaseId || parameters?.sourceCommit !== config.sourceCommit
    || parameters?.opencodeVersion !== config.opencodeVersion
    || parameters?.brokerApprovalDelegationSha256 !== config.brokerApprovalDelegationSha256
    || parameters?.brokerApprovalMinimumRevocationEpoch !== config.brokerApprovalMinimumRevocationEpoch) {
    throw new Error('provenance release pins are invalid');
  }
  const actual = new Map();
  for (const subject of value.subject ?? []) {
    if (typeof subject?.name !== 'string' || typeof subject?.digest?.sha256 !== 'string' || actual.has(subject.name)) {
      throw new Error('provenance subjects are ambiguous');
    }
    actual.set(subject.name, subject.digest.sha256);
  }
  if (JSON.stringify([...actual.entries()].sort()) !== JSON.stringify([...expected.entries()].sort())) {
    throw new Error('provenance does not bind the exact release payload closure');
  }
  const resolved = new Map();
  for (const dependency of value.predicate?.buildDefinition?.resolvedDependencies ?? []) {
    if (typeof dependency?.uri !== 'string' || typeof dependency?.digest?.sha256 !== 'string' || resolved.has(dependency.uri)) {
      throw new Error('provenance resolved dependencies are ambiguous');
    }
    resolved.set(dependency.uri, dependency.digest.sha256);
  }
  const locked = new Map(platforms.map(platform => [lock.artifacts[platform].upstreamUrl, lock.artifacts[platform].sha256]));
  for (const dependency of config.debianResolvedDependencies) locked.set(dependency.uri, dependency.sha256);
  if (JSON.stringify([...resolved.entries()].sort()) !== JSON.stringify([...locked.entries()].sort())) {
    throw new Error('provenance does not bind the exact OpenCode upstream inputs');
  }
}

function validateLicenses(source, opencodeVersion) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes); } catch { throw new Error('third-party licenses are not valid UTF-8'); }
  if (/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
    || !/opencode/i.test(text) || !text.includes(opencodeVersion)) {
    throw new Error('third-party licenses do not identify the pinned OpenCode version');
  }
}

export async function buildDesktopToolsRelease(configurationInput, now = Math.floor(Date.now() / 1_000)) {
  const config = Configuration.parse(configurationInput);
  if (!Number.isSafeInteger(now) || config.createdAt > now + 300 || config.expiresAt <= now
    || config.createdAt >= config.expiresAt || config.expiresAt - config.createdAt > 604_800) {
    throw new Error('release validity window is not current and bounded');
  }
  const output = resolve(config.outputDirectory);
  const parent = dirname(output);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('output parent is unsafe');
  try { await lstat(output); throw new Error('refusing to overwrite release output'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }

  const lockSource = await input(config.opencodeLock, limits.metadata, 'OpenCode lock');
  const lock = OpenCodeLock.parse(jsonObject(lockSource, 'OpenCode lock'));
  if (lock.version !== config.opencodeVersion) throw new Error('OpenCode lock version does not match the configured pin');
  const brokerApprovalDelegationSource = await input(config.brokerApprovalSignerDelegation, limits.delegation,
    'broker approval signer delegation');
  const brokerApprovalDelegation = BrokerApprovalSignerDelegation.parse(
    jsonObject(brokerApprovalDelegationSource, 'broker approval signer delegation'));
  if (!brokerApprovalDelegationSource.bytes.equals(Buffer.from(`${JSON.stringify(canonical(brokerApprovalDelegation))}\n`, 'utf8'))) {
    throw new Error('broker approval signer delegation is not canonical JSON');
  }
  const { delegationDigest, ...delegationProjection } = brokerApprovalDelegation;
  if (delegationDigest !== semanticDigest(
    'desktop-tools:broker-approval-signer-delegation:v1', delegationProjection,
  )) throw new Error('broker approval signer delegation digest is invalid');
  if (brokerApprovalDelegation.releaseId !== config.releaseId
    || brokerApprovalDelegation.channel !== config.releaseChannel) {
    throw new Error('broker approval signer delegation release or channel scope is invalid');
  }
  if (brokerApprovalDelegation.revocationEpoch < config.brokerApprovalMinimumRevocationEpoch) {
    throw new Error('broker approval signer delegation is below the release minimum revocation epoch');
  }
  const delegationStart = Date.parse(brokerApprovalDelegation.notBefore);
  const delegationEnd = Date.parse(brokerApprovalDelegation.notAfter);
  if (new Date(delegationStart).toISOString() !== brokerApprovalDelegation.notBefore
    || new Date(delegationEnd).toISOString() !== brokerApprovalDelegation.notAfter
    || delegationStart > config.createdAt * 1000 || delegationEnd < config.expiresAt * 1000) {
    throw new Error('broker approval signer delegation does not cover the release validity window');
  }
  try {
    const spki = Buffer.from(brokerApprovalDelegation.publicKeySpki, 'base64url');
    const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const canonicalSpki = key.export({ format: 'der', type: 'spki' }).toString('base64url');
    if (key.asymmetricKeyType !== 'ed25519' || canonicalSpki !== brokerApprovalDelegation.publicKeySpki) {
      throw new Error('not canonical Ed25519 SPKI');
    }
  } catch {
    throw new Error('broker approval signer delegation SPKI is not canonical Ed25519');
  }
  config.brokerApprovalDelegationSha256 = sha256(brokerApprovalDelegationSource.bytes);
  const debianInputs = {
    'debian-bookworm-archive-keyring.gpg': await input(config.debian.archiveKeyring, limits.metadata, 'Debian archive keyring'),
    'debian-bookworm-inrelease': await input(config.debian.inRelease, limits.metadata, 'Debian InRelease'),
    'debian-bookworm-main-amd64-Packages.xz': await input(config.debian.packagesIndex, limits.debian, 'Debian Packages index'),
    'tree_2.1.0-1_amd64.deb': await input(config.debian.treePayload, limits.debian, 'Debian tree payload'),
  };
  const trustPolicySource = await input(config.debian.trustPolicy, limits.metadata, 'Debian trust policy');
  const compositionSource = await input(config.debian.compositionReceipt, limits.metadata, 'Debian composition receipt');
  const trustPolicy = jsonObject(trustPolicySource, 'Debian trust policy');
  const composition = jsonObject(compositionSource, 'Debian composition receipt');
  config.debianTrustPolicySha256 = sha256(trustPolicySource.bytes);
  config.debianCompositionSha256 = sha256(compositionSource.bytes);
  if (composition.schemaVersion !== 1 || composition.descriptor?.packageKey !== 'tree'
    || composition.descriptor?.package?.version !== '2.1.0-1' || !Array.isArray(composition.artifacts)
    || composition.artifacts.length !== 4) throw new Error('Debian composition receipt is invalid');
  const debianArtifactFiles = {
    'debian-bookworm-archive-keyring': 'debian-bookworm-archive-keyring.gpg',
    'debian-bookworm-inrelease': 'debian-bookworm-inrelease',
    'debian-bookworm-main-amd64-packages': 'debian-bookworm-main-amd64-Packages.xz',
    'tree-deb-bookworm-amd64': 'tree_2.1.0-1_amd64.deb',
  };
  if (JSON.stringify(composition.artifacts.map(item => item?.id).sort()) !== JSON.stringify(Object.keys(debianArtifactFiles).sort())) {
    throw new Error('Debian composition receipt artifact closure is invalid');
  }
  for (const item of composition.artifacts) {
    const source = debianInputs[debianArtifactFiles[item.id]];
    if (!source || item.sha256 !== sha256(source.bytes) || item.sizeBytes !== source.bytes.length) throw new Error(`Debian composition artifact binding mismatch: ${item.id}`);
  }
  const freshness = composition.descriptor?.metadataProof?.inRelease;
  const signedAt = Date.parse(freshness?.signedAt);
  const validUntil = freshness?.validUntil;
  const maximumDateAgeSeconds = freshness?.maximumDateAgeSeconds;
  const freshnessDeadline = validUntil === null && Number.isSafeInteger(maximumDateAgeSeconds)
    ? signedAt + maximumDateAgeSeconds * 1000 : Date.parse(validUntil);
  if (!Number.isFinite(signedAt) || !Number.isFinite(freshnessDeadline)
    || config.expiresAt * 1000 > freshnessDeadline) {
    throw new Error('Debian repository freshness does not cover the release expiry');
  }
  const catalogSource = await input(config.catalog, limits.metadata, 'catalog');
  let catalog;
  try { catalog = JSON.parse(catalogSource.bytes.toString('utf8')); } catch { throw new Error('catalog is not valid JSON'); }
  if (!Array.isArray(catalog)) throw new Error('catalog must be an array');
  const treeEntries = catalog.filter(entry => entry?.name === 'tree');
  if (treeEntries.length !== 1 || treeEntries[0]?.offlinePayloads?.length !== 1
    || JSON.stringify(treeEntries[0].offlinePayloads[0]) !== JSON.stringify(composition.descriptor)) {
    throw new Error('catalog does not contain the exact staged tree offline payload authority');
  }
  const sources = new Map([
    ['provision.sh', await input(config.provisioner, limits.executable, 'provisioner')],
    ['desktop-tools-engine.mjs', await input(config.engine, limits.executable, 'engine')],
    ['catalog.json', catalogSource],
    ['desktop-tools-supervisor.mjs', await input(config.supervisor, limits.executable, 'supervisor')],
    ['desktop-tools-tools.tar.gz', await input(config.tools, limits.tools, 'tools archive')],
    ...await Promise.all(platforms.map(async platform => [
      `node-${outputPlatform(platform)}.tar.gz`, await input(config.runtimes[platform], limits.runtime, `${platform} Node runtime`)
    ])),
    ...await Promise.all(platforms.map(async platform => [
      opencodeFilename(platform), await input(config.opencode[platform], limits.opencode, `${platform} OpenCode runtime`)
    ])),
    ['opencode.lock.json', lockSource],
    ['broker-approval-signer-delegation.json', brokerApprovalDelegationSource],
    ['THIRD_PARTY_LICENSES.txt', await input(config.licenses, limits.metadata, 'third-party licenses')],
    ...Object.entries(debianInputs)
  ]);
  for (const platform of platforms) {
    const artifact = lock.artifacts[platform];
    const bytes = sources.get(opencodeFilename(platform)).bytes;
    if (artifact.size !== bytes.byteLength || artifact.sha256 !== sha256(bytes)
      || !artifact.upstreamUrl.includes(`/v${config.opencodeVersion}/`)) {
      throw new Error(`OpenCode lock binding mismatch: ${platform}`);
    }
  }
  validateLicenses(sources.get('THIRD_PARTY_LICENSES.txt'), config.opencodeVersion);
  config.debianResolvedDependencies = [
    { uri: trustPolicy.archiveKeyringUri, sha256: sha256(debianInputs['debian-bookworm-archive-keyring.gpg'].bytes) },
    { uri: trustPolicy.inReleaseUri, sha256: sha256(debianInputs['debian-bookworm-inrelease'].bytes) },
    { uri: trustPolicy.packagesIndexUri, sha256: sha256(debianInputs['debian-bookworm-main-amd64-Packages.xz'].bytes) },
    { uri: trustPolicy.treePayloadUri, sha256: sha256(debianInputs['tree_2.1.0-1_amd64.deb'].bytes) },
    { uri: `source:${config.sourceCommit}:debian-trust-policy`, sha256: sha256(trustPolicySource.bytes) },
    { uri: `composition:tree:2.1.0-1`, sha256: sha256(compositionSource.bytes) },
  ];

  const origin = 'https://desktop.tools';
  const launcher = Buffer.from(renderBootstrap({
    product: 'desktop-tools', manifestUrl: `${origin}/releases/${config.releaseId}/manifest`,
    signatureUrl: `${origin}/releases/${config.releaseId}/manifest.sig`,
    signerIdentity: config.signerId, signerPublicKey: config.signerPublicKey
  }), 'utf8');
  if (launcher.byteLength > limits.executable) throw new Error('launcher exceeds size policy');
  sources.set('start', { path: null, bytes: launcher });
  const expected = expectedPayloads(sources);
  const components = [...expected.entries()].sort().map(([name, content]) => ({
    type: 'file', name, hashes: [{ alg: 'SHA-256', content }]
  }));
  const sbom = {
    bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: { component: { type: 'application', name: 'desktop-tools-release', version: config.releaseId,
      properties: [{ name: 'desktop.tools:source-commit', value: config.sourceCommit },
        { name: 'desktop.tools:opencode-version', value: config.opencodeVersion },
        { name: 'desktop.tools:broker-approval-delegation-sha256', value: config.brokerApprovalDelegationSha256 },
        { name: 'desktop.tools:broker-approval-minimum-revocation-epoch', value: String(config.brokerApprovalMinimumRevocationEpoch) },
        { name: 'desktop.tools:debian-trust-policy-sha256', value: config.debianTrustPolicySha256 },
        { name: 'desktop.tools:debian-composition-sha256', value: config.debianCompositionSha256 }] } },
    components
  };
  const provenance = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [...expected.entries()].sort().map(([name, value]) => ({ name, digest: { sha256: value } })),
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: { buildDefinition: {
      buildType: 'https://desktop.tools/build-types/release-closure/v1',
      externalParameters: { releaseId: config.releaseId, sourceCommit: config.sourceCommit, opencodeVersion: config.opencodeVersion,
        brokerApprovalDelegationSha256: config.brokerApprovalDelegationSha256,
        brokerApprovalMinimumRevocationEpoch: config.brokerApprovalMinimumRevocationEpoch,
        debianTrustPolicySha256: sha256(trustPolicySource.bytes), debianCompositionSha256: sha256(compositionSource.bytes) },
      resolvedDependencies: platforms.map(platform => ({ uri: lock.artifacts[platform].upstreamUrl,
        digest: { sha256: lock.artifacts[platform].sha256 } })).concat(config.debianResolvedDependencies.map(item => ({ uri: item.uri, digest: { sha256: item.sha256 } })))
    }, runDetails: { builder: { id: 'https://desktop.tools/builders/release-closure/v1' } } }
  };
  sources.set('release.sbom.json', { path: null, bytes: Buffer.from(`${JSON.stringify(sbom)}\n`) });
  sources.set('release.provenance.json', { path: null, bytes: Buffer.from(`${JSON.stringify(provenance)}\n`) });
  const releaseEvidence = spdxReleaseEvidence(expected, config);
  sources.set('release.spdx.json', { path: null, bytes: releaseEvidence.spdxBytes });
  sources.set('release.exploitability.json', { path: null, bytes: releaseEvidence.exploitabilityBytes });
  validateSbom(sbom, expected, config);
  validateProvenance(provenance, expected, config, lock);
  const artifacts = [
    ['artifact', 'provision.sh'], ['engine', 'desktop-tools-engine.mjs'], ['catalog', 'catalog.json'],
    ['launcher', 'start'], ['supervisor', 'desktop-tools-supervisor.mjs'], ['tools', 'desktop-tools-tools.tar.gz'],
    ['opencode_lock', 'opencode.lock.json'], ['sbom', 'release.sbom.json'], ['provenance', 'release.provenance.json'],
    ['spdx', 'release.spdx.json'], ['exploitability', 'release.exploitability.json'], ['licenses', 'THIRD_PARTY_LICENSES.txt'],
    ['broker_approval_delegation', 'broker-approval-signer-delegation.json'],
    ['debian_keyring', 'debian-bookworm-archive-keyring.gpg'], ['debian_inrelease', 'debian-bookworm-inrelease'],
    ['debian_packages', 'debian-bookworm-main-amd64-Packages.xz'], ['debian_tree', 'tree_2.1.0-1_amd64.deb'],
    ...platforms.map(platform => [`runtime_${platform}`, `node-${outputPlatform(platform)}.tar.gz`]),
    ...platforms.map(platform => [`opencode_${platform}`, opencodeFilename(platform)])
  ];
  const bytesByName = new Map([...sources.entries()].map(([name, source]) => [name, source.bytes]));
  const lines = ['schema_version=10', 'product_id=desktop-tools', `release_id=${config.releaseId}`,
    `source_commit=${config.sourceCommit}`, `created_at=${config.createdAt}`, `expires_at=${config.expiresAt}`,
    `key_id=${config.signerId}`, 'engine_node_min=22', `runtime_node_version=${config.runtimeNodeVersion}`,
    `opencode_version=${config.opencodeVersion}`,
    `broker_approval_minimum_revocation_epoch=${config.brokerApprovalMinimumRevocationEpoch}`];
  for (const [prefix, filename] of artifacts) {
    const bytes = bytesByName.get(filename);
    lines.push(`${prefix}_url=${origin}/releases/${config.releaseId}/${filename}`,
      `${prefix}_sha256=${sha256(bytes)}`, `${prefix}_size=${bytes.byteLength}`);
  }
  const manifest = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
  if (manifest.byteLength > limits.manifest) throw new Error('manifest exceeds size policy');

  const stage = await mkdtemp(join(parent, '.desktop-tools-unsigned-'));
  await chmod(stage, 0o700);
  try {
    for (const [filename, source] of sources) {
      if (source.path) await copyFile(source.path, join(stage, filename));
      else await writeFile(join(stage, filename), source.bytes, { mode: 0o600, flag: 'wx' });
      await chmod(join(stage, filename), filename === 'start' || filename.endsWith('.sh') || filename.endsWith('.mjs') ? 0o700 : 0o600);
    }
    await writeFile(join(stage, 'manifest'), manifest, { mode: 0o600, flag: 'wx' });
    await rename(stage, output);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return Object.freeze({ schemaVersion: 2, manifestSchemaVersion: 9, product: 'desktop-tools',
    releaseId: config.releaseId, opencodeVersion: config.opencodeVersion,
    outputDirectory: output, manifestSha256: sha256(manifest) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [configurationPath] = process.argv.slice(2);
  if (!configurationPath) { process.stderr.write('usage: build-desktop-tools-release.mjs CONFIG.json\n'); process.exitCode = 64; }
  else buildDesktopToolsRelease(JSON.parse(await readFile(resolve(configurationPath), 'utf8')))
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => { process.stderr.write(`build-desktop-tools-release: ${error instanceof Error ? error.message : 'unknown failure'}\n`); process.exitCode = 1; });
}
