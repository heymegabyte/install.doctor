#!/usr/bin/env bash
# Hermetic signed-release upgrade acceptance. Mutations stay inside a disposable
# network-disabled container; production launcher/provisioner/engine code is unchanged.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${INSTALL_DOCTOR_CANARY_IMAGE:-node@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40}"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-upgrade-acceptance.XXXXXXXX")"
cleanup() {
  if [ "${INSTALL_DOCTOR_KEEP_CANARY_FIXTURE:-0}" = 1 ]; then
    printf 'bootstrap-upgrade-acceptance: retained fixture %s\n' "$FIXTURE" >&2
  else
    rm -rf -- "$FIXTURE"
  fi
}
trap cleanup EXIT HUP INT TERM

command -v docker >/dev/null 2>&1 || { printf 'SKIP bootstrap-upgrade-acceptance: docker is unavailable\n'; exit 0; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  printf 'SKIP bootstrap-upgrade-acceptance: pinned image is unavailable locally: %s\n' "$IMAGE"; exit 0;
}
command -v ssh-keygen >/dev/null 2>&1 || { printf 'ssh-keygen is required\n' >&2; exit 1; }

printf 'bootstrap-upgrade-acceptance: bundling canonical engine\n'
npm --prefix "$ROOT/packages/installer-engine" run bundle >/dev/null

REPOSITORY="$FIXTURE/repository"
RUNTIME_DIR="$FIXTURE/runtimes"
RELEASES="$FIXTURE/releases"
TOOLS="$FIXTURE/publisher-tools"
mkdir -m 0700 "$REPOSITORY" "$RUNTIME_DIR" "$RELEASES" "$TOOLS"
mkdir -p "$REPOSITORY/home"
mkdir -p "$REPOSITORY/packages/control-plane/src"
cp "$ROOT/scripts/provision.sh" "$REPOSITORY/provision.sh"
cp "$ROOT/packages/installer-engine/dist/install-doctor-engine.mjs" "$REPOSITORY/install-doctor-engine.mjs"
cp "$ROOT/packages/control-plane/src/catalog.json" "$REPOSITORY/packages/control-plane/src/catalog.json"
(cd "$ROOT" && tar --exclude='node_modules' --exclude='dist' -cf - packages/aid-core packages/installer-engine) \
  | (cd "$REPOSITORY" && tar -xf -)
chmod 0700 "$REPOSITORY/provision.sh" "$REPOSITORY/install-doctor-engine.mjs"
printf '.\n' > "$REPOSITORY/.chezmoiroot"
printf 'v1\n' > "$REPOSITORY/home/UPGRADE-VERSION"
git -C "$REPOSITORY" init --quiet
git -C "$REPOSITORY" config user.name 'Install Doctor Upgrade Acceptance'
git -C "$REPOSITORY" config user.email 'upgrade-acceptance@install.doctor.invalid'
git -C "$REPOSITORY" add .
git -C "$REPOSITORY" commit --quiet -m 'immutable upgrade acceptance v1'
V1_COMMIT="$(git -C "$REPOSITORY" rev-parse HEAD)"
printf 'v2\n' > "$REPOSITORY/home/UPGRADE-VERSION"
git -C "$REPOSITORY" add home/UPGRADE-VERSION
git -C "$REPOSITORY" commit --quiet -m 'immutable upgrade acceptance v2'
V2_COMMIT="$(git -C "$REPOSITORY" rev-parse HEAD)"
[ "$V1_COMMIT" != "$V2_COMMIT" ] || { printf 'fixture commits must differ\n' >&2; exit 1; }
git -C "$REPOSITORY" remote add origin 'https://github.com/heymegabyte/install.doctor.git'

SIGNING_KEY="$FIXTURE/release-key"
ssh-keygen -q -t ed25519 -N '' -C install-doctor-upgrade-acceptance -f "$SIGNING_KEY"
RUNTIME_VERSION='24.22.2'
SHASUMS="$FIXTURE/SHASUMS256.txt"
for PLATFORM in darwin-x64 darwin-arm64 linux-x64 linux-arm64; do
  ARCHIVE="$RUNTIME_DIR/node-v$RUNTIME_VERSION-$PLATFORM.tar.gz"
  printf 'unused system-runtime upgrade fixture: %s\n' "$PLATFORM" > "$ARCHIVE"
  shasum -a 256 "$ARCHIVE" | awk -v name="node-v$RUNTIME_VERSION-$PLATFORM.tar.gz" '{print $1 "  " name}' >> "$SHASUMS"
