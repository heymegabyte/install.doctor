#!/usr/bin/env bash
# Validate and sign an inert Desktop Tools v7 or v8 release. This boundary performs no build or network work.
set -euo pipefail
umask 077
export LC_ALL=C

[ "$#" -eq 4 ] || { printf 'usage: %s SIGNER_ID ED25519_KEY UNSIGNED_DIRECTORY SIGNED_DIRECTORY\n' "$0" >&2; exit 64; }
signer_id="$1"; signing_key="$2"; unsigned_dir="$3"; output_dir="$4"
case "$signer_id" in desktop-*) ;; *) printf 'invalid Desktop Tools signer identity\n' >&2; exit 65 ;; esac
signer_suffix="${signer_id#desktop-}"
case "$signer_suffix" in ''|[!a-z0-9]*|*[!a-z0-9._-]*) printf 'invalid Desktop Tools signer identity\n' >&2; exit 65 ;; esac
[ "${#signer_id}" -le 128 ] || { printf 'signer identity is oversized\n' >&2; exit 65; }

size() { wc -c < "$1" | tr -d '[:space:]'; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
value() { awk -F= -v key="$1" '$1 == key { count++; sub(/^[^=]*=/, ""); found=$0 } END { if (count == 1) print found; else exit 1 }' "$manifest"; }
mode() { if stat -c '%a' "$1" >/dev/null 2>&1; then stat -c '%a' "$1"; else stat -f '%Lp' "$1"; fi; }

[ -d "$unsigned_dir" ] && [ ! -L "$unsigned_dir" ] || { printf 'unsigned release is not a real directory\n' >&2; exit 66; }
expected_v7='THIRD_PARTY_LICENSES.txt catalog.json desktop-tools-engine.mjs desktop-tools-supervisor.mjs desktop-tools-tools.tar.gz manifest node-linux-arm64.tar.gz node-linux-x64.tar.gz node-macos-arm64.tar.gz node-macos-x64.tar.gz opencode-linux-arm64.tar.gz opencode-linux-x64.tar.gz opencode-macos-arm64.zip opencode-macos-x64.zip opencode.lock.json provision.sh release.provenance.json release.sbom.json start'
expected_v8='THIRD_PARTY_LICENSES.txt catalog.json debian-bookworm-archive-keyring.gpg debian-bookworm-inrelease debian-bookworm-main-amd64-Packages.xz desktop-tools-engine.mjs desktop-tools-supervisor.mjs desktop-tools-tools.tar.gz manifest node-linux-arm64.tar.gz node-linux-x64.tar.gz node-macos-arm64.tar.gz node-macos-x64.tar.gz opencode-linux-arm64.tar.gz opencode-linux-x64.tar.gz opencode-macos-arm64.zip opencode-macos-x64.zip opencode.lock.json provision.sh release.provenance.json release.sbom.json start tree_2.1.0-1_amd64.deb'
manifest="$unsigned_dir/manifest"
[ -f "$manifest" ] && [ ! -L "$manifest" ] || { printf 'manifest is unsafe\n' >&2; exit 66; }
schema_version="$(value schema_version)" || { printf 'manifest schema is malformed\n' >&2; exit 65; }
case "$schema_version" in
  7) expected="$expected_v7"; expected_lines=64 ;;
  8) expected="$expected_v8"; expected_lines=76 ;;
  *) printf 'manifest schema is unsupported\n' >&2; exit 65 ;;
esac
actual="$(find "$unsigned_dir" -mindepth 1 -maxdepth 1 -print | sed 's#^.*/##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"
[ "$actual" = "$expected" ] || { printf 'unsigned release does not match the exact allowlist\n' >&2; exit 65; }
for name in $expected; do
  path="$unsigned_dir/$name"
  [ -f "$path" ] && [ ! -L "$path" ] && [ "$(find "$path" -links +1 -print | wc -l | tr -d '[:space:]')" -eq 0 ] \
    || { printf 'unsafe unsigned artifact: %s\n' "$name" >&2; exit 66; }
done
[ "$(size "$manifest")" -le 16384 ] && [ "$(wc -l < "$manifest" | tr -d '[:space:]')" -eq "$expected_lines" ] \
  || { printf 'Desktop Tools manifest size or key count is invalid\n' >&2; exit 65; }
[ "$(value product_id)" = desktop-tools ] || { printf 'manifest is not Desktop Tools schema v%s\n' "$schema_version" >&2; exit 65; }
[ "$(value key_id)" = "$signer_id" ] || { printf 'manifest signer identity mismatch\n' >&2; exit 65; }
release_id="$(value release_id)"; case "$release_id" in ''|[!a-z0-9]*|*[!a-z0-9._-]*) printf 'invalid release identifier\n' >&2; exit 65 ;; esac
created="$(value created_at)"; expires="$(value expires_at)"; now="$(date -u +%s)"
case "$created:$expires" in *[!0-9:]*|:|*:) printf 'invalid release validity window\n' >&2; exit 65 ;; esac
[ "$created" -le "$((now + 300))" ] && [ "$expires" -gt "$now" ] && [ "$created" -lt "$expires" ] && [ "$((expires-created))" -le 604800 ] \
  || { printf 'release validity window is not current and bounded\n' >&2; exit 65; }
