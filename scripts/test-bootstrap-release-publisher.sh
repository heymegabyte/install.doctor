#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-release-test.XXXXXXXX")"
cleanup() { rm -rf -- "$FIXTURE"; }
trap cleanup EXIT HUP INT TERM

passes=0
pass() {
  passes=$((passes + 1))
}
rejects() {
  label="$1"
  shift
  if "$@" >"$FIXTURE/rejected.stdout" 2>"$FIXTURE/rejected.stderr"; then
    printf 'FAIL publisher accepted %s\n' "$label" >&2
    exit 1
  fi
  pass
}
rejects_tampered_signature() {
  if ssh-keygen -Y verify -f "$FIXTURE/allowed_signers" -I test-signer -n install.doctor.release -s "$out/manifest.sig" < "$FIXTURE/tampered" >/dev/null 2>&1; then
    printf 'FAIL publisher signature verified a tampered manifest\n' >&2
    exit 1
  fi
  pass
}
mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

builder="$ROOT/scripts/publish-bootstrap-release.sh"
signer="$ROOT/scripts/sign-bootstrap-release.sh"
publisher="$FIXTURE/test-only-build-and-sign"
export INSTALL_DOCTOR_TEST_BUILDER="$builder" INSTALL_DOCTOR_TEST_SIGNER="$signer"
cat > "$publisher" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 8 ] || [ "$#" -eq 9 ] || exit 64
release_id="$1"; source_commit="$2"; created="$3"; expires="$4"; signer_id="$5"; key="$6"; provisioner="$7"
if [ "$#" -eq 9 ]; then engine="$8"; output="$9"; else engine=""; output="$8"; fi
unsigned="$output.unsigned"
if [ -n "$engine" ]; then
  bash "$INSTALL_DOCTOR_TEST_BUILDER" "$release_id" "$source_commit" "$created" "$expires" "$signer_id" - "$provisioner" "$engine" "$unsigned"
else
  bash "$INSTALL_DOCTOR_TEST_BUILDER" "$release_id" "$source_commit" "$created" "$expires" "$signer_id" - "$provisioner" "$unsigned"