done
printf 'upgrade-only detached provenance fixture\n' > "$FIXTURE/SHASUMS256.txt.sig"
printf 'upgrade-only keyring fixture\n' > "$FIXTURE/node-release-keyring.gpg"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TOOLS/gpgv"
chmod 0700 "$TOOLS/gpgv"

CREATED="$(date -u +%s)"; EXPIRES="$((CREATED + 3600))"
publish_release() {
  local release_id="$1" source_commit="$2"
  local unsigned_release="$RELEASES/$release_id.unsigned"
  PATH="$TOOLS:$PATH" \
  INSTALL_DOCTOR_RUNTIME_NODE_VERSION="$RUNTIME_VERSION" \
  INSTALL_DOCTOR_RUNTIME_DIR="$RUNTIME_DIR" \
  INSTALL_DOCTOR_NODE_SHASUMS="$SHASUMS" \
  INSTALL_DOCTOR_NODE_SHASUMS_SIGNATURE="$FIXTURE/SHASUMS256.txt.sig" \
  INSTALL_DOCTOR_NODE_RELEASE_KEYRING="$FIXTURE/node-release-keyring.gpg" \
    bash "$ROOT/scripts/publish-bootstrap-release.sh" \
      "$release_id" "$source_commit" "$CREATED" "$EXPIRES" install-doctor-upgrade-acceptance \
      - "$REPOSITORY/provision.sh" "$REPOSITORY/install-doctor-engine.mjs" "$unsigned_release"
  bash "$ROOT/scripts/sign-bootstrap-release.sh" install-doctor-upgrade-acceptance "$SIGNING_KEY" "$unsigned_release" "$RELEASES/$release_id"
}
publish_release acceptance-v1 "$V1_COMMIT"
publish_release acceptance-v2 "$V2_COMMIT"
for VERSION in v1 v2; do
  if [ "$VERSION" = v1 ]; then COMMIT="$V1_COMMIT"; else COMMIT="$V2_COMMIT"; fi
  git clone --quiet --no-local "$REPOSITORY" "$FIXTURE/source-$VERSION"
  git -C "$FIXTURE/source-$VERSION" checkout --quiet --detach "$COMMIT"
  git -C "$FIXTURE/source-$VERSION" remote set-url origin 'https://github.com/heymegabyte/install.doctor.git'
done

PUBLIC_KEY="$(cat "$SIGNING_KEY.pub")"
for VERSION in v1 v2; do
  node - "$FIXTURE/bootstrap-$VERSION.json" "$PUBLIC_KEY" "$VERSION" <<'NODE'
