import { createHash, generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const desktopReleasePlatforms = Object.freeze(['macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64']);
export const opencodeArtifactName = platform => platform.startsWith('macos-')
  ? `opencode-${platform}.zip` : `opencode-${platform}.tar.gz`;

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)])) : value;
const semanticDigest = (domain, value) => digest(`${domain}\0${JSON.stringify(canonical(value))}`);

export async function createDesktopReleaseInputs(root, {
  releaseId = 'desktop-test-1', sourceCommit = 'a'.repeat(40), opencodeVersion = '2.2.5',
  bodies = {},
} = {}) {
  const outputBodies = new Map([
    ['provision.sh', bodies.provisioner ?? Buffer.from('provision\n')],
    ['desktop-tools-engine.mjs', bodies.engine ?? Buffer.from('engine\n')],
    ['desktop-tools-supervisor.mjs', bodies.supervisor ?? Buffer.from('supervisor\n')],
    ['desktop-tools-tools.tar.gz', bodies.tools ?? Buffer.from('tools\n')],
  ]);
  for (const platform of desktopReleasePlatforms) {
    outputBodies.set(`node-${platform}.tar.gz`, bodies.runtimes?.[platform] ?? Buffer.from(`node-${platform}\n`));
    outputBodies.set(opencodeArtifactName(platform), bodies.opencode?.[platform] ?? Buffer.from(`opencode-${platform}\n`));
  }
  const lock = { schemaVersion: 1, name: 'opencode', version: opencodeVersion, sourceCommit: 'c'.repeat(40), license: 'MIT',
    sourceVerification: { tagCommit: 'c'.repeat(40), gitHubVerified: false, assetDigestSource: 'github-release-api' }, artifacts: {} };
  for (const platform of desktopReleasePlatforms) {
    const key = platform.replace('-', '_'); const name = opencodeArtifactName(platform); const bytes = outputBodies.get(name);
    lock.artifacts[key] = { releaseFilename: name,
      upstreamUrl: `https://github.com/anomalyco/opencode/releases/download/v${opencodeVersion}/fixture-${platform}${name.endsWith('.zip') ? '.zip' : '.tar.gz'}`,
      sha256: digest(bytes), size: bytes.byteLength };
  }
  outputBodies.set('opencode.lock.json', Buffer.from(`${JSON.stringify(lock)}\n`));
  const debianBodies = {
    archiveKeyring: Buffer.from('debian keyring\n'), inRelease: Buffer.from('signed InRelease\n'),
    packagesIndex: Buffer.from('compressed Packages\n'), treePayload: Buffer.from('tree deb\n'),
  };
  const signedAt = new Date().toISOString();
  const descriptor = { schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: 'tree',
    platform: { os: 'linux', arch: 'x64' }, package: { name: 'tree', version: '2.1.0-1', architecture: 'amd64' },
    artifact: { id: 'tree-deb-bookworm-amd64', sha256: digest(debianBodies.treePayload), sizeBytes: debianBodies.treePayload.length,
      mediaType: 'application/vnd.debian.binary-package' },
    distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
    repository: { repositoryOrigin: 'https://deb.debian.org/debian', suite: 'bookworm', component: 'main' },
    metadataProof: { inRelease: { artifactId: 'debian-bookworm-inrelease', path: 'dists/bookworm/InRelease',
      sha256: digest(debianBodies.inRelease), sizeBytes: debianBodies.inRelease.length, signedAt, validUntil: null,
      maximumDateAgeSeconds: 180 * 86_400, signingKeyFingerprint: 'A'.repeat(40),
      keyring: { artifactId: 'debian-bookworm-archive-keyring', sha256: digest(debianBodies.archiveKeyring),
        sizeBytes: debianBodies.archiveKeyring.length, mediaType: 'application/vnd.gnupg.keyring' } },
      packagesIndex: { artifactId: 'debian-bookworm-main-amd64-packages', path: 'dists/bookworm/main/binary-amd64/Packages.xz',
        sha256: digest(debianBodies.packagesIndex), sizeBytes: debianBodies.packagesIndex.length, architecture: 'amd64' },
      packageStanza: { filename: 'pool/main/t/tree/tree_2.1.0-1_amd64.deb', sha256: digest(debianBodies.treePayload),
        sizeBytes: debianBodies.treePayload.length, depends: 'libc6 (>= 2.34)', preDepends: null, essential: 'absent', multiArch: 'absent' } },
    dependencyClosure: { depends: [], preDepends: [] },
    affectedServiceUnits: [], conffiles: [], maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny',
      serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' } };
  const receipt = { schemaVersion: 1, descriptor, artifacts: [
    ['debian-bookworm-inrelease', debianBodies.inRelease], ['debian-bookworm-archive-keyring', debianBodies.archiveKeyring],
    ['debian-bookworm-main-amd64-packages', debianBodies.packagesIndex], ['tree-deb-bookworm-amd64', debianBodies.treePayload],
  ].map(([id, bytes]) => ({ id, sha256: digest(bytes), sizeBytes: bytes.length })) };
  if (bodies.catalog) {
    const catalog = JSON.parse(Buffer.from(bodies.catalog).toString('utf8'));
    if (!Array.isArray(catalog) || catalog.filter(entry => entry?.name === 'tree').length !== 1) {
      throw new Error('fixture catalog must contain exactly one tree entry');
    }
    const staged = catalog.map(entry => entry?.name === 'tree'
      ? { ...entry, offlinePayloads: [receipt.descriptor] } : entry);
    outputBodies.set('catalog.json', Buffer.from(`${JSON.stringify(staged)}\n`));
  } else {
    outputBodies.set('catalog.json', Buffer.from(`${JSON.stringify([{ name: 'tree', offlinePayloads: [receipt.descriptor] }])}\n`));
  }
  const trustPolicy = { archiveKeyringUri: 'https://deb.debian.org/debian/keyring.gpg',
    inReleaseUri: 'https://deb.debian.org/debian/dists/bookworm/InRelease',
    packagesIndexUri: 'https://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.xz',
    treePayloadUri: 'https://deb.debian.org/debian/pool/main/t/tree/tree_2.1.0-1_amd64.deb' };
  const paths = {};
  for (const [name, bytes] of outputBodies) {
    const path = join(root, `input-${name}`); await writeFile(path, bytes, { mode: 0o600 }); paths[name] = path;
  }
  paths.licenses = join(root, 'input-licenses.txt'); await writeFile(paths.licenses, `OpenCode ${opencodeVersion}\nMIT License\n`);
  const debian = {};
  for (const [name, bytes] of Object.entries(debianBodies)) {
    debian[name] = join(root, `input-debian-${name}`); await writeFile(debian[name], bytes, { mode: 0o600 });
  }
  debian.trustPolicy = join(root, 'input-debian-trust-policy.json'); await writeFile(debian.trustPolicy, `${JSON.stringify(trustPolicy)}\n`, { mode: 0o600 });
  debian.compositionReceipt = join(root, 'input-debian-composition.json'); await writeFile(debian.compositionReceipt, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const approvalKey = generateKeyPairSync('ed25519').publicKey;
  const delegationProjection = { schemaVersion: 1, kind: 'desktop-tools-broker-approval-signer-delegation',
    keyId: 'approval-key-1', algorithm: 'Ed25519', signatureDomain: 'desktop-tools-broker-approval-v1',
    product: 'desktop-tools', releaseId, channel: 'stable',
    publicKeySpki: approvalKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    notBefore: new Date(Date.now() - 86_400_000).toISOString(),
    notAfter: new Date(Date.now() + 8 * 86_400_000).toISOString(),
    maximumApprovalLifetimeSeconds: 600, revocationEpoch: 7 };
  const brokerApprovalSignerDelegation = join(root, `input-${releaseId}-broker-approval-delegation.json`);
  await writeFile(brokerApprovalSignerDelegation, `${JSON.stringify(canonical({ ...delegationProjection,
    delegationDigest: semanticDigest('desktop-tools:broker-approval-signer-delegation:v1', delegationProjection) }))}\n`, { mode: 0o600 });
  return { releaseId, sourceCommit, opencodeVersion, provisioner: paths['provision.sh'], engine: paths['desktop-tools-engine.mjs'],
    catalog: paths['catalog.json'], supervisor: paths['desktop-tools-supervisor.mjs'], tools: paths['desktop-tools-tools.tar.gz'],
    opencodeLock: paths['opencode.lock.json'], licenses: paths.licenses, debian,
    releaseChannel: 'stable', brokerApprovalSignerDelegation, brokerApprovalMinimumRevocationEpoch: 7,
    runtimes: Object.fromEntries(desktopReleasePlatforms.map(platform => [platform.replace('-', '_'), paths[`node-${platform}.tar.gz`]])),
    opencode: Object.fromEntries(desktopReleasePlatforms.map(platform => [platform.replace('-', '_'), paths[opencodeArtifactName(platform)]])) };
}
