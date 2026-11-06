#!/usr/bin/env bash
# Build an unsigned immutable stage-zero release envelope. This process executes
# repository-controlled build commands and therefore MUST NOT receive or share a
# signing private key. A separate no-build signing boundary validates and signs
# the inert output with sign-bootstrap-release.sh.
set -euo pipefail
umask 077
export LC_ALL=C
PUBLISHER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MAX_ARTIFACT_BYTES=8388608
MAX_RUNTIME_BYTES=100663296
MAX_SIGNATURE_BYTES=8192
MAX_EPOCH=4102444800
MAX_RELEASE_LIFETIME=604800

usage() {
  printf 'usage: %s RELEASE_ID SOURCE_COMMIT CREATED_EPOCH EXPIRES_EPOCH SIGNER_ID - PROVISIONER [ENGINE] OUTPUT_DIR\n' "$0" >&2
  exit 64
}
[ "$#" -eq 8 ] || [ "$#" -eq 9 ] || usage

release_id="$1"
source_commit="$2"
created_at="$3"
expires_at="$4"
signer_id="$5"
signing_key="$6"
provisioner="$7"
if [ "$#" -eq 9 ]; then
engine="$8"
  output_dir="$9"
else
  engine="$(dirname "$provisioner")/install-doctor-engine.mjs"
  output_dir="$8"
fi

runtime_node_version="${INSTALL_DOCTOR_RUNTIME_NODE_VERSION:-}"
runtime_dir="${INSTALL_DOCTOR_RUNTIME_DIR:-}"
runtime_shasums="${INSTALL_DOCTOR_NODE_SHASUMS:-}"
runtime_shasums_signature="${INSTALL_DOCTOR_NODE_SHASUMS_SIGNATURE:-}"
runtime_keyring="${INSTALL_DOCTOR_NODE_RELEASE_KEYRING:-}"
[ "$signing_key" = - ] || {
  printf 'the unsigned builder refuses signing keys; argument 6 must be - and signing must use sign-bootstrap-release.sh\n' >&2
  exit 64
}
[[ "$runtime_node_version" =~ ^24\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  printf 'INSTALL_DOCTOR_RUNTIME_NODE_VERSION must be an exact supported Node 24 semver\n' >&2
  exit 65
}
for provenance_file in "$runtime_shasums" "$runtime_shasums_signature" "$runtime_keyring"; do
  [ -f "$provenance_file" ] && [ ! -L "$provenance_file" ] || {
    printf 'pinned Node SHASUMS, detached signature, and release keyring are required publisher inputs\n' >&2
    exit 66
  }
done
command -v gpgv >/dev/null 2>&1 || { printf 'gpgv is required to verify pinned Node release provenance\n' >&2; exit 69; }
gpgv --keyring "$runtime_keyring" "$runtime_shasums_signature" "$runtime_shasums" >/dev/null 2>&1 || {
  printf 'pinned Node SHASUMS signature verification failed\n' >&2
  exit 69
}

file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

file_owner() {
  if stat -c '%u' "$1" >/dev/null 2>&1; then
    stat -c '%u' "$1"
  else
    stat -f '%u' "$1"
  fi
}

require_canonical_epoch() {
  value="$1"
  case "$value" in *[!0-9]*|'') return 1 ;; esac
  case "$value" in 0|[1-9]*) ;; *) return 1 ;; esac
  [ "$value" -le "$MAX_EPOCH" ] 2>/dev/null
}

case "$release_id" in ''|[!a-z0-9]*|*[!a-z0-9._-]*)
  printf 'invalid release identifier\n' >&2; exit 65 ;;
esac
[ "${#release_id}" -le 128 ] || { printf 'invalid release identifier\n' >&2; exit 65; }
case "$signer_id" in ''|[!a-z0-9]*|*[!a-z0-9._-]*)
  printf 'invalid signer identifier\n' >&2; exit 65 ;;
esac
[ "${#signer_id}" -le 128 ] || { printf 'invalid signer identifier\n' >&2; exit 65; }
case "$source_commit" in *[!0-9a-f]*|'') printf 'source commit must be hexadecimal\n' >&2; exit 65 ;; esac
[ "${#source_commit}" -eq 40 ] || { printf 'source commit must be a full 40-character SHA-1\n' >&2; exit 65; }
if ! require_canonical_epoch "$created_at" || ! require_canonical_epoch "$expires_at"; then
  printf 'release timestamps must be canonical integer epochs no later than %s\n' "$MAX_EPOCH" >&2
  exit 65
