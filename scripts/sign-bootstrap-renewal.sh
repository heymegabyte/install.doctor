#!/usr/bin/env bash
# Authenticate an approved release and sign only a byte-identical payload renewal.
set -euo pipefail
umask 077
export LC_ALL=C

usage() { printf 'usage: %s SIGNER_ID SIGNING_KEY RENEWAL_BUNDLE SIGNED_RELEASE SIGNED_PLAN_SIGNATURE\n' "$0" >&2; exit 64; }
[ "$#" -eq 5 ] || usage
signer_id="$1"; signing_key="$2"; input_bundle="$3"; output_dir="$4"; plan_signature_output="$5"
case "$signer_id" in ''|[!a-z0-9]*|*[!a-z0-9._-]*) printf 'invalid signer identifier\n' >&2; exit 65 ;; esac
[ "${#signer_id}" -le 128 ] || { printf 'invalid signer identifier\n' >&2; exit 65; }

mode() { if stat -f '%Lp' "$1" >/dev/null 2>&1; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi; }
owner() { if stat -f '%u' "$1" >/dev/null 2>&1; then stat -f '%u' "$1"; else stat -c '%u' "$1"; fi; }
size() { wc -c < "$1" | tr -d '[:space:]'; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
fail() { printf 'renewal signer rejected bundle: %s\n' "$1" >&2; exit 65; }
value() {
  local manifest_path="$1" key="$2" count
  count="$(awk -F= -v key="$key" '$1 == key { count++ } END { print count + 0 }' "$manifest_path")"
  [ "$count" -eq 1 ] || fail "manifest key is missing or duplicated: $key"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print }' "$manifest_path"
}
utc_day() {
  if [ "$(uname -s)" = Darwin ]; then date -u -r "$1" +%Y%m%d; else date -u -d "@$1" +%Y%m%d; fi
}

for dependency in ssh-keygen jq awk cmp find uname; do command -v "$dependency" >/dev/null 2>&1 || { printf '%s is required\n' "$dependency" >&2; exit 69; }; done
[ -d "$input_bundle" ] && [ ! -L "$input_bundle" ] || fail 'bundle is not a real directory'
[ "$(owner "$input_bundle")" -eq "$(id -u)" ] || fail 'bundle has the wrong owner'
input_mode=$((8#$(mode "$input_bundle"))); (( (input_mode & 022) == 0 )) || fail 'bundle is writable by another user class'
actual="$(find "$input_bundle" -mindepth 1 -maxdepth 1 -print | sed 's#^.*/##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"
[ "$actual" = 'renewal-plan.json source unsigned' ] || fail 'bundle does not match the exact allowlist'

# Snapshot exact named inputs into signer-owned storage. Every subsequent check and
# the final signature use this immutable-to-the-caller view, closing pathname races.
snapshot="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-renewal.XXXXXXXX")"; chmod 0700 "$snapshot"
allowed_signers="$snapshot/allowed_signers"
cleanup() { rm -rf -- "$snapshot"; }
trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
mkdir -m 0700 "$snapshot/source" "$snapshot/unsigned"
source_expected='catalog.json install-doctor-engine.mjs manifest manifest.sig node-linux-arm64.tar.gz node-linux-x64.tar.gz node-macos-arm64.tar.gz node-macos-x64.tar.gz provision.sh start'
target_expected='catalog.json install-doctor-engine.mjs manifest node-linux-arm64.tar.gz node-linux-x64.tar.gz node-macos-arm64.tar.gz node-macos-x64.tar.gz provision.sh start'
cp "$input_bundle/renewal-plan.json" "$snapshot/renewal-plan.json"
for name in $source_expected; do cp "$input_bundle/source/$name" "$snapshot/source/$name"; done
for name in $target_expected; do cp "$input_bundle/unsigned/$name" "$snapshot/unsigned/$name"; done
chmod 0600 "$snapshot/renewal-plan.json" "$snapshot/source"/* "$snapshot/unsigned"/*
chmod 0700 "$snapshot/source/provision.sh" "$snapshot/source/install-doctor-engine.mjs" "$snapshot/source/start" "$snapshot/unsigned/provision.sh" "$snapshot/unsigned/install-doctor-engine.mjs" "$snapshot/unsigned/start"
source_dir="$snapshot/source"; unsigned_dir="$snapshot/unsigned"; plan="$snapshot/renewal-plan.json"
for tuple in "$source_dir|$source_expected" "$unsigned_dir|$target_expected"; do
  directory="${tuple%%|*}"; expected="${tuple#*|}"
  inventory="$(find "$directory" -mindepth 1 -maxdepth 1 -print | sed 's#^.*/##' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')"
  [ "$inventory" = "$expected" ] || fail 'snapshotted inventory does not match its allowlist'
done
[ "$(size "$plan")" -le 16384 ] || fail 'renewal plan is oversized'
[ "$(size "$source_dir/manifest")" -le 16384 ] && [ "$(size "$unsigned_dir/manifest")" -le 16384 ] || fail 'manifest is oversized'
[ "$(size "$source_dir/manifest.sig")" -le 8192 ] || fail 'source signature is oversized'

[ -f "$signing_key" ] && [ ! -L "$signing_key" ] || fail 'signing key is not a regular file'
key_mode=$((8#$(mode "$signing_key"))); (( (key_mode & 077) == 0 )) || fail 'signing key is accessible by group or other users'
[ "$(owner "$signing_key")" -eq "$(id -u)" ] || fail 'signing key has the wrong owner'
public_key="$(ssh-keygen -y -f "$signing_key" 2>/dev/null)" || { printf 'signing key is unreadable\n' >&2; exit 69; }
case "$public_key" in 'ssh-ed25519 '*) ;; *) printf 'signing key must use Ed25519\n' >&2; exit 69 ;; esac
printf '%s %s\n' "$signer_id" "$public_key" > "$allowed_signers"
ssh-keygen -Y verify -f "$allowed_signers" -I "$signer_id" -n install.doctor.release -s "$source_dir/manifest.sig" < "$source_dir/manifest" >/dev/null 2>&1 || fail 'source SSH signature is invalid'

source_manifest="$source_dir/manifest"; target_manifest="$unsigned_dir/manifest"
[ "$(wc -l < "$source_manifest" | tr -d '[:space:]')" -eq 32 ] && [ "$(wc -l < "$target_manifest" | tr -d '[:space:]')" -eq 32 ] || fail 'manifest key count is invalid'
allowed='release_id created_at expires_at artifact_url engine_url catalog_url launcher_url launcher_sha256 launcher_size runtime_macos_x64_url runtime_macos_arm64_url runtime_linux_x64_url runtime_linux_arm64_url'
# value() only reopens these manifests for reads; it never writes either input.
# shellcheck disable=SC2094
while IFS= read -r source_line; do
  key="${source_line%%=*}"; [ "$key" != "$source_line" ] || fail 'source manifest contains a malformed line'
  source_value="$(value "$source_manifest" "$key")"; target_value="$(value "$target_manifest" "$key")"
  case " $allowed " in *" $key "*) ;; *) [ "$source_value" = "$target_value" ] || fail "invariant manifest field changed: $key" ;; esac
