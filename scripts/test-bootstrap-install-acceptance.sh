#!/usr/bin/env bash
# Hermetic acceptance of the complete signed /start -> provisioner -> engine
# path. All mutations occur inside a disposable, network-disabled container.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${INSTALL_DOCTOR_CANARY_IMAGE:-node@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40}"
FIXTURE_PARENT="${INSTALL_DOCTOR_CANARY_FIXTURE_PARENT:-$ROOT/.agent/tmp}"
mkdir -p "$FIXTURE_PARENT"
chmod 0700 "$FIXTURE_PARENT"
FIXTURE="$(mktemp -d "$FIXTURE_PARENT/install-doctor-bootstrap-acceptance.XXXXXXXX")"
CANARY_IMAGE=''
cleanup() {
  [ -z "$CANARY_IMAGE" ] || docker image rm --force "$CANARY_IMAGE" >/dev/null 2>&1 || true
  if [ "${INSTALL_DOCTOR_KEEP_CANARY_FIXTURE:-0}" = 1 ]; then
    printf 'bootstrap-install-acceptance: retained fixture %s\n' "$FIXTURE" >&2
  else
    rm -rf -- "$FIXTURE"
  fi
}
trap cleanup EXIT HUP INT TERM

command -v docker >/dev/null 2>&1 || {
  printf 'SKIP bootstrap-install-acceptance: docker is unavailable\n'
  exit 0
}
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  printf 'SKIP bootstrap-install-acceptance: pinned image is unavailable locally: %s\n' "$IMAGE"
  exit 0
}
command -v ssh-keygen >/dev/null 2>&1 || { printf 'ssh-keygen is required\n' >&2; exit 1; }

printf 'bootstrap-install-acceptance: bundling canonical engine\n'
npm --prefix "$ROOT/packages/installer-engine" run bundle >/dev/null
printf 'bootstrap-install-acceptance: bundling Desktop Tools runtime\n'
npm --prefix "$ROOT/packages/desktop-tools-runtime" run build >/dev/null

REPOSITORY="$FIXTURE/repository"
RELEASE_PARENT="$FIXTURE/releases"
RELEASE_ID='acceptance'
RELEASE="$RELEASE_PARENT/$RELEASE_ID"
RUNTIME_DIR="$FIXTURE/runtimes"
TOOLS="$FIXTURE/tools"
mkdir -m 0700 "$REPOSITORY" "$RELEASE_PARENT" "$RUNTIME_DIR" "$TOOLS"
# Exercise the signed source-commit boundary with the repository's actual
# committed desired-state inputs. The canary still replaces every mutating
# executable with a hermetic fixture, so this proves provenance and source-tree
# structure without installing any real package or rendering local secrets.
git -C "$ROOT" archive --format=tar HEAD -- .chezmoiroot home software.yml \
  | tar -xf - -C "$REPOSITORY"
