#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-release-sbom.XXXXXXXX")"
cleanup() { rm -rf -- "$FIXTURE"; }
trap cleanup EXIT HUP INT TERM

RELEASE="$FIXTURE/release"
mkdir -p "$RELEASE/nested"
printf 'manifest bytes\n' >"$RELEASE/manifest"
printf 'engine bytes\n' >"$RELEASE/nested/install doctor.mjs"
for index in $(seq 1 503); do
  printf 'artifact %s\n' "$index" >"$RELEASE/nested/artifact-$index"
done

SOURCE_COMMIT='0123456789abcdef0123456789abcdef01234567'
bash "$ROOT/scripts/generate-sbom.sh" \
  --release-dir "$RELEASE" \
  --release-id 'release-test' \
  --source-commit "$SOURCE_COMMIT" \
  --created-at '2026-11-06T12:00:00Z' \
  --file "$FIXTURE/first.json"

node - "$FIXTURE/first.json" "$RELEASE" "$SOURCE_COMMIT" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const [sbomPath, releaseDir, sourceCommit] = process.argv.slice(2);
const bom = JSON.parse(readFileSync(sbomPath, 'utf8'));
if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6') throw new Error('CycloneDX 1.6 contract missing');
if (bom.metadata.component.version !== 'release-test') throw new Error('release identity missing');
if (bom.metadata.timestamp !== '2026-11-06T12:00:00Z') throw new Error('canonical timestamp missing');
const properties = Object.fromEntries(bom.metadata.component.properties.map(({ name, value }) => [name, value]));
if (properties['install.doctor:source-commit'] !== sourceCommit) throw new Error('source commit missing');
if (bom.components.length !== 505) throw new Error(`expected all 505 files, got ${bom.components.length}`);
const names = bom.components.map(component => component.name);
if (names.join('\n') !== [...names].sort().join('\n')) throw new Error('components are not stable-path sorted');
const nested = bom.components.find(component => component.name === 'nested/install doctor.mjs');
if (!nested) throw new Error('nested path with spaces missing');
const bytes = readFileSync(join(releaseDir, nested.name));
const expected = createHash('sha256').update(bytes).digest('hex');
if (nested.hashes?.[0]?.alg !== 'SHA-256' || nested.hashes[0].content !== expected) throw new Error('file digest is not exact');
if (nested.properties.find(property => property.name === 'install.doctor:file-size')?.value !== String(statSync(join(releaseDir, nested.name)).size)) throw new Error('file size missing');
const rootDependency = bom.dependencies.find(dependency => dependency.ref === bom.metadata.component['bom-ref']);
if (!rootDependency || rootDependency.dependsOn.length !== 505) throw new Error('root dependency closure is incomplete');
NODE

# Stable metadata must produce byte-for-byte deterministic output.
bash "$ROOT/scripts/generate-sbom.sh" \
  --release-dir "$RELEASE" \
  --release-id 'release-test' \
  --source-commit "$SOURCE_COMMIT" \
  --created-at '2026-11-06T12:00:00Z' \
  --file "$FIXTURE/second.json"
cmp "$FIXTURE/first.json" "$FIXTURE/second.json"

# Release inventory fails closed rather than following a symlink outside the release.
ln -s "$FIXTURE/first.json" "$RELEASE/escaped"
if bash "$ROOT/scripts/generate-sbom.sh" \
  --release-dir "$RELEASE" \
  --release-id 'release-test' \
  --source-commit "$SOURCE_COMMIT" \
  --created-at '2026-11-06T12:00:00Z' \
  --file "$FIXTURE/rejected.json" 2>"$FIXTURE/rejected.err"; then
  printf 'FAIL release SBOM accepted a symlink\n' >&2
  exit 1
fi
grep -Fq 'release directory contains a symbolic link' "$FIXTURE/rejected.err"

# The release workflow must generate and attest both provenance and the SBOM
# in an isolated job with no release publication or signing authority.
WORKFLOW="$ROOT/.github/workflows/bootstrap-release-production.yml"
sed -n '/^  attest:/,/^  publish:/p' "$WORKFLOW" >"$FIXTURE/attest-job"
grep -Fq 'attestations: write' "$FIXTURE/attest-job"
grep -Fq 'artifact-metadata: write' "$FIXTURE/attest-job"
[ "$(grep -Fc 'uses: actions/attest@' "$FIXTURE/attest-job")" -eq 2 ]
grep -Fq 'sbom-path:' "$FIXTURE/attest-job"
grep -Fq 'subject-checksums:' "$FIXTURE/attest-job"
if grep -Eq 'Infisical|INSTALL_DOCTOR_RELEASE_SIGNING_KEY|publish-release-to-r2' "$FIXTURE/attest-job"; then
  printf 'FAIL attestation job has release credentials or publication authority\n' >&2
  exit 1
fi
grep -Fq 'needs: [build, sign, attest]' "$WORKFLOW"

printf 'release-sbom: 15 passed, 0 failed\n'