fi
[ "$created_at" -lt "$expires_at" ] || { printf 'release expiry must follow creation\n' >&2; exit 65; }
now="$(date -u +%s)"
[ "$created_at" -le "$((now + 300))" ] && [ "$expires_at" -gt "$now" ] \
  && [ "$((expires_at - created_at))" -le "$MAX_RELEASE_LIFETIME" ] || {
  printf 'release window must be current, at most five minutes future-dated, and no longer than seven days\n' >&2
  exit 65
}
[ -f "$provisioner" ] && [ ! -L "$provisioner" ] || { printf 'provisioner must be a regular non-symlink file\n' >&2; exit 66; }
[ -f "$engine" ] && [ ! -L "$engine" ] || { printf 'engine must be a regular non-symlink file\n' >&2; exit 66; }
for runtime_platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do
  case "$runtime_platform" in macos-x64) upstream_platform=darwin-x64 ;; macos-arm64) upstream_platform=darwin-arm64 ;; *) upstream_platform="$runtime_platform" ;; esac
  runtime_source="$runtime_dir/node-v$runtime_node_version-$upstream_platform.tar.gz"
  [ -f "$runtime_source" ] && [ ! -L "$runtime_source" ] || { printf 'missing regular runtime artifact for %s\n' "$runtime_platform" >&2; exit 66; }
  runtime_size="$(wc -c < "$runtime_source" | tr -d '[:space:]')"
  [ "$runtime_size" -gt 0 ] && [ "$runtime_size" -le "$MAX_RUNTIME_BYTES" ] || { printf 'runtime artifact size is outside policy for %s\n' "$runtime_platform" >&2; exit 65; }
done
command -v git >/dev/null 2>&1 || { printf 'git is required to bind release artifacts to source_commit\n' >&2; exit 69; }
command -v npm >/dev/null 2>&1 || { printf 'npm is required to reproduce the engine from source_commit\n' >&2; exit 69; }