const fs = require('node:fs');
const [destination, signerPublicKey, version] = process.argv.slice(2);
const release = `acceptance-${version}`;
fs.writeFileSync(destination, `${JSON.stringify({
  manifestUrl: `https://app.install.doctor/releases/${release}/manifest`,
  signatureUrl: `https://app.install.doctor/releases/${release}/manifest.sig`,
  signerIdentity: 'install-doctor-upgrade-acceptance', signerPublicKey,
})}\n`, { mode: 0o600, flag: 'wx' });
NODE
  node "$ROOT/scripts/helpers/render-bootstrap.mjs" "$FIXTURE/bootstrap-$VERSION.json" > "$FIXTURE/start-$VERSION.sh"
  chmod 0600 "$FIXTURE/start-$VERSION.sh"
done

cat > "$FIXTURE/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
destination=''; previous=''
for argument in "$@"; do
  if [ "$previous" = '--output' ]; then destination="$argument"; fi
  previous="$argument"
done
[ -n "$destination" ] || exit 64
url="${!#}"
case "$url" in
  https://app.install.doctor/releases/acceptance-v1/*) release=acceptance-v1 ;;
  https://app.install.doctor/releases/acceptance-v2/*) release=acceptance-v2 ;;
  *) printf 'unexpected network request: %s\n' "$url" >&2; exit 65 ;;
esac
name="${url##*/}"
case "$name" in manifest|manifest.sig|provision.sh|install-doctor-engine.mjs|catalog.json|node-*.tar.gz) ;; *) exit 65 ;; esac
printf '%s\n' "$url" >> "$HOME/release-requests.log"
/bin/cp "/fixture/releases/$release/$name" "$destination"
SH
cat > "$FIXTURE/sudo" <<'SH'
#!/usr/bin/env bash
case " $* " in *' true '*|*' -k '*) exit 0 ;; esac
printf 'unexpected sudo invocation: %s\n' "$*" >&2; exit 64
SH
printf '#!/usr/bin/env bash\nprintf "unexpected rsync invocation\\n" >&2\nexit 64\n' > "$FIXTURE/rsync"
cat > "$FIXTURE/brew" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = --prefix ]; then printf '%s\n' "$HOME/.fixture-brew"; fi
exit 0
SH
cat > "$FIXTURE/gum" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "${*: -1}"
SH
printf '#!/usr/bin/env bash\nexit 0\n' > "$FIXTURE/zx"

cat > "$FIXTURE/chezmoi" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
source_root=''
if [ "${1:-}" = '--source' ]; then source_root="$2"; shift 2; fi
command="${1:-}"; shift || true
version="$(tr -d '\n' < "$source_root/UPGRADE-VERSION")"
mkdir -p "$HOME/.fixture" "$HOME/.config/chezmoi"
case "$command" in
  data) exit 0 ;;
  init)
    [ ! -e "$HOME/.fixture/chezmoi-init" ] || exit 97
    : > "$HOME/.fixture/chezmoi-init"
    printf 'sourceDir: fixture\n' > "$HOME/.config/chezmoi/chezmoi.yaml"
    printf 'apply:chezmoi-init:%s\n' "$version" >> "$HOME/mutation-ledger"
    ;;
  verify)
    last_argument="${!#}"
    if [ "$last_argument" = "$HOME/.local/bin/installx" ]; then
      [ -x "$HOME/.local/bin/installx" ]
    else
      [ -f "$HOME/.fixture/chezmoi-version" ] && [ "$(cat "$HOME/.fixture/chezmoi-version")" = "$version" ]
    fi
    ;;
  apply)
    last_argument="${!#}"
    if [ "$last_argument" = "$HOME/.local/bin/installx" ]; then
      [ ! -e "$HOME/.local/bin/installx" ] || exit 97
      mkdir -p "$HOME/.local/bin"
      cat > "$HOME/.local/bin/installx" <<'INSTALLX'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME/.fixture"
case " $* " in *' --check '*) [ -e "$HOME/.fixture/packages-applied" ] && exit 0 || exit 10 ;; esac
[ ! -e "$HOME/.fixture/packages-applied" ] || exit 97
: > "$HOME/.fixture/packages-applied"
printf 'apply:desired-packages\n' >> "$HOME/mutation-ledger"
INSTALLX
      chmod 0700 "$HOME/.local/bin/installx"
      printf 'apply:installx-tool\n' >> "$HOME/mutation-ledger"
    else
      printf '%s\n' "$version" > "$HOME/.fixture/chezmoi-version"
      printf 'apply:chezmoi:%s\n' "$version" >> "$HOME/mutation-ledger"
    fi
    ;;
  *) printf 'unexpected chezmoi command: %s\n' "$command" >&2; exit 64 ;;
esac
SH
cat > "$FIXTURE/process-software-groups" <<'SH'
#!/usr/bin/env bash
version="$(tr -d '\n' < "$INSTALL_DOCTOR_CHEZMOI_SOURCE/UPGRADE-VERSION")"
if [ "${1:-}" = --check ]; then [ "$(cat "$HOME/.fixture/software-groups-version" 2>/dev/null)" = "$version" ] && exit 0 || exit 10; fi
printf '%s\n' "$version" > "$HOME/.fixture/software-groups-version"
printf 'apply:software-groups:%s\n' "$version" >> "$HOME/mutation-ledger"
SH
cat > "$FIXTURE/process-software-post-scripts" <<'SH'
#!/usr/bin/env bash
# Validation is not an install effect and deliberately has no receipt or
# mutation-ledger entry.
exit 0
SH

mkdir "$FIXTURE/container-tools" "$FIXTURE/container-fixture"
for TOOL in curl sudo rsync brew gum zx chezmoi process-software-groups process-software-post-scripts; do
  cp "$FIXTURE/$TOOL" "$FIXTURE/container-tools/$TOOL"; chmod 0700 "$FIXTURE/container-tools/$TOOL"
done
cp -a "$RELEASES" "$FIXTURE/container-fixture/releases"
cp -a "$REPOSITORY" "$FIXTURE/container-fixture/repository"
cp -a "$FIXTURE/source-v1" "$FIXTURE/source-v2" "$FIXTURE/container-fixture/"
cp "$FIXTURE/start-v1.sh" "$FIXTURE/start-v2.sh" "$FIXTURE/container-fixture/"

cat > "$FIXTURE/container-fixture/container-run.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
chmod 0700 /canary-home
for release in acceptance-v1 acceptance-v2; do
  mkdir -p "/canary-home/.local/share/install.doctor/releases/$release"
  version="${release##*-}"
  cp -a "/fixture/source-$version" "/canary-home/.local/share/install.doctor/releases/$release/source"
done
chown -R node:node /canary-home
cat > /canary-home/run-as-node.sh <<'RUN'
#!/usr/bin/env bash
set -euo pipefail
export HOME=/canary-home USER=node LOGNAME=node HEADLESS_INSTALL=1 SOFTWARE_GROUP=Minimal
export INSTALL_DOCTOR_ROLE=container INSTALL_DOCTOR_CAPABILITY=minimal INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2
export INSTALL_DOCTOR_SELECTED_SERVICES='' INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true INSTALL_DOCTOR_OFFLINE=false
run_start() { bash "/fixture/start-$1.sh" >"$HOME/$1-$2.stdout" 2>"$HOME/$1-$2.stderr"; }
plan_digest() { set -- "$HOME/.local/state/install.doctor/engine/approvals/"*.json; basename "$1" .json; }

set +e; run_start v1 plan; status=$?; set -e
[ "$status" -eq 3 ] && [ ! -e "$HOME/mutation-ledger" ] || exit 80
v1_digest="$(plan_digest)"
env INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$v1_digest" bash /fixture/start-v1.sh >"$HOME/v1-apply.stdout" 2>"$HOME/v1-apply.stderr"
cp "$HOME/mutation-ledger" "$HOME/v1-ledger"
v1_hash="$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')"
v1_mutations="$(wc -l < "$HOME/mutation-ledger" | tr -d ' ')"
[ "$(cat "$HOME/.fixture/chezmoi-version")" = v1 ] || exit 81

set +e; run_start v2 plan; status=$?; set -e
[ "$status" -eq 3 ] || exit 82
[ "$v1_hash" = "$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')" ] || exit 83
[ "$(cat "$HOME/.fixture/chezmoi-version")" = v1 ] || exit 84
set -- "$HOME/.local/state/install.doctor/engine/approvals/"*.json
[ "$#" -eq 2 ] || exit 85
v2_digest=''
for approval in "$@"; do candidate="$(basename "$approval" .json)"; [ "$candidate" = "$v1_digest" ] || v2_digest="$candidate"; done
[ -n "$v2_digest" ] && [ "$v1_digest" != "$v2_digest" ] || exit 86

env INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$v2_digest" bash /fixture/start-v2.sh >"$HOME/v2-apply.stdout" 2>"$HOME/v2-apply.stderr"
[ "$(cat "$HOME/.fixture/chezmoi-version")" = v2 ] || exit 87
grep -q '^apply:chezmoi:v2$' "$HOME/mutation-ledger" || exit 88
tail -n "+$((v1_mutations + 1))" "$HOME/mutation-ledger" > "$HOME/v2-delta"
cat > "$HOME/v2-expected-delta" <<'DELTA'
apply:chezmoi:v2
apply:software-groups:v2
DELTA
cmp -s "$HOME/v2-expected-delta" "$HOME/v2-delta" \
  || { printf 'unexpected v2 mutation closure\n' >&2; diff -u "$HOME/v2-expected-delta" "$HOME/v2-delta" >&2 || true; exit 88; }
v2_hash="$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')"
env INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$v2_digest" bash /fixture/start-v2.sh >"$HOME/v2-unchanged.stdout" 2>"$HOME/v2-unchanged.stderr"
[ "$v2_hash" = "$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')" ] || exit 89

node - "$HOME" "$v1_digest" "$v2_digest" <<'VERIFY'
const fs = require('node:fs'); const path = require('node:path'); const cp = require('node:child_process');
const [home, v1Digest, v2Digest] = process.argv.slice(2);
for (const release of ['acceptance-v1', 'acceptance-v2']) {
  const source = path.join(home, '.local/share/install.doctor/releases', release, 'source');
  if (cp.execFileSync('git', ['-C', source, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }) !== '') throw new Error(`${release} source dirty`);
  const sourceCommit = fs.readFileSync(`/fixture/releases/${release}/manifest`, 'utf8').split('\n')
    .find(line => line.startsWith('source_commit='))?.slice('source_commit='.length);
  const commit = cp.execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const origin = cp.execFileSync('git', ['-C', source, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  if (commit !== sourceCommit || origin !== 'https://github.com/heymegabyte/install.doctor.git') throw new Error(`${release} source identity mismatch`);
  for (const name of ['manifest', 'manifest.sig', 'sha256sums']) {
    const provenancePath = path.join(home, '.local/state/install-doctor/releases', release, name);
    if (!fs.existsSync(provenancePath)) throw new Error(`${release} provenance missing ${name}`);
  }
}
for (const [digest, expectedRuns] of [[v1Digest, 1], [v2Digest, 2]]) {
  const root = path.join(home, '.local/state/install.doctor/engine/runs', digest);
  const runs = fs.readdirSync(root).filter(name => !name.startsWith('.'));
  if (runs.length !== expectedRuns) throw new Error(`${digest} expected ${expectedRuns} runs, found ${runs.length}`);
  for (const run of runs) {
    const receipts = fs.readdirSync(path.join(root, run, 'receipts')).filter(name => name.endsWith('.receipt.json'));
    if (receipts.length !== 1) throw new Error(`${run} receipt count ${receipts.length}`);
    const receipt = JSON.parse(fs.readFileSync(path.join(root, run, 'receipts', receipts[0]), 'utf8'));
    if (receipt.status !== 'success' || receipt.planDigest !== digest) throw new Error(`${run} is not authoritative success`);
  }
}
VERIFY
[ "$(wc -l < "$HOME/release-requests.log" | tr -d ' ')" -eq 25 ] || exit 90
printf 'distinct_releases=1\ndistinct_commits=1\ndistinct_plans=1\nv2_unchanged_mutations=0\n'
RUN
chmod 0700 /canary-home/run-as-node.sh
chown node:node /canary-home/run-as-node.sh
su -s /bin/bash node -c 'bash /canary-home/run-as-node.sh'
SH
chmod 0700 "$FIXTURE/container-fixture/container-run.sh"

MOUNTS=()
for TOOL in curl sudo rsync brew gum zx chezmoi process-software-groups process-software-post-scripts; do
  MOUNTS+=(--mount "type=bind,src=$FIXTURE/container-tools/$TOOL,dst=/usr/local/bin/$TOOL,readonly")
done
OUTPUT="$FIXTURE/canary.out"
docker run --rm --network=none --read-only --entrypoint /bin/bash \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,mode=1777 --tmpfs /canary-home:rw,nosuid,nodev,exec,mode=0700 \
  --mount "type=bind,src=$FIXTURE/container-fixture,dst=/fixture,readonly" "${MOUNTS[@]}" \
  "$IMAGE" /fixture/container-run.sh | tee "$OUTPUT"
grep -q '^distinct_releases=1$' "$OUTPUT"
grep -q '^distinct_commits=1$' "$OUTPUT"
grep -q '^distinct_plans=1$' "$OUTPUT"
grep -q '^v2_unchanged_mutations=0$' "$OUTPUT"
printf 'bootstrap-upgrade-acceptance: PASS (signed v1 apply, v2 approval boundary, changed closure, unchanged v2)\n'