done < "$source_manifest"
while IFS= read -r target_line; do key="${target_line%%=*}"; value "$source_manifest" "$key" >/dev/null; done < "$target_manifest"

payloads='provision.sh install-doctor-engine.mjs catalog.json node-macos-x64.tar.gz node-macos-arm64.tar.gz node-linux-x64.tar.gz node-linux-arm64.tar.gz'
for name in $payloads; do cmp -s "$source_dir/$name" "$unsigned_dir/$name" || fail "payload bytes changed: $name"; done
source_digest="$(sha256 "$source_manifest")"; source_id="$(value "$source_manifest" release_id)"; target_id="$(value "$target_manifest" release_id)"
created="$(value "$target_manifest" created_at)"; expires="$(value "$target_manifest" expires_at)"
case "$created:$expires" in *[!0-9:]*|:|*:) fail 'target validity window is invalid' ;; esac
[ "$created" -gt 0 ] && [ "$((created % 86400))" -eq 0 ] && [ "$expires" -eq "$((created + 604800))" ] || fail 'target validity window is not the canonical seven-day UTC window'
expected_id="renew-v1-$(utc_day "$created")-${source_digest:0:16}"
[ "$target_id" = "$expected_id" ] && [ "$target_id" != "$source_id" ] || fail 'target renewal identity is not derived from the signed source'
[ "$(value "$target_manifest" schema_version)" = 5 ] && [ "$(value "$target_manifest" key_id)" = "$signer_id" ] || fail 'target schema or signer identity is invalid'
[ "$(value "$target_manifest" engine_node_min)" = 22 ] || fail 'target engine contract is invalid'
case "$(value "$target_manifest" runtime_node_version)" in 24.[0-9]*.[0-9]*) ;; *) fail 'target runtime contract is invalid' ;; esac
validate_payload() {
  local prefix="$1" filename="$2" maximum="$3" path="$unsigned_dir/$2" declared_size
  [ "$(value "$target_manifest" "${prefix}_url")" = "https://app.install.doctor/releases/$target_id/$filename" ] || fail "target URL mismatch: $filename"
  declared_size="$(value "$target_manifest" "${prefix}_size")"
  [ "$declared_size" = "$(size "$path")" ] && [ "$declared_size" -gt 0 ] && [ "$declared_size" -le "$maximum" ] || fail "target size mismatch: $filename"
  [ "$(value "$target_manifest" "${prefix}_sha256")" = "$(sha256 "$path")" ] || fail "target digest mismatch: $filename"
}
validate_payload artifact provision.sh 8388608; validate_payload engine install-doctor-engine.mjs 8388608; validate_payload catalog catalog.json 8388608
for platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do validate_payload "runtime_${platform//-/_}" "node-$platform.tar.gz" 100663296; done
validate_payload launcher start 8388608
[ "$(grep -Fxc "readonly SIGNER_KEY='$public_key'" "$unsigned_dir/start")" -eq 1 ] || fail 'target launcher signer key is invalid'
[ "$(grep -Fxc "readonly EXPECTED_RELEASE_ID='$target_id'" "$unsigned_dir/start")" -eq 1 ] || fail 'target launcher release identity is invalid'