parent="$(dirname "$output_dir")"
[ -d "$parent" ] && [ ! -L "$parent" ] || {
  printf 'release parent must be an existing non-symlink directory: %s\n' "$parent" >&2
  exit 73
}
parent_mode="$(file_mode "$parent")"
parent_mode_value=$((8#$parent_mode))
(( (parent_mode_value & 022) == 0 )) || {
  printf 'release parent must not be writable by group or other users: %s\n' "$parent" >&2
  exit 77
}
[ "$(file_owner "$parent")" -eq "$(id -u)" ] || {
  printf 'release parent must be owned by the publishing user: %s\n' "$parent" >&2
  exit 77
}
[ ! -e "$output_dir" ] && [ ! -L "$output_dir" ] || {
  printf 'refusing to overwrite release directory: %s\n' "$output_dir" >&2
  exit 73
}

provisioner_repo="$(git -C "$(dirname "$provisioner")" rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'provisioner must belong to the source_commit repository\n' >&2; exit 65;
}
engine_repo="$(git -C "$(dirname "$engine")" rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'engine must belong to the source_commit repository\n' >&2; exit 65;
}
[ "$provisioner_repo" = "$engine_repo" ] || {
  printf 'provisioner and engine must belong to the same source_commit repository\n' >&2; exit 65;
}
git -C "$provisioner_repo" cat-file -e "$source_commit^{commit}" 2>/dev/null || {
  printf 'source_commit is not an available commit in the artifact repository\n' >&2; exit 65;
}
verify_committed_artifact() {
  candidate="$1"
  label="$2"
  candidate_directory="$(cd "$(dirname "$candidate")" && pwd -P)"
  candidate_path="$candidate_directory/$(basename "$candidate")"
  case "$candidate_path" in "$provisioner_repo"/*) ;; *)
    printf '%s must be contained by the source_commit repository\n' "$label" >&2; exit 65 ;;
  esac
  relative_path="${candidate_path#"$provisioner_repo"/}"
  case "$relative_path" in *:*) printf '%s source path is not canonical\n' "$label" >&2; exit 65 ;; esac
  if ! git -C "$provisioner_repo" show "$source_commit:$relative_path" 2>/dev/null | cmp -s - "$candidate"; then
    printf '%s bytes do not match source_commit\n' "$label" >&2
    exit 65
  fi
}
verify_committed_artifact "$provisioner" provisioner

# The executable bundle is intentionally generated rather than committed. Build
# it in a detached worktree at the exact signed commit, using committed lockfiles,
# and require byte-for-byte equality with the publisher input. This binds the
# release artifact to reviewable source without treating mutable local dist/
# output as source authority.
build_root="$(mktemp -d "$parent/.bootstrap-engine-build.XXXXXXXX")"
chmod 0700 "$build_root"
cleanup_build() {
  git -C "$provisioner_repo" worktree remove --force "$build_root/source" >/dev/null 2>&1 || true
  rm -rf -- "$build_root"
}
trap cleanup_build EXIT
trap 'cleanup_build; trap - HUP; exit 129' HUP
trap 'cleanup_build; trap - INT; exit 130' INT
trap 'cleanup_build; trap - TERM; exit 143' TERM
git -C "$provisioner_repo" worktree add --quiet --detach "$build_root/source" "$source_commit" || {
  printf 'unable to materialize source_commit for engine reproduction\n' >&2; exit 69;
}
for package_dir in packages/aid-core packages/installer-engine; do
  [ -f "$build_root/source/$package_dir/package.json" ] \
    && [ -f "$build_root/source/$package_dir/package-lock.json" ] || {
      printf 'source_commit lacks the locked engine build package: %s\n' "$package_dir" >&2; exit 65;
    }
  (cd "$build_root/source/$package_dir" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null) || {
    printf 'locked dependency installation failed for %s\n' "$package_dir" >&2; exit 69;
  }
done
(cd "$build_root/source/packages/aid-core" && npm run build >/dev/null) || {
  printf 'aid-core reproduction failed at source_commit\n' >&2; exit 69;
}
(cd "$build_root/source/packages/installer-engine" && npm run bundle >/dev/null) || {
  printf 'engine reproduction failed at source_commit\n' >&2; exit 69;
}
reproduced_engine="$build_root/source/packages/installer-engine/dist/install-doctor-engine.mjs"
if [ ! -f "$reproduced_engine" ] || [ -L "$reproduced_engine" ] || ! cmp -s "$reproduced_engine" "$engine"; then
  printf 'engine bytes do not match the reproducible source_commit build\n' >&2; exit 65;
fi
cleanup_build
trap - EXIT HUP INT TERM

stage="$(mktemp -d "$parent/.bootstrap-release.XXXXXXXX")"
chmod 0700 "$stage"
cleanup() { rm -rf -- "$stage"; }
on_signal() { trap - EXIT HUP INT TERM; cleanup; exit "$1"; }
trap cleanup EXIT
trap 'on_signal 129' HUP
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

artifact="$stage/provision.sh"
engine_artifact="$stage/install-doctor-engine.mjs"
catalog_artifact="$stage/catalog.json"
launcher="$stage/start"
manifest="$stage/manifest"
cp "$provisioner" "$artifact"
cp "$engine" "$engine_artifact"
git -C "$provisioner_repo" show "$source_commit:packages/control-plane/src/catalog.json" > "$catalog_artifact" || {
  printf 'source_commit lacks the canonical generated catalog\n' >&2; exit 65;
}
launcher_config="$stage/.launcher-config.json"
node - "$launcher_config" "$release_id" "$signer_id" <<'NODE'
const fs = require('node:fs'); const [file, releaseId, signerIdentity] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  manifestUrl: `https://app.install.doctor/releases/${releaseId}/manifest`,
  signatureUrl: `https://app.install.doctor/releases/${releaseId}/manifest.sig`, signerIdentity,
  signerPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
node "$PUBLISHER_DIR/helpers/render-bootstrap.mjs" "$launcher_config" > "$launcher" || {
  printf 'unable to render immutable launcher template\n' >&2; exit 69;
}
rm -f "$launcher_config"
node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(value)) process.exit(1)' "$catalog_artifact" || {
  printf 'source_commit catalog is not a valid JSON array\n' >&2; exit 65;
}
for runtime_platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do
  case "$runtime_platform" in macos-x64) upstream_platform=darwin-x64 ;; macos-arm64) upstream_platform=darwin-arm64 ;; *) upstream_platform="$runtime_platform" ;; esac
  runtime_name="node-v$runtime_node_version-$upstream_platform.tar.gz"
  runtime_source="$runtime_dir/$runtime_name"
  runtime_expected="$(awk -v name="$runtime_name" '$2 == name { print $1 }' "$runtime_shasums")"
  case "$runtime_expected" in *[!0-9a-f]*|'') printf 'pinned Node SHASUMS is missing %s\n' "$runtime_name" >&2; exit 65 ;; esac
  [ "${#runtime_expected}" -eq 64 ] && [ "$(awk -v name="$runtime_name" '$2 == name { count++ } END { print count + 0 }' "$runtime_shasums")" -eq 1 ] || { printf 'pinned Node SHASUMS entry is invalid or duplicated for %s\n' "$runtime_name" >&2; exit 65; }
  runtime_output="$stage/node-$runtime_platform.tar.gz"
  cp "$runtime_source" "$runtime_output"
  chmod 0600 "$runtime_output"
  if command -v sha256sum >/dev/null 2>&1; then runtime_actual="$(sha256sum "$runtime_output" | awk '{print $1}')"; else runtime_actual="$(shasum -a 256 "$runtime_output" | awk '{print $1}')"; fi
  [ "$runtime_actual" = "$runtime_expected" ] || { printf 'runtime artifact does not match pinned Node SHASUMS for %s\n' "$runtime_platform" >&2; exit 65; }
  eval "runtime_${runtime_platform//-/_}_sha256=\$runtime_actual runtime_${runtime_platform//-/_}_size=\$(wc -c < \"\$runtime_output\" | tr -d '[:space:]')"
done
chmod 0700 "$artifact"
chmod 0700 "$engine_artifact"
chmod 0600 "$catalog_artifact"
artifact_size="$(wc -c < "$artifact" | tr -d '[:space:]')"
engine_size="$(wc -c < "$engine_artifact" | tr -d '[:space:]')"
catalog_size="$(wc -c < "$catalog_artifact" | tr -d '[:space:]')"
[ "$artifact_size" -gt 0 ] && [ "$artifact_size" -le "$MAX_ARTIFACT_BYTES" ] || {
  printf 'provisioner size must be between 1 and %s bytes\n' "$MAX_ARTIFACT_BYTES" >&2
  exit 65
}
[ "$engine_size" -gt 0 ] && [ "$engine_size" -le "$MAX_ARTIFACT_BYTES" ] || {
  printf 'engine size must be between 1 and %s bytes\n' "$MAX_ARTIFACT_BYTES" >&2
  exit 65
}
[ "$catalog_size" -gt 0 ] && [ "$catalog_size" -le "$MAX_ARTIFACT_BYTES" ] || {
  printf 'catalog size must be between 1 and %s bytes\n' "$MAX_ARTIFACT_BYTES" >&2
  exit 65
}
if command -v sha256sum >/dev/null 2>&1; then
  artifact_sha256="$(sha256sum "$artifact" | awk '{print $1}')"
  engine_sha256="$(sha256sum "$engine_artifact" | awk '{print $1}')"
  catalog_sha256="$(sha256sum "$catalog_artifact" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  artifact_sha256="$(shasum -a 256 "$artifact" | awk '{print $1}')"
  engine_sha256="$(shasum -a 256 "$engine_artifact" | awk '{print $1}')"
  catalog_sha256="$(shasum -a 256 "$catalog_artifact" | awk '{print $1}')"
else
  printf 'sha256sum or shasum is required\n' >&2
  exit 69
fi
artifact_url="https://app.install.doctor/releases/$release_id/provision.sh"
engine_url="https://app.install.doctor/releases/$release_id/install-doctor-engine.mjs"
catalog_url="https://app.install.doctor/releases/$release_id/catalog.json"
{
  printf 'schema_version=4\n'
  printf 'release_id=%s\n' "$release_id"
  printf 'source_commit=%s\n' "$source_commit"
  printf 'created_at=%s\n' "$created_at"
  printf 'expires_at=%s\n' "$expires_at"
  printf 'key_id=%s\n' "$signer_id"
  printf 'artifact_url=%s\n' "$artifact_url"
  printf 'artifact_sha256=%s\n' "$artifact_sha256"
  printf 'artifact_size=%s\n' "$artifact_size"
  printf 'engine_url=%s\n' "$engine_url"
  printf 'engine_sha256=%s\n' "$engine_sha256"
  printf 'engine_size=%s\n' "$engine_size"
  printf 'engine_node_min=22\n'
  printf 'catalog_url=%s\n' "$catalog_url"
  printf 'catalog_sha256=%s\n' "$catalog_sha256"
  printf 'catalog_size=%s\n' "$catalog_size"
  printf 'runtime_node_version=%s\n' "$runtime_node_version"
  for runtime_platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do
    runtime_key="${runtime_platform//-/_}"
    runtime_sha_name="runtime_${runtime_key}_sha256"
    runtime_size_name="runtime_${runtime_key}_size"
    printf 'runtime_%s_url=https://app.install.doctor/releases/%s/node-%s.tar.gz\n' "$runtime_key" "$release_id" "$runtime_platform"
    printf 'runtime_%s_sha256=%s\n' "$runtime_key" "${!runtime_sha_name}"
    printf 'runtime_%s_size=%s\n' "$runtime_key" "${!runtime_size_name}"
  done
} > "$manifest"

chmod 0600 "$stage/manifest"
chmod 0600 "$launcher"

[ ! -e "$output_dir" ] && [ ! -L "$output_dir" ] || {
  printf 'refusing to overwrite release directory: %s\n' "$output_dir" >&2
  exit 73
}
mv "$stage" "$output_dir"
chmod 0700 "$output_dir"
trap - EXIT HUP INT TERM
printf 'unsigned release %s created at %s; sign it in the isolated signing boundary\n' "$release_id" "$output_dir"