mkdir -p "$REPOSITORY/packages/control-plane/src"
cp "$ROOT/scripts/provision.sh" "$REPOSITORY/provision.sh"
cp "$ROOT/packages/installer-engine/dist/install-doctor-engine.mjs" "$REPOSITORY/install-doctor-engine.mjs"
cp "$ROOT/packages/control-plane/src/catalog.json" "$REPOSITORY/packages/control-plane/src/catalog.json"
# The real desired-state hook files remain at their canonical paths and are
# therefore covered by the signed source commit. Keep the hermetic canary from
# selecting those host-mutating hooks by making their catalog entries lazy in
# this fixture only; bootstrap executables themselves are supplied by mocks.
node - "$REPOSITORY/packages/control-plane/src/catalog.json" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const entry of catalog) {
  if (!['mise', 'rclone'].includes(entry.name)) continue;
  entry.preload = false;
  entry.loadPolicy = 'lazy';
  entry.loadRationale = 'default-lazy';
  entry.deliveryMode = 'lazy';
  delete entry.preloadReason;
}
fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`);
NODE
(cd "$ROOT" && tar --exclude='node_modules' --exclude='dist' -cf - packages/aid-core packages/installer-engine) \
  | (cd "$REPOSITORY" && tar -xf -)
chmod 0700 "$REPOSITORY/provision.sh" "$REPOSITORY/install-doctor-engine.mjs"
[ -f "$REPOSITORY/home/.chezmoidata.yaml" ]
[ -f "$REPOSITORY/home/dot_local/bin/executable_installx" ]
[ -f "$REPOSITORY/home/dot_config/shell/megabyte-cache.sh.tmpl" ]
[ -s "$REPOSITORY/software.yml" ]
DESIRED_STATE_FILE_COUNT="$(git -C "$ROOT" ls-tree -r --name-only HEAD -- home software.yml .chezmoiroot | wc -l | tr -d ' ')"
[ "$DESIRED_STATE_FILE_COUNT" -gt 1000 ] || { printf 'canonical desired-state fixture is unexpectedly incomplete\n' >&2; exit 1; }
git -C "$REPOSITORY" init --quiet
git -C "$REPOSITORY" config user.name 'Install Doctor Acceptance'
git -C "$REPOSITORY" config user.email 'acceptance@install.doctor.invalid'
git -C "$REPOSITORY" add .
git -C "$REPOSITORY" commit --quiet -m 'immutable acceptance release'
SOURCE_COMMIT="$(git -C "$REPOSITORY" rev-parse HEAD)"
git -C "$REPOSITORY" remote add origin 'https://github.com/heymegabyte/install.doctor.git'

SIGNING_KEY="$FIXTURE/release-key"
SIGNER_ID='desktop-acceptance'
ssh-keygen -q -t ed25519 -N '' -C desktop-tools-acceptance -f "$SIGNING_KEY"
PUBLIC_KEY="$(cat "$SIGNING_KEY.pub")"
CREATED="$(date -u +%s)"
EXPIRES="$((CREATED + 3600))"
UNSIGNED_RELEASE="$RELEASE.unsigned"
node --input-type=module - "$ROOT" "$FIXTURE" "$UNSIGNED_RELEASE" "$RELEASE_ID" "$SOURCE_COMMIT" "$CREATED" "$EXPIRES" "$SIGNER_ID" "$PUBLIC_KEY" <<'NODE'
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { buildDesktopToolsRelease } from './scripts/build-desktop-tools-release.mjs';
import { createDesktopReleaseInputs } from './packages/control-plane/test/helpers/desktop-release-fixture.mjs';
const [root, fixture, outputDirectory, releaseId, sourceCommit, createdAt, expiresAt, signerId, signerPublicKey] = process.argv.slice(2);
const runtime = Buffer.from('#!/usr/bin/env sh\nif [ "${1:-}" = --version ]; then printf "opencode 2.2.5\\n"; exit 0; fi\nexit 0\n');
const octal = (value, length) => `${value.toString(8).padStart(length - 1, '0')}\0`;
const tar = bytes => {
  const header = Buffer.alloc(512); header.write('opencode'); header.write(octal(0o700, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii'); header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(bytes.length, 12), 124, 12, 'ascii'); header.write(octal(0, 12), 136, 12, 'ascii');
  header.fill(0x20, 148, 156); header[156] = 0x30; header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return gzipSync(Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512), Buffer.alloc(1024)]), { mtime: 0 });
};
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
const zip = bytes => {
  const name = Buffer.from('opencode'); const crc = crc32(bytes);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE((0o100700 << 16) >>> 0, 38);
  const centralOffset = local.length + name.length + bytes.length; const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, bytes, central, name, end]);
};
const bodies = {
  provisioner: await readFile(join(root, 'scripts/provision.sh')),
  engine: await readFile(join(root, 'packages/installer-engine/dist/install-doctor-engine.mjs')),
  // Use the signed fixture catalog, whose two host-mutating custom hooks are
  // deliberately lazy for this hermetic canary. The source tree and its 1,540+
  // desired-state files remain intact and covered by sourceCommit.
  catalog: await readFile(join(fixture, 'repository/packages/control-plane/src/catalog.json')),
  supervisor: await readFile(join(root, 'packages/desktop-tools-runtime/dist/desktop-tools-supervisor.mjs')),
  tools: await readFile(join(root, 'packages/desktop-tools-runtime/dist/desktop-tools-tools.tar.gz')),
  opencode: { 'linux-x64': tar(runtime), 'linux-arm64': tar(runtime), 'macos-x64': zip(runtime), 'macos-arm64': zip(runtime) },
};
const inputs = await createDesktopReleaseInputs(fixture, { releaseId, sourceCommit, bodies });
await buildDesktopToolsRelease({ ...inputs, createdAt: Number(createdAt), expiresAt: Number(expiresAt), signerId, signerPublicKey,
  runtimeNodeVersion: '24.22.2', outputDirectory });
NODE
bash "$ROOT/scripts/sign-desktop-tools-release.sh" "$SIGNER_ID" "$SIGNING_KEY" "$UNSIGNED_RELEASE" "$RELEASE"
node "$ROOT/scripts/verify-desktop-tools-release.mjs" "$RELEASE" "$RELEASE_ID" "$SIGNER_ID" "$SIGNING_KEY.pub" >/dev/null
cp "$RELEASE/start" "$FIXTURE/start.sh"
# The launcher contains only public trust material. A Linux bind mount preserves
# the host UID, which need not match the pinned image UID, so grant read/execute
# without granting mutation to the canary process.
chmod 0555 "$FIXTURE/start.sh"

cat > "$FIXTURE/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
destination=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '--output' ]; then destination="$argument"; fi
  previous="$argument"
done
[ -n "$destination" ] || exit 64
url="${!#}"
case "$url" in
  https://desktop.tools/releases/acceptance/manifest) source=/fixture/release/manifest ;;
  https://desktop.tools/releases/acceptance/manifest.sig) source=/fixture/release/manifest.sig ;;
  https://desktop.tools/releases/acceptance/provision.sh) source=/fixture/release/provision.sh ;;
  https://desktop.tools/releases/acceptance/desktop-tools-engine.mjs) source=/fixture/release/desktop-tools-engine.mjs ;;
  https://desktop.tools/releases/acceptance/catalog.json) source=/fixture/release/catalog.json ;;
  https://desktop.tools/releases/acceptance/node-linux-x64.tar.gz) source=/fixture/release/node-linux-x64.tar.gz ;;
  https://desktop.tools/releases/acceptance/node-linux-arm64.tar.gz) source=/fixture/release/node-linux-arm64.tar.gz ;;
  https://desktop.tools/releases/acceptance/opencode-linux-x64.tar.gz) source=/fixture/release/opencode-linux-x64.tar.gz ;;
  https://desktop.tools/releases/acceptance/opencode-linux-arm64.tar.gz) source=/fixture/release/opencode-linux-arm64.tar.gz ;;
  https://desktop.tools/releases/acceptance/desktop-tools-supervisor.mjs) source=/fixture/release/desktop-tools-supervisor.mjs ;;
  https://desktop.tools/releases/acceptance/desktop-tools-tools.tar.gz) source=/fixture/release/desktop-tools-tools.tar.gz ;;
  https://desktop.tools/releases/acceptance/release.sbom.json) source=/fixture/release/release.sbom.json ;;
  https://desktop.tools/releases/acceptance/release.provenance.json) source=/fixture/release/release.provenance.json ;;
  https://desktop.tools/releases/acceptance/THIRD_PARTY_LICENSES.txt) source=/fixture/release/THIRD_PARTY_LICENSES.txt ;;
  https://desktop.tools/releases/acceptance/opencode.lock.json) source=/fixture/release/opencode.lock.json ;;
  https://desktop.tools/releases/acceptance/broker-approval-signer-delegation.json) source=/fixture/release/broker-approval-signer-delegation.json ;;
  *) printf 'unexpected network request: %s\n' "$url" >&2; exit 65 ;;
esac
printf '%s\n' "$url" >> "$HOME/release-requests.log"
/bin/cp "$source" "$destination"
SH

cat > "$FIXTURE/sudo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *' true '*|*' -k '*) exit 0 ;;
esac
printf 'unexpected sudo invocation: %s\n' "$*" >&2
exit 64
SH

cat > "$FIXTURE/rsync" <<'SH'
#!/usr/bin/env bash
printf 'unexpected rsync invocation\n' >&2
exit 64
SH

cat > "$FIXTURE/brew" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  --prefix) printf '%s\n' "$HOME/.fixture-brew" ;;
  *) exit 0 ;;
esac
SH

cat > "$FIXTURE/gum" <<'SH'
#!/usr/bin/env bash
# Styling is presentation-only in this headless canary.
printf '%s\n' "${*: -1}"
exit 0
SH
cat > "$FIXTURE/zx" <<'SH'
#!/usr/bin/env bash
exit 0
SH

cat > "$FIXTURE/chezmoi" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = '--source' ]; then shift 2; fi
command="${1:-}"; shift || true
mkdir -p "$HOME/.fixture" "$HOME/.config/chezmoi"
case "$command" in
  data) exit 0 ;;
  init)
    if [ ! -e "$HOME/.fixture/interruption-triggered" ]; then
      : > "$HOME/.fixture/interruption-triggered"
      operation_pid="$PPID"
      engine_pid="$(awk '{print $4}' "/proc/$operation_pid/stat")"
      kill -INT "$engine_pid"
      sleep 30
      exit 130
    fi
    [ ! -e "$HOME/.fixture/chezmoi-init" ] || exit 97
    : > "$HOME/.fixture/chezmoi-init"
    printf 'sourceDir: fixture\n' > "$HOME/.config/chezmoi/chezmoi.yaml"
    printf 'apply:chezmoi-init\n' >> "$HOME/mutation-ledger"
    ;;
  verify)
    last_argument="${!#}"
    if [ "$last_argument" = "$HOME/.local/bin/installx" ]; then
      [ -x "$HOME/.local/bin/installx" ]
    else
      [ -e "$HOME/.fixture/chezmoi-applied" ]
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
case " $* " in
  *' --check '*) [ -e "$HOME/.fixture/packages-applied" ] && exit 0 || exit 10 ;;
esac
[ ! -e "$HOME/.fixture/packages-applied" ] || exit 97
: > "$HOME/.fixture/packages-applied"
printf 'apply:desired-packages\n' >> "$HOME/mutation-ledger"
INSTALLX
        chmod 0700 "$HOME/.local/bin/installx"
        printf 'apply:installx-tool\n' >> "$HOME/mutation-ledger"
    else
        [ ! -e "$HOME/.fixture/chezmoi-applied" ] || exit 97
        : > "$HOME/.fixture/chezmoi-applied"
        printf 'apply:chezmoi\n' >> "$HOME/mutation-ledger"
    fi
    ;;
  *) printf 'unexpected chezmoi command: %s\n' "$command" >&2; exit 64 ;;
esac
SH

cat > "$FIXTURE/process-software-groups" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = --check ]; then [ -f "$HOME/.fixture/software-groups-current" ] && exit 0 || exit 10; fi
: > "$HOME/.fixture/software-groups-current"
printf 'apply:software-groups\n' >> "$HOME/mutation-ledger"
SH
cat > "$FIXTURE/process-software-post-scripts" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
# Catalog post metadata validation is intentionally read-only and may be
# repeated on every reconciliation without becoming an external mutation.
exit 0
SH

cat > "$FIXTURE/container-run.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
chmod 0700 /canary-home
cp -a /fixture/repository /canary-home/source
mkdir -p /canary-home/.local/share/install.doctor/releases/acceptance
mv /canary-home/source /canary-home/.local/share/install.doctor/releases/acceptance/source
chown -R node:node /canary-home

# Exercise the rendered launcher through a controlling PTY before the headless
# lifecycle. This is a separate home so its deliberate cancellation cannot
# affect the authoritative resume/rollback assertions below. The fixture gum
# selects the displayed defaults and approves the exact normalized plan.
chmod 0700 /canary-interactive-home
cp -a /fixture/repository /canary-interactive-home/source
mkdir -p /canary-interactive-home/.local/share/install.doctor/releases/acceptance
mv /canary-interactive-home/source /canary-interactive-home/.local/share/install.doctor/releases/acceptance/source
chown -R node:node /canary-interactive-home
command -v script >/dev/null 2>&1 || { printf 'util-linux script is required for PTY acceptance\n' >&2; exit 79; }
set +e
su -s /bin/bash node -c \
  'env -u HEADLESS_INSTALL HOME=/canary-interactive-home USER=node LOGNAME=node SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_ROLE=container INSTALL_DOCTOR_CAPABILITY=minimal INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_SELECTED_SERVICES="" INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true INSTALL_DOCTOR_OFFLINE=false TERM=xterm-256color script -q -e -c "bash /fixture/start.sh" /canary-interactive-home/pty.typescript' \
  > /canary-interactive-home/pty.stdout 2> /canary-interactive-home/pty.stderr
interactive_status=$?
set -e
[ "$interactive_status" -eq 130 ] || {
  printf 'interactive PTY status=%s\n' "$interactive_status" >&2
  cat /canary-interactive-home/pty.stdout /canary-interactive-home/pty.stderr >&2
  exit 79
}
grep -aFq $'\033[?1049h\033[?25l' /canary-interactive-home/pty.typescript \
  || { printf 'interactive engine never entered its alternate-screen TUI\n' >&2; exit 79; }
grep -aFq $'\033[?25h\033[?1049l' /canary-interactive-home/pty.typescript \
  || { printf 'interactive engine did not restore cursor and alternate-screen state\n' >&2; exit 79; }
grep -aFq 'Normalized install plan (' /canary-interactive-home/pty.typescript \
  || { printf 'interactive launcher never displayed its normalized plan\n' >&2; exit 79; }
grep -aFq 'Workers' /canary-interactive-home/pty.typescript \
  || { printf 'interactive launcher never rendered worker progress\n' >&2; exit 79; }
printf 'interactive_tui_restored=1\n'

# Exercise the same signed launcher as root and prove that its asynchronous
# handoff to the pre-enrolled account keeps the controlling terminal. Bash
# otherwise supplies /dev/null to a backgrounded handoff when job control is
# unavailable, which silently degrades the enrolled-user run to plain output.
chmod 0700 /root /home/node
cp -a /fixture/repository /home/node/source
mkdir -p /home/node/.local/share/install.doctor/releases/acceptance
mv /home/node/source /home/node/.local/share/install.doctor/releases/acceptance/source
chown node:node /home/node
chown -R node:node /home/node/.local
set +e
env -u HEADLESS_INSTALL HOME=/root USER=root LOGNAME=root SUDO_USER=node INSTALL_DOCTOR_USER=node \
  SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_ROLE=container INSTALL_DOCTOR_CAPABILITY=minimal \
  INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_SELECTED_SERVICES='' \
  INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false \
  INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true INSTALL_DOCTOR_OFFLINE=false TERM=xterm-256color \
  script -q -e -c 'bash /fixture/start.sh' /root/root-handoff.typescript \
  > /root/root-handoff.stdout 2> /root/root-handoff.stderr
root_handoff_status=$?
set -e
[ "$root_handoff_status" -eq 130 ] || {
  printf 'root handoff PTY status=%s\n' "$root_handoff_status" >&2
  cat /root/root-handoff.stdout /root/root-handoff.stderr >&2
  exit 79
}
grep -aFq $'\033[?1049h\033[?25l' /root/root-handoff.typescript \
  || { printf 'root handoff never entered the enrolled-user alternate-screen TUI\n' >&2; exit 79; }
grep -aFq $'\033[?25h\033[?1049l' /root/root-handoff.typescript \
  || { printf 'root handoff did not restore terminal state\n' >&2; exit 79; }
grep -aFq 'DESKTOP TOOLS' /root/root-handoff.typescript \
  || { printf 'root handoff did not render Desktop Tools identity\n' >&2; exit 79; }
grep -aFq 'Workers' /root/root-handoff.typescript \
  || { printf 'root handoff did not render enrolled-user worker progress\n' >&2; exit 79; }
printf 'root_handoff_tui_restored=1\n'

cat > /canary-home/run-as-node.sh <<'NODE_RUN'
#!/usr/bin/env bash
set -euo pipefail
export HOME=/canary-home USER=node LOGNAME=node
export HEADLESS_INSTALL=1 SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_ROLE=container INSTALL_DOCTOR_CAPABILITY=minimal
export INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_SELECTED_SERVICES=''
export INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true INSTALL_DOCTOR_OFFLINE=false
run_start() { bash /fixture/start.sh >"$1" 2>"$2"; }
run_start_approved() { env INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$3" bash /fixture/start.sh >"$1" 2>"$2"; }
STAGE_BEFORE="$(find /tmp -mindepth 1 -maxdepth 1 -type d -name 'desktop-tools.*' -print | LC_ALL=C sort)"

set +e
run_start "$HOME/plan.stdout" "$HOME/plan.stderr"
plan_status=$?
set -e
[ "$plan_status" -eq 3 ] || { printf 'planning status=%s\n' "$plan_status" >&2; cat "$HOME/plan.stdout" "$HOME/plan.stderr" >&2; exit 80; }
[ ! -e "$HOME/mutation-ledger" ] || { printf 'mutation occurred before approval\n' >&2; exit 81; }
RUNTIME_STATE="$HOME/.local/state/desktop-tools"
[ -x "$RUNTIME_STATE/bin/desktop-tools" ] || { printf 'Desktop Tools executable was not installed from the signed closure\n' >&2; exit 81; }
[ ! -e "$RUNTIME_STATE/config/inference-token" ] || { printf 'runtime installation unexpectedly required an inference credential\n' >&2; exit 81; }
for runtime_pattern in 'bin/desktop-tools-supervisor-*.mjs' 'runtime/desktop-tools-tools-*.tar.gz' \
  'runtime/opencode-lock-*.json' 'runtime/closure-*.json'; do
  [ "$(find "$RUNTIME_STATE/${runtime_pattern%/*}" -maxdepth 1 -type f -name "${runtime_pattern##*/}" | wc -l | tr -d ' ')" -eq 1 ] \
    || { printf 'runtime closure does not contain exactly one %s\n' "$runtime_pattern" >&2; find "$RUNTIME_STATE" -maxdepth 2 -print >&2; exit 81; }
done
[ "$($RUNTIME_STATE/bin/desktop-tools --version)" = 'opencode 2.2.5' ] \
  || { printf 'installed Desktop Tools executable reports the wrong version\n' >&2; exit 81; }
grep -Fq 'Installed the verified Desktop Tools runtime' "$HOME/plan.stdout" || { cat "$HOME/plan.stdout" "$HOME/plan.stderr" >&2; exit 81; }
runtime_fingerprint() {
  find "$RUNTIME_STATE" -type f -exec stat -c '%n|%i|%Y|%s' {} \; -exec sha256sum {} \; | LC_ALL=C sort | sha256sum | awk '{print $1}'
}
RUNTIME_FINGERPRINT="$(runtime_fingerprint)"
[ "$(find /tmp -mindepth 1 -maxdepth 1 -type d -name 'desktop-tools.*' -print | LC_ALL=C sort)" = "$STAGE_BEFORE" ] \
  || { printf 'stage zero left a private download directory behind\n' >&2; exit 81; }
set -- "$HOME/.local/state/install.doctor/engine/approvals/"*.json
[ "$#" -eq 1 ] && [ -f "$1" ] || { printf 'approval plan is missing or ambiguous\n' >&2; exit 82; }
digest="${1##*/}"; digest="${digest%.json}"
case "$digest" in ''|*[!a-f0-9]*) exit 83 ;; esac
[ "${#digest}" -eq 64 ] || exit 83
export INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$digest"
printf 'first_approved_plan=%s\n' "$digest" >&2

set +e
run_start_approved "$HOME/interrupted.stdout" "$HOME/interrupted.stderr" "$digest"
interrupted_status=$?
set -e
[ "$interrupted_status" -eq 130 ] || {
  printf 'interrupted run status=%s first_approved_plan=%s\n' "$interrupted_status" "$digest" >&2
  cat "$HOME/interrupted.stdout" "$HOME/interrupted.stderr" >&2
  exit 84
}
[ ! -e "$HOME/mutation-ledger" ] || { printf 'cancelled operation recorded a completed mutation\n' >&2; exit 85; }
[ "$(runtime_fingerprint)" = "$RUNTIME_FINGERPRINT" ] || { printf 'interruption changed the installed runtime closure\n' >&2; exit 85; }
grep -Fq 'Verified the unchanged Desktop Tools runtime' "$HOME/interrupted.stdout" || { cat "$HOME/interrupted.stdout" "$HOME/interrupted.stderr" >&2; exit 85; }

cat > "$HOME/runs-list.json" <<RUNS
{"schemaVersion":1,"command":"runs-list","stateRoot":"$HOME/.local/state/install.doctor/engine"}
RUNS
chmod 0600 "$HOME/runs-list.json"
node /fixture/release/desktop-tools-engine.mjs --input "$HOME/runs-list.json" > "$HOME/interrupted-runs.json"
interrupted_run_id="$(node - "$HOME/interrupted-runs.json" "$digest" <<'INSPECT_INTERRUPTED'
const fs = require('node:fs');
const path = require('node:path');
const [reportPath, expectedDigest] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const matches = report.runs.filter(run => run.planDigest === expectedDigest);
if (matches.length !== 1) throw new Error(`expected one interrupted run, found ${matches.length}`);
const [run] = matches;
if (run.authority !== 'uncommitted' || run.resumeCandidate !== true) {
  throw new Error(`interrupted run is not resumable: ${JSON.stringify(run)}`);
}
const directory = path.join('/canary-home/.local/state/install.doctor/engine/runs', expectedDigest, run.runId);
if (fs.existsSync(path.join(directory, 'owner.json'))) throw new Error('interrupted run retained a live owner');
const commits = fs.existsSync(path.join(directory, 'commits'))
  ? fs.readdirSync(path.join(directory, 'commits')).filter(name => name.endsWith('.commit.json')) : [];
const receipts = fs.existsSync(path.join(directory, 'receipts'))
  ? fs.readdirSync(path.join(directory, 'receipts')).filter(name => name.endsWith('.receipt.json')) : [];
if (commits.length !== 0 || receipts.length !== 0) throw new Error('interrupted run published terminal evidence');
process.stdout.write(run.runId);
INSPECT_INTERRUPTED
)"
[ -n "$interrupted_run_id" ] || { printf 'interrupted run identity is missing\n' >&2; exit 86; }

run_start_approved "$HOME/clean.stdout" "$HOME/clean.stderr" "$digest" || {
  printf 'resume rejected interrupted_run=%s first_approved_plan=%s\n' "$interrupted_run_id" "$digest" >&2
  cat "$HOME/clean.stdout" "$HOME/clean.stderr" >&2
  exit 87
}
[ -s "$HOME/mutation-ledger" ] || { printf 'clean install made no fixture mutations\n' >&2; exit 85; }
[ "$(grep -c '^apply:chezmoi-init$' "$HOME/mutation-ledger")" -eq 1 ] \
  || { printf 'resumed operation did not mutate exactly once\n' >&2; cat "$HOME/mutation-ledger" >&2; exit 87; }
cp "$HOME/mutation-ledger" "$HOME/clean-ledger"
clean_hash="$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')"
[ -f "$HOME/.config/install.doctor-policy.json" ] || { printf 'managed bootstrap policy is missing after install\n' >&2; exit 88; }

cat > "$HOME/rollback-plan.json" <<ROLLBACK_PLAN
{"schemaVersion":1,"command":"rollback-config-plan","stateRoot":"$HOME/.local/state/install.doctor/engine","sourceRunId":"$interrupted_run_id","sourcePlanDigest":"$digest"}
ROLLBACK_PLAN
chmod 0600 "$HOME/rollback-plan.json"
node /fixture/release/desktop-tools-engine.mjs --input "$HOME/rollback-plan.json" > "$HOME/rollback-plan-output.json"
rollback_digest="$(node - "$HOME/rollback-plan-output.json" <<'READ_ROLLBACK_PLAN'
const fs = require('node:fs');
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!/^[a-f0-9]{64}$/.test(plan.digest)) throw new Error('rollback plan digest is invalid');
if (JSON.stringify(plan.taskOrder) !== JSON.stringify([
  'installer.bootstrap-policy', 'bootstrap.installx-tool', 'bootstrap.installx-bin-directory',
])) {
  throw new Error(`unexpected rollback task order: ${JSON.stringify(plan.taskOrder)}`);
}
process.stdout.write(plan.digest);
READ_ROLLBACK_PLAN
)"
cat > "$HOME/rollback-execute.json" <<ROLLBACK_EXECUTE
{"schemaVersion":1,"command":"rollback-config-execute","stateRoot":"$HOME/.local/state/install.doctor/engine","sourceRunId":"$interrupted_run_id","sourcePlanDigest":"$digest","rollbackRunId":"bootstrap-policy-rollback","approvedPlanDigest":"$rollback_digest"}
ROLLBACK_EXECUTE
chmod 0600 "$HOME/rollback-execute.json"
node /fixture/release/desktop-tools-engine.mjs --input "$HOME/rollback-execute.json" > "$HOME/rollback-execute-output.json"
[ ! -e "$HOME/.config/install.doctor-policy.json" ] || { printf 'rollback did not restore the absent policy state\n' >&2; exit 88; }
[ ! -e "$HOME/.local/state/install.doctor/engine/tools/installx" ] || { printf 'rollback did not restore the absent engine installx state\n' >&2; exit 88; }
[ ! -d "$HOME/.local/state/install.doctor/engine/tools" ] || { printf 'rollback did not restore the absent engine tools directory state\n' >&2; exit 88; }
cat > "$HOME/rollback-status.json" <<ROLLBACK_STATUS
{"schemaVersion":1,"command":"rollback-config-status","stateRoot":"$HOME/.local/state/install.doctor/engine","rollbackRunId":"bootstrap-policy-rollback","planDigest":"$rollback_digest"}
ROLLBACK_STATUS
chmod 0600 "$HOME/rollback-status.json"
node /fixture/release/desktop-tools-engine.mjs --input "$HOME/rollback-status.json" > "$HOME/rollback-status-output.json"
node - "$HOME/rollback-status-output.json" <<'VERIFY_ROLLBACK_STATUS'
const fs = require('node:fs');
const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (status.authority !== 'committed' || status.receipt?.completed !== true) throw new Error('rollback status is not committed');
VERIFY_ROLLBACK_STATUS
set +e
node /fixture/release/desktop-tools-engine.mjs --input "$HOME/rollback-execute.json" > "$HOME/rollback-replay.stdout" 2> "$HOME/rollback-replay.stderr"
rollback_replay_status=$?
set -e
[ "$rollback_replay_status" -eq 3 ] || { printf 'committed rollback replay status=%s\n' "$rollback_replay_status" >&2; exit 88; }

# Reapply the approved desired state after the explicit rollback, then prove a
# subsequent unchanged run performs no fixture or managed-file mutation.
run_start_approved "$HOME/reapply.stdout" "$HOME/reapply.stderr" "$digest" || { cat "$HOME/reapply.stdout" "$HOME/reapply.stderr" >&2; exit 88; }
[ -f "$HOME/.config/install.doctor-policy.json" ] || { printf 'approved reapply did not restore managed policy\n' >&2; exit 88; }
[ -x "$HOME/.local/state/install.doctor/engine/tools/installx" ] || { printf 'approved reapply did not restore managed engine installx\n' >&2; exit 88; }
reapply_hash="$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')"
[ "$clean_hash" = "$reapply_hash" ] || { printf 'config reapply duplicated an external fixture mutation\n' >&2; exit 89; }

run_start_approved "$HOME/unchanged.stdout" "$HOME/unchanged.stderr" "$digest" || { cat "$HOME/unchanged.stdout" "$HOME/unchanged.stderr" >&2; exit 88; }
unchanged_hash="$(sha256sum "$HOME/mutation-ledger" | awk '{print $1}')"
[ "$reapply_hash" = "$unchanged_hash" ] || { printf 'unchanged run added a mutation\n' >&2; exit 89; }
[ "$(runtime_fingerprint)" = "$RUNTIME_FINGERPRINT" ] || { printf 'unchanged run replaced the runtime closure\n' >&2; exit 89; }
grep -Fq 'Verified the unchanged Desktop Tools runtime' "$HOME/unchanged.stdout" || { cat "$HOME/unchanged.stdout" "$HOME/unchanged.stderr" >&2; exit 89; }

node - "$HOME/.local/state/install.doctor/engine" "$digest" "$interrupted_run_id" <<'VERIFY'
const fs = require('node:fs');
const path = require('node:path');
const [root, expectedDigest, interruptedRunId] = process.argv.slice(2);
const runsRoot = path.join(root, 'runs', expectedDigest);
const runs = fs.readdirSync(runsRoot).filter(name => !name.startsWith('.'));
if (runs.length !== 3) throw new Error(`expected three approved runs, found ${runs.length}`);
for (const run of runs) {
  const directory = path.join(runsRoot, run);
  const commits = fs.readdirSync(path.join(directory, 'commits')).filter(name => name.endsWith('.commit.json'));
  if (commits.length !== 1) throw new Error(`${run} has ${commits.length} commits`);
  const receiptsDirectory = path.join(directory, 'receipts');
  const receipts = fs.readdirSync(receiptsDirectory).filter(name => name.endsWith('.receipt.json'));
  if (receipts.length !== 1) throw new Error(`${run} has ${receipts.length} receipts`);
  const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDirectory, receipts[0]), 'utf8'));
  if (receipt.status !== 'success' || receipt.planDigest !== expectedDigest) throw new Error(`${run} receipt is not authoritative success`);
}
if (!runs.includes(interruptedRunId)) throw new Error('automatic resume did not commit the interrupted run identity');
VERIFY

case "$(uname -m)" in
  x86_64|amd64) runtime_platform=linux-x64 ;;
  aarch64|arm64) runtime_platform=linux-arm64 ;;
  *) printf 'unsupported acceptance architecture\n' >&2; exit 88 ;;
esac
for artifact in manifest manifest.sig provision.sh desktop-tools-engine.mjs catalog.json "opencode-$runtime_platform.tar.gz" \
  desktop-tools-supervisor.mjs desktop-tools-tools.tar.gz release.sbom.json release.provenance.json \
  THIRD_PARTY_LICENSES.txt opencode.lock.json broker-approval-signer-delegation.json; do
  grep -Fxq "https://desktop.tools/releases/acceptance/$artifact" "$HOME/release-requests.log" \
    || { printf 'signed stage zero never fetched %s\n' "$artifact" >&2; exit 88; }
done
printf 'approved_plan=%s\n' "$digest"
printf 'mutations=%s\n' "$(wc -l < "$HOME/mutation-ledger" | tr -d ' ')"
printf 'interrupted_run_resumed=1\n'
printf 'rollback_config_committed=1\n'
printf 'committed_runs=3\n'
printf 'unchanged_mutations=0\n'
printf 'runtime_closure_durable=1\n'
NODE_RUN
chmod 0700 /canary-home/run-as-node.sh
chown node:node /canary-home/run-as-node.sh
su -s /bin/bash node -c 'bash /canary-home/run-as-node.sh'
SH

mkdir "$FIXTURE/container-tools"
for TOOL in curl sudo rsync brew gum zx chezmoi process-software-groups process-software-post-scripts; do
  cp "$FIXTURE/$TOOL" "$FIXTURE/container-tools/$TOOL"
  chmod 0700 "$FIXTURE/container-tools/$TOOL"
done
mkdir "$FIXTURE/container-fixture"
cp -a "$RELEASE" "$FIXTURE/container-fixture/release"
cp -a "$REPOSITORY" "$FIXTURE/container-fixture/repository"
cp "$FIXTURE/start.sh" "$FIXTURE/container-fixture/start.sh"
cp "$FIXTURE/container-run.sh" "$FIXTURE/container-fixture/container-run.sh"
cp -a "$FIXTURE/container-tools" "$FIXTURE/container-fixture/tools"
# Everything in this read-only mount is public release/canary material. The
# pinned image UID intentionally differs from the CI host UID, so permit read
# and directory/script traversal while stripping every group/other write bit.
chmod -R a+rX,go-w "$FIXTURE/container-fixture"

printf 'bootstrap-install-acceptance: running pinned, network-disabled container\n'
OUTPUT="$FIXTURE/canary.out"
DOCKER_MOUNTS=()
for TOOL in curl rsync brew gum zx chezmoi process-software-groups process-software-post-scripts; do
  DOCKER_MOUNTS+=(--mount "type=bind,src=$FIXTURE/container-fixture/tools/$TOOL,dst=/usr/local/bin/$TOOL,readonly")
done
# A bind mount from macOS/Colima preserves the host UID and cannot satisfy the
# production root-owned setuid sudo boundary. Build one ephemeral layer from
# the pinned base so the canary exercises the real fixed-path validation.
cat > "$FIXTURE/Dockerfile" <<'DOCKERFILE'
ARG BASE_IMAGE=node@sha256:8fa96264f302f58bbb13aa7339c541547b56975766ce956c875da149452a3e40
FROM ${BASE_IMAGE}
RUN usermod -aG sudo node
COPY --chown=0:0 --chmod=4755 container-fixture/tools/sudo /usr/bin/sudo
DOCKERFILE
CANARY_IMAGE="install-doctor/bootstrap-acceptance-${$}"
docker build --network=none --build-arg "BASE_IMAGE=$IMAGE" --tag "$CANARY_IMAGE" --file "$FIXTURE/Dockerfile" "$FIXTURE" >/dev/null
docker run --rm --network=none --read-only --entrypoint /bin/bash \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,mode=1777 \
  --tmpfs /run:rw,nosuid,nodev,exec,mode=0755 \
  --tmpfs /root:rw,nosuid,nodev,exec,mode=0700 \
  --tmpfs /home/node:rw,nosuid,nodev,exec,mode=0700 \
  --tmpfs /canary-home:rw,nosuid,nodev,exec,mode=0700 \
  --tmpfs /canary-interactive-home:rw,nosuid,nodev,exec,mode=0700 \
  --mount "type=bind,src=$FIXTURE/container-fixture,dst=/fixture,readonly" \
  "${DOCKER_MOUNTS[@]}" \
  "$CANARY_IMAGE" /fixture/container-run.sh | tee "$OUTPUT"

grep -q '^committed_runs=3$' "$OUTPUT"
grep -q '^interactive_tui_restored=1$' "$OUTPUT"
grep -q '^root_handoff_tui_restored=1$' "$OUTPUT"
grep -q '^interrupted_run_resumed=1$' "$OUTPUT"
grep -q '^rollback_config_committed=1$' "$OUTPUT"
grep -q '^unchanged_mutations=0$' "$OUTPUT"
grep -q '^runtime_closure_durable=1$' "$OUTPUT"
printf 'bootstrap-install-acceptance: PASS (signed Desktop Tools v9 profile bootstrap and %s committed desired-state inputs, durable runtime closure, direct and root-handoff PTY restoration, released cancellation, automatic same-run resume, committed config rollback, unchanged reapply)\n' "$DESIRED_STATE_FILE_COUNT"
