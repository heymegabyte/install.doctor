#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-provenance-test.XXXXXXXX")"
cleanup() { rm -rf -- "$FIXTURE"; }
trap cleanup EXIT HUP INT TERM

function_source="$(awk '/^idPersistVerifiedReleaseProvenance\(\)/ {copy=1} copy {print} copy && /^}/ {exit}' "$ROOT/scripts/provision.sh")"
[ -n "$function_source" ] || { printf 'FAIL provenance function missing\n' >&2; exit 1; }
eval "$function_source"

printf 'schema_version=2\nrelease_id=test-release\n' > "$FIXTURE/manifest"
printf 'test-signature\n' > "$FIXTURE/manifest.sig"
export XDG_STATE_HOME="$FIXTURE/state"
export INSTALL_DOCTOR_VERIFIED_MANIFEST="$FIXTURE/manifest"
export INSTALL_DOCTOR_VERIFIED_SIGNATURE="$FIXTURE/manifest.sig"
export INSTALL_DOCTOR_RELEASE_ID='test-release'
export INSTALL_DOCTOR_MANIFEST_SHA256="$(printf a%.0s {1..64})"
export INSTALL_DOCTOR_ARTIFACT_SHA256="$(printf b%.0s {1..64})"
export INSTALL_DOCTOR_ENGINE_SHA256="$(printf c%.0s {1..64})"

idPersistVerifiedReleaseProvenance
evidence="$XDG_STATE_HOME/install-doctor/releases/test-release"
cmp "$FIXTURE/manifest" "$evidence/manifest"
cmp "$FIXTURE/manifest.sig" "$evidence/manifest.sig"
grep -qx "${INSTALL_DOCTOR_MANIFEST_SHA256}  manifest" "$evidence/sha256sums"
grep -qx "${INSTALL_DOCTOR_ARTIFACT_SHA256}  provision.sh" "$evidence/sha256sums"
grep -qx "${INSTALL_DOCTOR_ENGINE_SHA256}  install-doctor-engine.mjs" "$evidence/sha256sums"
[ "$(find "$evidence" -type f -perm +077 -print 2>/dev/null)" = '' ]

INSTALL_DOCTOR_RELEASE_ID='../escape'
if idPersistVerifiedReleaseProvenance; then
  printf 'FAIL invalid release identity reached evidence storage\n' >&2
  exit 1
fi
[ ! -e "$XDG_STATE_HOME/install-doctor/releases/escape" ]
printf 'release-provenance-evidence: 9 passed, 0 failed\n'
