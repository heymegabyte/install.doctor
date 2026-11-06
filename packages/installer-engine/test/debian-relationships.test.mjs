import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  DebianRelationshipError,
  parseDebianRelationships,
  validateDebianDependencyClosure,
} from '../dist/debian-relationships.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const compareVersions = (left, right) => left.localeCompare(right, undefined, { numeric: true });
function descriptor(key, name, { depends = null, preDepends = null, closureDepends = [], closurePre = [], version = '1.0', multiArch = 'absent' } = {}) {
  const artifactId = `${key}-deb`;
  return {
    schemaVersion: 1, kind: 'native-offline-package', manager: 'dpkg', packageKey: key,
    platform: { os: 'linux', arch: 'x64' }, package: { name, version, architecture: 'amd64' },
    artifact: { id: artifactId, sha256: hash(key), sizeBytes: 10, mediaType: 'application/vnd.debian.binary-package' },
    distro: { id: 'debian', versionId: '12', codename: 'bookworm' },
    repository: { repositoryOrigin: 'https://deb.example.invalid', suite: 'bookworm', component: 'main' },
    metadataProof: {
      inRelease: { artifactId: 'shared-release', path: 'dists/bookworm/InRelease', sha256: hash('a'), sizeBytes: 10, signedAt: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', signingKeyFingerprint: 'A'.repeat(40), keyring: { artifactId: 'shared-keyring', sha256: hash('b'), sizeBytes: 10, mediaType: 'application/vnd.gnupg.keyring' } },
      packagesIndex: { artifactId: 'shared-packages', path: 'dists/bookworm/main/binary-amd64/Packages.xz', sha256: hash('c'), sizeBytes: 10, architecture: 'amd64' },
      packageStanza: { filename: `pool/${name}.deb`, sha256: hash(key), sizeBytes: 10, depends, preDepends, essential: 'absent', multiArch },
    },
    dependencyClosure: {
      depends: closureDepends.map(([packageKey, id]) => ({ packageKey, artifactId: id ?? `${packageKey}-deb` })),
      preDepends: closurePre.map(([packageKey, id]) => ({ packageKey, artifactId: id ?? `${packageKey}-deb` })),
    },
    affectedServiceUnits: [], conffiles: [],
    maintainerScriptPolicy: { trust: 'signed-repository-metadata', network: 'deny', serviceStarts: 'suppress-and-restore', conffiles: 'preserve-local' },
  };
}

test('parses the bounded admitted relationship grammar', () => {
  assert.deepEqual(parseDebianRelationships(' libc6  ( >=  2.36 ),\n zlib1g:any, base-files:native (= 12.4) '), [
    { packageName: 'libc6', architectureQualifier: null, operator: '>=', version: '2.36' },
    { packageName: 'zlib1g', architectureQualifier: 'any', operator: null, version: null },
    { packageName: 'base-files', architectureQualifier: 'native', operator: '=', version: '12.4' },
  ]);
  assert.deepEqual(parseDebianRelationships(null), []);
});

test('rejects apt resolution features and malformed or duplicate terms', () => {
  for (const value of ['aa | bb', 'aa ${binary:Version}', 'aa [amd64]', 'aa <stage1>', 'aa*', 'aa,', 'aa, aa', 'aa\r, bb', 'aa\0']) {
    assert.throws(() => parseDebianRelationships(value), DebianRelationshipError, value);
  }
});

test('validates exact closure and emits deterministic pre-depends-first topological order', () => {
  const base = descriptor('base', 'base-pkg');
  const normal = descriptor('normal', 'normal-pkg');
  const root = descriptor('root', 'root-pkg', {
    preDepends: 'base-pkg (>= 1.0)', depends: 'normal-pkg',
    closurePre: [['base']], closureDepends: [['normal']],
  });
  const result = validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [normal, root, base], compareVersions });
  assert.deepEqual(result.installationOrder.map(value => value.packageKey), ['base', 'normal', 'root']);
});

test('accepts :any only with signed Multi-Arch authority', () => {
  const root = descriptor('root', 'root-pkg', { depends: 'foreign-pkg:any', closureDepends: [['foreign']] });
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [root, descriptor('foreign', 'foreign-pkg')], compareVersions }), /cannot safely satisfy/);
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [root, descriptor('foreign', 'foreign-pkg', { multiArch: 'foreign' })], compareVersions }), /cannot safely satisfy/);
  assert.deepEqual(validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [root, descriptor('foreign', 'foreign-pkg', { multiArch: 'allowed' })], compareVersions }).installationOrder.map(value => value.packageKey), ['foreign', 'root']);
});

test('fails closed on constraint, artifact, platform, unreachable, and cyclic closure errors', () => {
  const dependency = descriptor('dep', 'dep-pkg', { version: '1.0' });
  const constrained = descriptor('root', 'root-pkg', { depends: 'dep-pkg (>= 2.0)', closureDepends: [['dep']] });
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [constrained, dependency], compareVersions }), /does not satisfy/);

  const wrongArtifact = descriptor('root', 'root-pkg', { depends: 'dep-pkg', closureDepends: [['dep', 'wrong']] });
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [wrongArtifact, dependency], compareVersions }), /does not exactly match/);

  const otherPlatform = structuredClone(dependency); otherPlatform.platform.arch = 'arm64'; otherPlatform.package.architecture = 'arm64'; otherPlatform.metadataProof.packagesIndex.architecture = 'arm64'; otherPlatform.metadataProof.packagesIndex.path = 'dists/bookworm/main/binary-arm64/Packages.xz';
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [wrongArtifact, otherPlatform], compareVersions }), /incompatible Debian architecture|outside the root platform/);

  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [descriptor('root', 'root-pkg'), dependency], compareVersions }), /unreachable/);

  const first = descriptor('first', 'first-pkg', { depends: 'second-pkg', closureDepends: [['second']] });
  const second = descriptor('second', 'second-pkg', { preDepends: 'first-pkg', closurePre: [['first']] });
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'first', descriptors: [first, second], compareVersions }), /cycle/);
});

test('rejects missing, self, cross-class, duplicate-name, and repository-mismatched dependencies', () => {
  const missing = descriptor('root', 'root-pkg', { depends: 'missing-pkg', closureDepends: [['missing']] });
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [missing], compareVersions }), /missing package/);

  const self = descriptor('root', 'root-pkg', { depends: 'root-pkg', closureDepends: [['root']] });
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [self], compareVersions }), /self dependency/);

  const dependency = descriptor('dep', 'dep-pkg');
  const cross = descriptor('root', 'root-pkg', { depends: 'dep-pkg', preDepends: 'dep-pkg', closureDepends: [['dep']], closurePre: [['dep']] });
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [cross, dependency], compareVersions }), /both Pre-Depends and Depends|invalid native package closure/);

  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [descriptor('root', 'same-pkg'), descriptor('other', 'same-pkg')], compareVersions }), /ambiguous package name/);

  const foreignRepository = descriptor('dep', 'dep-pkg'); foreignRepository.repository.repositoryOrigin = 'https://other.example.invalid';
  const root = descriptor('root', 'root-pkg', { depends: 'dep-pkg', closureDepends: [['dep']] });
  assert.throws(() => validateDebianDependencyClosure({ rootPackageKey: 'root', descriptors: [root, foreignRepository], compareVersions }), /outside the root platform/);
});