fi
bash "$INSTALL_DOCTOR_TEST_SIGNER" "$signer_id" "$key" "$unsigned" "$output"
SH
chmod 0700 "$publisher"
key="$FIXTURE/release-key"
provisioner="$FIXTURE/provision.sh"
engine="$FIXTURE/install-doctor-engine.mjs"
runtime_dir="$FIXTURE/node-runtimes"
runtime_version=24.11.0
out_parent="$FIXTURE/releases"
out="$out_parent/test-release"
created="$(date -u +%s)"
expires="$((created + 3600))"
mkdir -m 0700 "$out_parent"
mkdir -m 0700 "$runtime_dir" "$FIXTURE/bin"
printf '#!/usr/bin/env bash\nprintf "fixture provisioner\\n"\n' > "$provisioner"
chmod 0700 "$provisioner"
printf '#!/usr/bin/env node\nprocess.stdout.write("fixture engine\\n")\n' > "$engine"
chmod 0700 "$engine"
mkdir -p "$FIXTURE/packages/aid-core" "$FIXTURE/packages/installer-engine" "$FIXTURE/packages/control-plane/src"
printf '[]\n' > "$FIXTURE/packages/control-plane/src/catalog.json"
cat > "$FIXTURE/packages/aid-core/package.json" <<'JSON'
{"name":"fixture-aid-core","version":"1.0.0","private":true,"scripts":{"build":"mkdir -p dist"}}
JSON
cat > "$FIXTURE/packages/installer-engine/package.json" <<'JSON'
{"name":"fixture-installer-engine","version":"1.0.0","private":true,"scripts":{"build":"npm --prefix ../aid-core run build","bundle":"npm run build && mkdir -p dist && cp ../../install-doctor-engine.mjs dist/install-doctor-engine.mjs"}}
JSON
for package_dir in aid-core installer-engine; do
  package_name="fixture-${package_dir}"
  cat > "$FIXTURE/packages/$package_dir/package-lock.json" <<JSON
{"name":"$package_name","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"$package_name","version":"1.0.0"}}}
JSON
done
git -C "$FIXTURE" init -q
git -C "$FIXTURE" config user.name 'Install Doctor Test'
git -C "$FIXTURE" config user.email 'install-doctor-test@example.invalid'
git -C "$FIXTURE" add provision.sh install-doctor-engine.mjs packages
git -C "$FIXTURE" commit -qm 'fixture release artifacts'
commit="$(git -C "$FIXTURE" rev-parse HEAD)"
ssh-keygen -q -t ed25519 -N '' -C test-only -f "$key"

runtime_shasums="$FIXTURE/SHASUMS256.txt"
runtime_signature="$FIXTURE/SHASUMS256.txt.sig"
runtime_keyring="$FIXTURE/node-release-keyring.gpg"
for runtime_platform in darwin-x64 darwin-arm64 linux-x64 linux-arm64; do
  printf 'fixture runtime %s\n' "$runtime_platform" > "$runtime_dir/node-v$runtime_version-$runtime_platform.tar.gz"
  shasum -a 256 "$runtime_dir/node-v$runtime_version-$runtime_platform.tar.gz" | awk '{print $1 "  " name}' name="node-v$runtime_version-$runtime_platform.tar.gz" >> "$runtime_shasums"
done
printf 'fixture detached signature\n' > "$runtime_signature"
printf 'fixture pinned keyring\n' > "$runtime_keyring"
cat > "$FIXTURE/bin/gpgv" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod 0700 "$FIXTURE/bin/gpgv"
export PATH="$FIXTURE/bin:$PATH"
export INSTALL_DOCTOR_RUNTIME_NODE_VERSION="$runtime_version"
export INSTALL_DOCTOR_RUNTIME_DIR="$runtime_dir"
export INSTALL_DOCTOR_NODE_SHASUMS="$runtime_shasums"
export INSTALL_DOCTOR_NODE_SHASUMS_SIGNATURE="$runtime_signature"
export INSTALL_DOCTOR_NODE_RELEASE_KEYRING="$runtime_keyring"

bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out"

test -f "$out/manifest"
test -f "$out/manifest.sig"
test -x "$out/provision.sh"
test -x "$out/install-doctor-engine.mjs"
test -f "$out/catalog.json"
for platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do test -f "$out/node-$platform.tar.gz"; done
test "$(mode "$out")" = 700
test "$(mode "$out/manifest")" = 600
test "$(mode "$out/manifest.sig")" = 600
test "$(mode "$out/provision.sh")" = 700
test "$(mode "$out/install-doctor-engine.mjs")" = 700
test "$(mode "$out/catalog.json")" = 600
for platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do test "$(mode "$out/node-$platform.tar.gz")" = 600; done
pass

rejects 'a private key passed to the repository-controlled builder' bash "$builder" \
  builder-key-rejected "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/builder-key-rejected"

isolation_bin="$FIXTURE/signer-isolation-bin"
isolation_marker="$FIXTURE/signer-ran-build-tool"
mkdir -m 0700 "$isolation_bin"
for forbidden_tool in git npm; do
  cat > "$isolation_bin/$forbidden_tool" <<SH
#!/usr/bin/env bash
: > "$isolation_marker"
exit 99
SH
  chmod 0700 "$isolation_bin/$forbidden_tool"
done
PATH="$isolation_bin:$PATH" bash "$signer" test-signer "$key" "$out.unsigned" "$out_parent/signer-isolation"
[ ! -e "$isolation_marker" ]
test -f "$out_parent/signer-isolation/manifest.sig"
pass

printf 'test-signer %s\n' "$(cat "$key.pub")" > "$FIXTURE/allowed_signers"
ssh-keygen -Y verify -f "$FIXTURE/allowed_signers" -I test-signer -n install.doctor.release -s "$out/manifest.sig" < "$out/manifest" >/dev/null
grep -qx 'schema_version=5' "$out/manifest"
test -x "$out/start"
grep -qx "launcher_url=https://app.install.doctor/releases/test-release/start" "$out/manifest"
grep -qx "launcher_sha256=$(shasum -a 256 "$out/start" | awk '{print $1}')" "$out/manifest"
grep -qx "catalog_url=https://app.install.doctor/releases/test-release/catalog.json" "$out/manifest"
grep -qx "source_commit=$commit" "$out/manifest"
grep -qx "artifact_size=$(wc -c < "$provisioner" | tr -d '[:space:]')" "$out/manifest"
grep -qx "engine_size=$(wc -c < "$engine" | tr -d '[:space:]')" "$out/manifest"
grep -qx 'engine_node_min=22' "$out/manifest"
grep -qx 'runtime_node_version=24.11.0' "$out/manifest"
for platform in macos_x64 macos_arm64 linux_x64 linux_arm64; do
  grep -qx "runtime_${platform}_url=https://app.install.doctor/releases/test-release/node-${platform//_/-}.tar.gz" "$out/manifest"
done
pass

second="$out_parent/test-release-copy"
bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$second" >/dev/null
cmp "$out/manifest" "$second/manifest"
cmp "$out/manifest.sig" "$second/manifest.sig"
cmp "$out/provision.sh" "$second/provision.sh"
cmp "$out/install-doctor-engine.mjs" "$second/install-doctor-engine.mjs"
for platform in macos-x64 macos-arm64 linux-x64 linux-arm64; do cmp "$out/node-$platform.tar.gz" "$second/node-$platform.tar.gz"; done
pass

git -C "$FIXTURE" rm -q packages/aid-core/package-lock.json
git -C "$FIXTURE" commit -qm 'remove an engine build lockfile'
missing_lock_commit="$(git -C "$FIXTURE" rev-parse HEAD)"
rejects 'a source commit without the complete locked engine build' bash "$publisher" missing-lock "$missing_lock_commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/missing-lock"

cp "$out/manifest" "$FIXTURE/tampered"
printf 'unexpected=field\n' >> "$FIXTURE/tampered"
rejects_tampered_signature

rejects 'an existing immutable release' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out"
rejects 'a missing engine artifact' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$FIXTURE/missing-engine.mjs" "$out_parent/missing-engine"
rejects 'missing pinned Node provenance' env -u INSTALL_DOCTOR_NODE_SHASUMS bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/missing-runtime-provenance"
runtime_tamper="$runtime_dir/node-v$runtime_version-linux-x64.tar.gz"
cp "$runtime_tamper" "$FIXTURE/runtime.original"
printf 'tamper\n' >> "$runtime_tamper"
rejects 'a runtime artifact outside pinned Node SHASUMS' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/tampered-runtime"
mv "$FIXTURE/runtime.original" "$runtime_tamper"
rejects 'a noncanonical release identifier' bash "$publisher" 'bad:release' "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/bad-release"
rejects 'an uppercase release identifier' bash "$publisher" 'Bad-release' "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/uppercase-release"
long_id="$(printf '%0129d' 0)"
rejects 'an overlong release identifier' bash "$publisher" "a${long_id#?}" "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/long-release"
rejects 'a noncanonical signer identifier' bash "$publisher" test-release "$commit" "$created" "$expires" 'bad:signer' "$key" "$provisioner" "$out_parent/bad-signer"
rejects 'an overlong signer identifier' bash "$publisher" test-release "$commit" "$created" "$expires" "a${long_id#?}" "$key" "$provisioner" "$out_parent/long-signer"
rejects 'an uppercase source commit' bash "$publisher" test-release '0123456789ABCDEF0123456789abcdef01234567' "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/bad-commit"
cp "$provisioner" "$FIXTURE/provisioner.original"
printf '# uncommitted mutation\n' >> "$provisioner"
rejects 'provisioner bytes outside source_commit' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/uncommitted-provisioner"
mv "$FIXTURE/provisioner.original" "$provisioner"
cp "$engine" "$FIXTURE/engine.original"
printf '// uncommitted mutation\n' >> "$engine"
rejects 'engine bytes outside the reproducible source_commit build' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/uncommitted-engine"
mv "$FIXTURE/engine.original" "$engine"
rejects 'a leading-zero timestamp' bash "$publisher" test-release "$commit" "0$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/bad-created"
rejects 'an expiry before creation' bash "$publisher" test-release "$commit" "$created" "$created" test-signer "$key" "$provisioner" "$out_parent/bad-expiry"
rejects 'an out-of-policy timestamp' bash "$publisher" test-release "$commit" "$created" 4102444801 test-signer "$key" "$provisioner" "$out_parent/far-expiry"
rejects 'an expired release window' bash "$publisher" test-release "$commit" 1 2 test-signer "$key" "$provisioner" "$out_parent/expired"
rejects 'an overlong release window' bash "$publisher" test-release "$commit" "$created" "$((created + 604801))" test-signer "$key" "$provisioner" "$out_parent/long-window"

weak_key="$FIXTURE/weak-key"
cp "$key" "$weak_key"
chmod 0644 "$weak_key"
rejects 'a group/world-readable signing key' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$weak_key" "$provisioner" "$out_parent/weak-key"

invalid_key="$FIXTURE/invalid-key"
printf 'not a private key\n' > "$invalid_key"
chmod 0600 "$invalid_key"
rejects 'a malformed signing key' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$invalid_key" "$provisioner" "$out_parent/invalid-key"

rsa_key="$FIXTURE/rsa-key"
ssh-keygen -q -t rsa -b 2048 -N '' -C test-only -f "$rsa_key"
rejects 'a non-Ed25519 signing key' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$rsa_key" "$provisioner" "$out_parent/rsa-key"

empty="$FIXTURE/empty.sh"
: > "$empty"
chmod 0700 "$empty"
rejects 'an empty provisioner' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$empty" "$out_parent/empty"

oversized="$FIXTURE/oversized.sh"
dd if=/dev/zero of="$oversized" bs=1 count=0 seek=8388609 2>/dev/null
chmod 0700 "$oversized"
rejects 'an oversized provisioner' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$oversized" "$out_parent/oversized"

ln -s "$FIXTURE/missing-release" "$out_parent/dangling-release"
rejects 'a dangling output symlink' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/dangling-release"

real_parent="$FIXTURE/real-parent"
mkdir -m 0700 "$real_parent"
ln -s "$real_parent" "$FIXTURE/symlink-parent"
rejects 'a symlink release parent' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$FIXTURE/symlink-parent/release"

unsafe_parent="$FIXTURE/unsafe-parent"
mkdir -m 0777 "$unsafe_parent"
chmod 0777 "$unsafe_parent"
rejects 'a group/world-writable release parent' bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$unsafe_parent/release"

mkdir "$FIXTURE/no-tools"
rejects 'a host without SSHSIG support' env PATH="$FIXTURE/no-tools" /bin/bash "$publisher" test-release "$commit" "$created" "$expires" test-signer "$key" "$provisioner" "$out_parent/no-verifier"

renewal_signer="$ROOT/scripts/sign-bootstrap-renewal.sh"
renewal_bundle="$FIXTURE/renewal-bundle"
mkdir -m 0700 "$renewal_bundle" "$renewal_bundle/source" "$renewal_bundle/unsigned"
for name in catalog.json install-doctor-engine.mjs manifest manifest.sig node-linux-arm64.tar.gz node-linux-x64.tar.gz node-macos-arm64.tar.gz node-macos-x64.tar.gz provision.sh start; do
  cp "$out/$name" "$renewal_bundle/source/$name"
done
source_manifest_sha="$(shasum -a 256 "$out/manifest" | awk '{print $1}')"
renew_created="$((created - created % 86400))"
renew_expires="$((renew_created + 604800))"
renew_day="$(date -u -r "$renew_created" +%Y%m%d 2>/dev/null || date -u -d "@$renew_created" +%Y%m%d)"
renew_id="renew-v1-$renew_day-${source_manifest_sha:0:16}"
sed -e "s#^release_id=.*#release_id=$renew_id#" \
  -e "s#^created_at=.*#created_at=$renew_created#" -e "s#^expires_at=.*#expires_at=$renew_expires#" \
  -e "s#/releases/test-release/#/releases/$renew_id/#" "$out/manifest" > "$renewal_bundle/unsigned/manifest"
for name in catalog.json install-doctor-engine.mjs node-linux-arm64.tar.gz node-linux-x64.tar.gz node-macos-arm64.tar.gz node-macos-x64.tar.gz provision.sh; do
  cp "$out/$name" "$renewal_bundle/unsigned/$name"
done
sed "s#/releases/test-release/#/releases/$renew_id/#g; s/EXPECTED_RELEASE_ID='test-release'/EXPECTED_RELEASE_ID='$renew_id'/" \
  "$out/start" > "$renewal_bundle/unsigned/start"
renew_start_sha="$(shasum -a 256 "$renewal_bundle/unsigned/start" | awk '{print $1}')"
renew_start_size="$(wc -c < "$renewal_bundle/unsigned/start" | tr -d ' ')"
sed -e "s/^launcher_sha256=.*/launcher_sha256=$renew_start_sha/" -e "s/^launcher_size=.*/launcher_size=$renew_start_size/" \
  "$renewal_bundle/unsigned/manifest" > "$renewal_bundle/unsigned/manifest.next"
mv "$renewal_bundle/unsigned/manifest.next" "$renewal_bundle/unsigned/manifest"
jq -n --arg sourceId test-release --arg targetId "$renew_id" --arg sourceDigest "$source_manifest_sha" \
  --arg sourceCommit "$commit" --argjson created "$renew_created" --argjson expires "$renew_expires" \
  --argjson payloads "$(for name in provision.sh install-doctor-engine.mjs catalog.json node-macos-x64.tar.gz node-macos-arm64.tar.gz node-linux-x64.tar.gz node-linux-arm64.tar.gz; do jq -n --arg filename "$name" --arg sha256 "$(shasum -a 256 "$out/$name" | awk '{print $1}')" --argjson size "$(wc -c < "$out/$name")" '{filename:$filename,sha256:$sha256,size:$size}'; done | jq -s .)" \
  '{schemaVersion:1,channel:"stable",sourceReleaseId:$sourceId,sourceActivationId:"11111111-1111-4111-8111-111111111111",sourceGeneration:1,sourceEtag:"fixture-etag",sourceManifestSha256:$sourceDigest,sourceCommit:$sourceCommit,releaseId:$targetId,createdAt:$created,expiresAt:$expires,payloads:$payloads}' \
  > "$renewal_bundle/renewal-plan.json"
chmod 0600 "$renewal_bundle/renewal-plan.json" "$renewal_bundle/source"/* "$renewal_bundle/unsigned"/*
chmod 0700 "$renewal_bundle/source/provision.sh" "$renewal_bundle/source/install-doctor-engine.mjs" "$renewal_bundle/source/start" "$renewal_bundle/unsigned/provision.sh" "$renewal_bundle/unsigned/install-doctor-engine.mjs" "$renewal_bundle/unsigned/start"
renewed_output="$out_parent/$renew_id"
renewed_plan_signature="$out_parent/$renew_id.plan.sig"
bash "$renewal_signer" test-signer "$key" "$renewal_bundle" "$renewed_output" "$renewed_plan_signature"
cmp "$out/provision.sh" "$renewed_output/provision.sh"
ssh-keygen -Y verify -f "$FIXTURE/allowed_signers" -I test-signer -n install.doctor.release -s "$renewed_output/manifest.sig" < "$renewed_output/manifest" >/dev/null
ssh-keygen -Y verify -f "$FIXTURE/allowed_signers" -I test-signer -n install.doctor.release-renewal-plan -s "$renewed_plan_signature" < "$renewal_bundle/renewal-plan.json" >/dev/null
pass
cp "$renewal_bundle/renewal-plan.json" "$FIXTURE/tampered-renewal-plan.json"
jq '.sourceGeneration += 1' "$FIXTURE/tampered-renewal-plan.json" > "$FIXTURE/tampered-renewal-plan.next"
mv "$FIXTURE/tampered-renewal-plan.next" "$FIXTURE/tampered-renewal-plan.json"
if ssh-keygen -Y verify -f "$FIXTURE/allowed_signers" -I test-signer -n install.doctor.release-renewal-plan -s "$renewed_plan_signature" < "$FIXTURE/tampered-renewal-plan.json" >/dev/null 2>&1; then
  printf 'FAIL renewal plan signature accepted a changed source generation\n' >&2
  exit 1
fi
pass

cp -R "$renewal_bundle" "$FIXTURE/mutated-renewal"
printf '\n' >> "$FIXTURE/mutated-renewal/unsigned/provision.sh"
rejects 'a renewal with changed payload bytes' bash "$renewal_signer" test-signer "$key" "$FIXTURE/mutated-renewal" "$out_parent/mutated-renewal" "$out_parent/mutated-renewal.plan.sig"

cp -R "$renewal_bundle" "$FIXTURE/invariant-renewal"
sed -i.bak "s/^source_commit=.*/source_commit=$(printf 'b%.0s' {1..40})/" "$FIXTURE/invariant-renewal/unsigned/manifest"
rm "$FIXTURE/invariant-renewal/unsigned/manifest.bak"
rejects 'a renewal with a changed invariant manifest field' bash "$renewal_signer" test-signer "$key" "$FIXTURE/invariant-renewal" "$out_parent/invariant-renewal" "$out_parent/invariant-renewal.plan.sig"

cp -R "$renewal_bundle" "$FIXTURE/untrusted-renewal"
printf '\n' >> "$FIXTURE/untrusted-renewal/source/manifest"
rejects 'a renewal with an unauthenticated source manifest' bash "$renewal_signer" test-signer "$key" "$FIXTURE/untrusted-renewal" "$out_parent/untrusted-renewal" "$out_parent/untrusted-renewal.plan.sig"

if find "$out_parent" -maxdepth 1 -name '.bootstrap-release.*' -print | grep -q .; then
  printf 'FAIL publisher left a staging directory behind\n' >&2
  exit 1
fi
pass

printf 'bootstrap-release-publisher: %s passed, 0 failed\n' "$passes"
