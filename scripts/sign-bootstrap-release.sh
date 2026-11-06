#!/usr/bin/env bash
# Validate and sign an inert unsigned bootstrap release. This signer intentionally
# has no Git/npm/build behavior and must run in a no-checkout signing environment.
set -euo pipefail
umask 077
export LC_ALL=C

MAX_SIGNATURE_BYTES=8192
MAX_MANIFEST_BYTES=16384
MAX_ARTIFACT_BYTES=8388608
MAX_RUNTIME_BYTES=100663296
MAX_RELEASE_LIFETIME=604800

usage() {
  printf 'usage: %s SIGNER_ID SIGNING_KEY UNSIGNED_RELEASE SIGNED_RELEASE\n' "$0" >&2
  exit 64
}
[ "$#" -eq 4 ] || usage
signer_id="$1"; signing_key="$2"; unsigned_dir="$3"; output_dir="$4"

case "$signer_id" in ''|[!a-z0-9]*|*[!a-z0-9._-]*) printf 'invalid signer identifier\n' >&2; exit 65 ;; esac
[ "${#signer_id}" -le 128 ] || { printf 'invalid signer identifier\n' >&2; exit 65; }

mode() { if stat -c '%a' "$1" >/dev/null 2>&1; then stat -c '%a' "$1"; else stat -f '%Lp' "$1"; fi; }
owner() { if stat -f '%u' "$1" >/dev/null 2>&1; then stat -f '%u' "$1"; else stat -c '%u' "$1"; fi; }
size() { wc -c < "$1" | tr -d '[:space:]'; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
manifest_value() {
  key="$1"
  count="$(awk -F= -v key="$key" '$1 == key { count++ } END { print count + 0 }' "$manifest")"
  [ "$count" -eq 1 ] || { printf 'manifest key is missing or duplicated: %s\n' "$key" >&2; exit 65; }
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print }' "$manifest"
}

[ -d "$unsigned_dir" ] && [ ! -L "$unsigned_dir" ] || { printf 'unsigned release must be a real directory\n' >&2; exit 66; }
[ "$(owner "$unsigned_dir")" -eq "$(id -u)" ] || { printf 'unsigned release must be owned by the signer user\n' >&2; exit 77; }
unsigned_mode=$((8#$(mode "$unsigned_dir")))
(( (unsigned_mode & 022) == 0 )) || { printf 'unsigned release directory is writable by another user class\n' >&2; exit 77; }

expected="catalog.json install-doctor-engine.mjs manifest node-linux-arm64.tar.gz node-linux-x64.tar.gz node-macos-arm64.tar.gz node-macos-x64.tar.gz provision.sh start"
actual="$(find "$unsigned_dir" -mindepth 1 -maxdepth 1 -print | sed 's#^.*/##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"
[ "$actual" = "$expected" ] || { printf 'unsigned release does not match the exact nine-file allowlist\n' >&2; exit 65; }
for name in $expected; do
  path="$unsigned_dir/$name"
  [ -f "$path" ] && [ ! -L "$path" ] || { printf 'unsafe unsigned release file: %s\n' "$name" >&2; exit 66; }
  [ "$(owner "$path")" -eq "$(id -u)" ] || { printf 'unsigned release file has the wrong owner: %s\n' "$name" >&2; exit 77; }
  [ "$(find "$path" -links +1 -print | wc -l | tr -d '[:space:]')" -eq 0 ] || { printf 'hard-linked unsigned release file: %s\n' "$name" >&2; exit 77; }
done

manifest="$unsigned_dir/manifest"
manifest_size="$(size "$manifest")"
[ "$manifest_size" -gt 0 ] && [ "$manifest_size" -le "$MAX_MANIFEST_BYTES" ] || { printf 'manifest size is outside policy\n' >&2; exit 65; }
[ "$(wc -l < "$manifest" | tr -d '[:space:]')" -eq 29 ] || { printf 'manifest schema-v4 key count is invalid\n' >&2; exit 65; }
while IFS= read -r line; do
  case "$line" in [a-z0-9_]*=*) ;; *) printf 'manifest contains a malformed line\n' >&2; exit 65 ;; esac
done < "$manifest"

[ "$(manifest_value schema_version)" = 4 ] || { printf 'unsupported manifest schema\n' >&2; exit 65; }
release_id="$(manifest_value release_id)"
case "$release_id" in ''|[!a-z0-9]*|*[!a-z0-9._-]*) printf 'invalid manifest release identifier\n' >&2; exit 65 ;; esac
[ "${#release_id}" -le 128 ] || { printf 'invalid manifest release identifier\n' >&2; exit 65; }
[ "$(manifest_value key_id)" = "$signer_id" ] || { printf 'manifest signer identity mismatch\n' >&2; exit 65; }
source_commit="$(manifest_value source_commit)"
case "$source_commit" in *[!0-9a-f]*|'') printf 'invalid manifest source commit\n' >&2; exit 65 ;; esac
[ "${#source_commit}" -eq 40 ] || { printf 'invalid manifest source commit\n' >&2; exit 65; }
created="$(manifest_value created_at)"; expires="$(manifest_value expires_at)"; now="$(date -u +%s)"
case "$created:$expires" in *[!0-9:]*|:|*:) printf 'invalid manifest validity window\n' >&2; exit 65 ;; esac
[ "$created" -le "$((now + 300))" ] && [ "$expires" -gt "$now" ] && [ "$created" -lt "$expires" ] \
  && [ "$((expires - created))" -le "$MAX_RELEASE_LIFETIME" ] || { printf 'manifest validity window is not current and bounded\n' >&2; exit 65; }