jq -e --arg sourceId "$source_id" --arg targetId "$target_id" --arg sourceDigest "$source_digest" --arg sourceCommit "$(value "$source_manifest" source_commit)" --argjson created "$created" --argjson expires "$expires" '
  type == "object" and ([keys[]] == ["channel","createdAt","expiresAt","payloads","releaseId","schemaVersion","sourceActivationId","sourceCommit","sourceEtag","sourceGeneration","sourceManifestSha256","sourceReleaseId"]) and
  .schemaVersion == 1 and .channel == "stable" and (.sourceActivationId | test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) and
  (.sourceGeneration | type == "number" and . >= 1 and . <= 9007199254740991 and floor == .) and (.sourceEtag | type == "string" and length > 0 and length <= 512) and
  .sourceReleaseId == $sourceId and .sourceManifestSha256 == $sourceDigest and .sourceCommit == $sourceCommit and .releaseId == $targetId and .createdAt == $created and .expiresAt == $expires and
  (.payloads | type == "array" and length == 7 and all(.[]; ([keys[]] == ["filename","sha256","size"])))
' "$plan" >/dev/null || fail 'renewal plan does not strictly bind the source and target'
for name in $payloads; do
  jq -e --arg name "$name" --arg digest "$(sha256 "$source_dir/$name")" --argjson bytes "$(size "$source_dir/$name")" '[.payloads[] | select(.filename == $name and .sha256 == $digest and .size == $bytes)] | length == 1' "$plan" >/dev/null || fail "renewal plan payload binding is invalid: $name"
done

parent="$(dirname "$output_dir")"
[ -d "$parent" ] && [ ! -L "$parent" ] && [ "$(owner "$parent")" -eq "$(id -u)" ] || fail 'signed release parent is unsafe'
parent_mode=$((8#$(mode "$parent"))); (( (parent_mode & 022) == 0 )) || fail 'signed release parent is writable by another user class'
[ ! -e "$output_dir" ] && [ ! -L "$output_dir" ] || fail 'refusing to overwrite signed release directory'
[ "$(dirname "$plan_signature_output")" = "$parent" ] || fail 'signed plan signature must share the protected output parent'
[ ! -e "$plan_signature_output" ] && [ ! -L "$plan_signature_output" ] || fail 'refusing to overwrite signed plan signature'
signed_stage="$(mktemp -d "$parent/.bootstrap-renewed.XXXXXXXX")"; chmod 0700 "$signed_stage"
for name in $target_expected; do cp "$unsigned_dir/$name" "$signed_stage/$name"; done
chmod 0600 "$signed_stage/manifest" "$signed_stage"/node-*.tar.gz; chmod 0700 "$signed_stage/provision.sh" "$signed_stage/install-doctor-engine.mjs" "$signed_stage/start"
ssh-keygen -Y sign -f "$signing_key" -n install.doctor.release "$signed_stage/manifest" >/dev/null 2>&1 || { printf 'SSHSIG signing failed\n' >&2; exit 69; }
ssh-keygen -Y sign -f "$signing_key" -n install.doctor.release-renewal-plan "$plan" >/dev/null 2>&1 || { printf 'renewal plan SSHSIG signing failed\n' >&2; exit 69; }
chmod 0600 "$signed_stage/manifest.sig" "$plan.sig"
mv "$plan.sig" "$plan_signature_output"
mv "$signed_stage" "$output_dir"; chmod 0700 "$output_dir"
printf 'signed same-payload renewal %s at %s\n' "$target_id" "$output_dir"
trap - EXIT HUP INT TERM; cleanup