[ "$(value engine_node_min)" = 22 ] || { printf 'unsupported engine runtime\n' >&2; exit 65; }
[[ "$(value runtime_node_version)" =~ ^24\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
  || { printf 'unsupported bundled runtime\n' >&2; exit 65; }
opencode_version="$(value opencode_version)"
[[ "$opencode_version" =~ ^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]] \
  || { printf 'invalid pinned OpenCode version\n' >&2; exit 65; }
validate() {
  prefix="$1"; filename="$2"; maximum="$3"; path="$unsigned_dir/$filename"
  [ "$(value "${prefix}_url")" = "https://desktop.tools/releases/$release_id/$filename" ] \
    && [ "$(value "${prefix}_size")" = "$(size "$path")" ] && [ "$(size "$path")" -le "$maximum" ] \
    && [ "$(value "${prefix}_sha256")" = "$(sha256 "$path")" ] \
    || { printf 'manifest binding mismatch: %s\n' "$filename" >&2; exit 65; }
}
validate artifact provision.sh 8388608
validate engine desktop-tools-engine.mjs 8388608
validate catalog catalog.json 8388608
validate launcher start 8388608
for platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do validate "runtime_${platform//-/_}" "node-$platform.tar.gz" 100663296; done
for platform in macos-x64 macos-arm64; do validate "opencode_${platform//-/_}" "opencode-$platform.zip" 167772160; done
for platform in linux-x64 linux-arm64; do validate "opencode_${platform//-/_}" "opencode-$platform.tar.gz" 167772160; done
validate supervisor desktop-tools-supervisor.mjs 8388608
validate tools desktop-tools-tools.tar.gz 33554432
validate opencode_lock opencode.lock.json 8388608
validate sbom release.sbom.json 8388608
validate provenance release.provenance.json 8388608
validate licenses THIRD_PARTY_LICENSES.txt 8388608
if [ "$schema_version" = 8 ]; then
  validate debian_inrelease debian-bookworm-inrelease 16777216
  validate debian_keyring debian-bookworm-archive-keyring.gpg 16777216
  validate debian_packages debian-bookworm-main-amd64-Packages.xz 268435456
  validate debian_tree tree_2.1.0-1_amd64.deb 268435456
fi

[ -f "$signing_key" ] && [ ! -L "$signing_key" ] || { printf 'signing key is unsafe\n' >&2; exit 66; }
key_mode=$((8#$(mode "$signing_key"))); (( (key_mode & 077) == 0 )) || { printf 'signing key permissions are too broad\n' >&2; exit 77; }
public_key="$(ssh-keygen -y -f "$signing_key" 2>/dev/null)" || { printf 'signing key is unreadable\n' >&2; exit 69; }
case "$public_key" in 'ssh-ed25519 '*) ;; *) printf 'signing key must be Ed25519\n' >&2; exit 69 ;; esac
launcher_key="$(sed -n "s/^readonly SIGNER_KEY='\(ssh-ed25519 [^']*\)'$/\1/p" "$unsigned_dir/start")"
[ "$(printf '%s\n' "$launcher_key" | awk '{print $1, $2}')" = "$(printf '%s\n' "$public_key" | awk '{print $1, $2}')" ] \
  || { printf 'launcher trust root does not match the signing key\n' >&2; exit 65; }

parent="$(dirname "$output_dir")"; [ -d "$parent" ] && [ ! -L "$parent" ] || { printf 'signed output parent is unsafe\n' >&2; exit 73; }
[ ! -e "$output_dir" ] && [ ! -L "$output_dir" ] || { printf 'refusing to overwrite signed output\n' >&2; exit 73; }
stage="$(mktemp -d "$parent/.desktop-tools-signed.XXXXXXXX")"; chmod 0700 "$stage"
cleanup() { rm -rf -- "$stage"; }; trap cleanup EXIT HUP INT TERM
for name in $expected; do cp "$unsigned_dir/$name" "$stage/$name"; done
ssh-keygen -Y sign -q -f "$signing_key" -n desktop.tools.release "$stage/manifest"
printf '%s %s\n' "$signer_id" "$public_key" > "$stage/allowed-signers"
ssh-keygen -Y verify -f "$stage/allowed-signers" -I "$signer_id" -n desktop.tools.release -s "$stage/manifest.sig" < "$stage/manifest" >/dev/null
rm -f "$stage/allowed-signers"; [ "$(size "$stage/manifest.sig")" -le 8192 ] || { printf 'signature is oversized\n' >&2; exit 69; }
for name in $expected; do chmod 0600 "$stage/$name"; done
chmod 0600 "$stage/manifest.sig"
chmod 0700 "$stage/provision.sh" "$stage/desktop-tools-engine.mjs" "$stage/desktop-tools-supervisor.mjs" "$stage/start"
mv "$stage" "$output_dir"; trap - EXIT HUP INT TERM
printf 'signed Desktop Tools release %s created at %s\n' "$release_id" "$output_dir"