[ "$(manifest_value engine_node_min)" = 22 ] || { printf 'invalid engine Node contract\n' >&2; exit 65; }
case "$(manifest_value runtime_node_version)" in 24.[0-9]*.[0-9]*) ;; *) printf 'invalid runtime Node version\n' >&2; exit 65 ;; esac

validate_artifact() {
  prefix="$1"; filename="$2"; maximum="$3"; path="$unsigned_dir/$filename"
  expected_url="https://app.install.doctor/releases/$release_id/$filename"
  [ "$(manifest_value "${prefix}_url")" = "$expected_url" ] || { printf 'manifest URL mismatch: %s\n' "$filename" >&2; exit 65; }
  declared_size="$(manifest_value "${prefix}_size")"
  [ "$declared_size" = "$(size "$path")" ] && [ "$declared_size" -gt 0 ] && [ "$declared_size" -le "$maximum" ] \
    || { printf 'manifest size mismatch: %s\n' "$filename" >&2; exit 65; }
  [ "$(manifest_value "${prefix}_sha256")" = "$(sha256 "$path")" ] || { printf 'manifest digest mismatch: %s\n' "$filename" >&2; exit 65; }
}
validate_artifact artifact provision.sh "$MAX_ARTIFACT_BYTES"
validate_artifact engine install-doctor-engine.mjs "$MAX_ARTIFACT_BYTES"
validate_artifact catalog catalog.json "$MAX_ARTIFACT_BYTES"
for platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do
  validate_artifact "runtime_${platform//-/_}" "node-$platform.tar.gz" "$MAX_RUNTIME_BYTES"
done

[ -f "$signing_key" ] && [ ! -L "$signing_key" ] || { printf 'signing key must be a regular non-symlink file\n' >&2; exit 66; }
key_mode=$((8#$(mode "$signing_key")))
(( (key_mode & 077) == 0 )) || { printf 'signing key must not be accessible by group or other users\n' >&2; exit 77; }
[ "$(owner "$signing_key")" -eq "$(id -u)" ] || { printf 'signing key must be owned by the signing user\n' >&2; exit 77; }
command -v ssh-keygen >/dev/null 2>&1 || { printf 'ssh-keygen with SSHSIG support is required\n' >&2; exit 69; }
public_key="$(ssh-keygen -y -f "$signing_key" 2>/dev/null)" || { printf 'signing key is unreadable\n' >&2; exit 69; }
case "$public_key" in 'ssh-ed25519 '*) ;; *) printf 'signing key must use Ed25519\n' >&2; exit 69 ;; esac

parent="$(dirname "$output_dir")"
[ -d "$parent" ] && [ ! -L "$parent" ] || { printf 'signed release parent is unsafe\n' >&2; exit 73; }
[ "$(owner "$parent")" -eq "$(id -u)" ] || { printf 'signed release parent has the wrong owner\n' >&2; exit 77; }
parent_mode=$((8#$(mode "$parent")))
(( (parent_mode & 022) == 0 )) || { printf 'signed release parent is writable by another user class\n' >&2; exit 77; }
[ ! -e "$output_dir" ] && [ ! -L "$output_dir" ] || { printf 'refusing to overwrite signed release directory\n' >&2; exit 73; }

stage="$(mktemp -d "$parent/.bootstrap-signed.XXXXXXXX")"; chmod 0700 "$stage"
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT
trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
for name in $expected; do cp "$unsigned_dir/$name" "$stage/$name"; done
placeholder="readonly SIGNER_KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'"
[ "$(grep -Fxc "$placeholder" "$stage/start")" -eq 1 ] || { printf 'launcher template signer placeholder is invalid\n' >&2; exit 65; }
awk -v replacement="readonly SIGNER_KEY='$public_key'" -v placeholder="$placeholder" '{ if ($0 == placeholder) print replacement; else print }' "$stage/start" > "$stage/start.final"
mv "$stage/start.final" "$stage/start"; chmod 0700 "$stage/start"
launcher_size="$(size "$stage/start")"; launcher_sha256="$(sha256 "$stage/start")"
[ "$launcher_size" -gt 0 ] && [ "$launcher_size" -le "$MAX_ARTIFACT_BYTES" ] || { printf 'launcher size is outside policy\n' >&2; exit 65; }
sed 's/^schema_version=4$/schema_version=5/' "$stage/manifest" > "$stage/manifest.v5"
{
  cat "$stage/manifest.v5"
  printf 'launcher_url=https://app.install.doctor/releases/%s/start\n' "$release_id"
  printf 'launcher_sha256=%s\n' "$launcher_sha256"
  printf 'launcher_size=%s\n' "$launcher_size"
} > "$stage/manifest"
rm -f "$stage/manifest.v5"
chmod 0600 "$stage/manifest" "$stage"/node-*.tar.gz
chmod 0700 "$stage/provision.sh" "$stage/install-doctor-engine.mjs"
ssh-keygen -Y sign -f "$signing_key" -n install.doctor.release "$stage/manifest" >/dev/null 2>&1 \
  || { printf 'SSHSIG signing failed\n' >&2; exit 69; }
[ -f "$stage/manifest.sig" ] && [ ! -L "$stage/manifest.sig" ] || { printf 'signer did not produce a regular detached signature\n' >&2; exit 69; }
signature_size="$(size "$stage/manifest.sig")"
[ "$signature_size" -gt 0 ] && [ "$signature_size" -le "$MAX_SIGNATURE_BYTES" ] || { printf 'signature size is outside policy\n' >&2; exit 69; }
chmod 0600 "$stage/manifest.sig"
mv "$stage" "$output_dir"; chmod 0700 "$output_dir"
trap - EXIT HUP INT TERM
printf 'signed release %s created at %s\n' "$release_id" "$output_dir"
