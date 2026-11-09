#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; PROVISION="$ROOT/scripts/provision.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }
mkdir -p "$TMP/archive/node-v24.1.0/bin" "$TMP/bin"
cat >"$TMP/archive/node-v24.1.0/bin/node" <<'SH'
#!/usr/bin/env sh
[ "${1:-}" = --version ] && { echo v24.1.0; exit 0; }
exit 0
SH
chmod 700 "$TMP/archive/node-v24.1.0/bin/node"
tar -czf "$TMP/runtime.tar.gz" -C "$TMP/archive" node-v24.1.0
if command -v sha256sum >/dev/null 2>&1; then SHA="$(sha256sum "$TMP/runtime.tar.gz" | awk '{print $1}')"; else SHA="$(shasum -a 256 "$TMP/runtime.tar.gz" | awk '{print $1}')"; fi
if stat -c %s "$TMP/runtime.tar.gz" >/dev/null 2>&1; then SIZE="$(stat -c %s "$TMP/runtime.tar.gz")"; else SIZE="$(stat -f %z "$TMP/runtime.tar.gz")"; fi
cat >"$TMP/bin/node" <<'SH'
#!/usr/bin/env sh
echo "${FAKE_SYSTEM_NODE_VERSION:-v23.0.0}"
SH
cat >"$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
printf 'curl\n' >>"$CALL_LOG"
out=''
while [ "$#" -gt 0 ]; do [ "$1" = --output ] && { out="$2"; shift 2; continue; }; shift; done
[ -n "$out" ] || exit 2
cp "$RUNTIME_FIXTURE" "$out"
SH
cat >"$TMP/bin/sha256sum" <<'SH'
#!/usr/bin/env sh
printf '%064d  %s\n' 0 "${1:-}"
SH
cat >"$TMP/bin/shasum" <<'SH'
#!/usr/bin/env sh
printf '%064d  %s\n' 0 "${3:-}"
SH
chmod +x "$TMP/bin/"*

run_runtime() {
  env PATH="$TMP/bin:/usr/bin:/bin" CALL_LOG="$TMP/calls" RUNTIME_FIXTURE="$TMP/runtime.tar.gz" FAKE_SYSTEM_NODE_VERSION="${1:-v23.0.0}" \
    INSTALL_DOCTOR_ENGINE_NODE_MIN=22 INSTALL_DOCTOR_BOOTSTRAP_PLATFORM=linux-x64 \
    INSTALL_DOCTOR_RUNTIME_SOURCE=signed-archive \
    INSTALL_DOCTOR_RELEASE_ID=test \
    INSTALL_DOCTOR_RUNTIME_URL=https://app.install.doctor/releases/test/node-linux-x64.tar.gz \
    INSTALL_DOCTOR_RUNTIME_SHA256="$SHA" INSTALL_DOCTOR_RUNTIME_SIZE="$SIZE" INSTALL_DOCTOR_RUNTIME_PLATFORM=linux-x64 \
    INSTALL_DOCTOR_RUNTIME_NODE_VERSION=24.1.0 INSTALL_DOCTOR_RUNTIME_ARCHIVE="$TMP/runtime.tar.gz" \
    bash -c 'source "$1"; ensureProvisionerNodeRuntime; status=$?; [ "$status" -eq 0 ] || exit "$status"; [ "$("$INSTALL_DOCTOR_RUNTIME_NODE" --version)" = v24.1.0 ]; [ -f "$INSTALL_DOCTOR_RUNTIME_NODE" ] && [ ! -L "$INSTALL_DOCTOR_RUNTIME_NODE" ]; stage=$INSTALL_DOCTOR_RUNTIME_STAGE; idCleanupProvisionerRuntime; [ ! -e "$stage" ]' _ "$PROVISION"
}

: >"$TMP/calls"
if run_runtime v23.0.0; then pass 'odd system Node is rejected and exact signed Node 24 runtime ignores hostile PATH hash helpers'; else fail 'signed runtime acquisition failed'; fi
[ ! -s "$TMP/calls" ] && pass 'launcher-staged runtime archive is not downloaded again' || fail 'runtime archive was downloaded again'

: >"$TMP/calls"
if env PATH="$TMP/bin:/usr/bin:/bin" CALL_LOG="$TMP/calls" FAKE_SYSTEM_NODE_VERSION=v22.9.0 INSTALL_DOCTOR_RUNTIME_SOURCE=system bash -c 'source "$1"; INSTALL_DOCTOR_ENGINE_NODE_MIN=22 ensureProvisionerNodeRuntime; [ "$INSTALL_DOCTOR_RUNTIME_NODE" = "$(command -v node)" ]; [ -z "${INSTALL_DOCTOR_RUNTIME_STAGE:-}" ]' _ "$PROVISION"; then
  pass 'supported system Node 22 is reused without a runtime descriptor'
else fail 'supported system Node was not reused'; fi
[ ! -s "$TMP/calls" ] && pass 'system Node reuse performs no download' || fail 'system Node reuse downloaded an archive'

if env PATH="$TMP/bin:/usr/bin:/bin" FAKE_SYSTEM_NODE_VERSION=v22.9.0 INSTALL_DOCTOR_RUNTIME_SOURCE=system \
  INSTALL_DOCTOR_RUNTIME_NODE=/usr/bin/node INSTALL_DOCTOR_ENGINE_NODE_MIN=22 \
  bash -c 'source "$1"; ensureProvisionerNodeRuntime' _ "$PROVISION" >/dev/null 2>&1; then
  fail 'system Node handoff accepted a changed executable identity'
else pass 'system Node handoff fails closed when executable identity changes'; fi

if env PATH="$TMP/bin:/usr/bin:/bin" FAKE_SYSTEM_NODE_VERSION=v20.0.0 INSTALL_DOCTOR_RUNTIME_SOURCE=signed-archive \
  INSTALL_DOCTOR_RUNTIME_NODE="$TMP/bin/node" INSTALL_DOCTOR_ENGINE_NODE_MIN=22 \
  bash -c 'source "$1"; ensureProvisionerNodeRuntime' _ "$PROVISION" >/dev/null 2>&1; then
  fail 'signed-archive handoff accepted a caller-provided runtime executable'
else pass 'signed-archive handoff rejects a caller-provided runtime executable'; fi

SEALED_NODE="$TMP/sealed-node"
cp "$TMP/archive/node-v24.1.0/bin/node" "$SEALED_NODE"; chmod 0555 "$SEALED_NODE"
if command -v sha256sum >/dev/null 2>&1; then SEALED_SHA="$(sha256sum "$SEALED_NODE" | awk '{print $1}')"; else SEALED_SHA="$(shasum -a 256 "$SEALED_NODE" | awk '{print $1}')"; fi
if env INSTALL_DOCTOR_RUNTIME_SOURCE=sealed-handoff INSTALL_DOCTOR_RUNTIME_NODE="$SEALED_NODE" \
  INSTALL_DOCTOR_HANDOFF_RUNTIME_SHA256="$SEALED_SHA" INSTALL_DOCTOR_ENGINE_NODE_MIN=22 \
  bash -c 'source "$1"; ensureProvisionerNodeRuntime; [ "$INSTALL_DOCTOR_RUNTIME_NODE" = "$2" ]' _ "$PROVISION" "$SEALED_NODE"; then
  pass 'sealed root-to-user runtime is independently digest and version verified'
else fail 'valid sealed root-to-user runtime was rejected'; fi
if env INSTALL_DOCTOR_RUNTIME_SOURCE=sealed-handoff INSTALL_DOCTOR_RUNTIME_NODE="$SEALED_NODE" \
  INSTALL_DOCTOR_HANDOFF_RUNTIME_SHA256="$(printf '0%.0s' {1..64})" INSTALL_DOCTOR_ENGINE_NODE_MIN=22 \
  bash -c 'source "$1"; ensureProvisionerNodeRuntime' _ "$PROVISION" >/dev/null 2>&1; then
  fail 'sealed handoff accepted a substituted runtime digest'
else pass 'sealed handoff rejects a substituted runtime digest'; fi

: >"$TMP/calls"
if env PATH="$TMP/bin:/usr/bin:/bin" CALL_LOG="$TMP/calls" FAKE_SYSTEM_NODE_VERSION=v20.0.0 INSTALL_DOCTOR_ENGINE_NODE_MIN=22 \
  INSTALL_DOCTOR_RUNTIME_SOURCE=signed-archive \
  INSTALL_DOCTOR_BOOTSTRAP_PLATFORM=linux-x64 INSTALL_DOCTOR_RUNTIME_URL='https://app.install.doctor/releases/../evil.tar.gz' \
  INSTALL_DOCTOR_RELEASE_ID=test \
  INSTALL_DOCTOR_RUNTIME_SHA256="$SHA" INSTALL_DOCTOR_RUNTIME_SIZE="$SIZE" INSTALL_DOCTOR_RUNTIME_PLATFORM=linux-x64 \
  INSTALL_DOCTOR_RUNTIME_NODE_VERSION=24.1.0 INSTALL_DOCTOR_RUNTIME_ARCHIVE="$TMP/runtime.tar.gz" \
  bash -c 'source "$1"; ensureProvisionerNodeRuntime' _ "$PROVISION" >/dev/null 2>&1; then fail 'traversal runtime URL was accepted'; else pass 'noncanonical runtime URL fails before acquisition'; fi
[ ! -s "$TMP/calls" ] && pass 'invalid descriptor performs no download' || fail 'invalid descriptor reached curl'

: >"$TMP/calls"
if env PATH="$TMP/bin:/usr/bin:/bin" CALL_LOG="$TMP/calls" RUNTIME_FIXTURE="$TMP/runtime.tar.gz" FAKE_SYSTEM_NODE_VERSION=v20.0.0 \
  INSTALL_DOCTOR_RUNTIME_SOURCE=signed-archive \
  INSTALL_DOCTOR_ENGINE_NODE_MIN=22 INSTALL_DOCTOR_BOOTSTRAP_PLATFORM=linux-x64 \
  INSTALL_DOCTOR_RELEASE_ID=test \
  INSTALL_DOCTOR_RUNTIME_URL=https://app.install.doctor/releases/test/node-linux-x64.tar.gz \
  INSTALL_DOCTOR_RUNTIME_SHA256="$(printf '0%.0s' {1..64})" INSTALL_DOCTOR_RUNTIME_SIZE="$SIZE" INSTALL_DOCTOR_RUNTIME_PLATFORM=linux-x64 \
  INSTALL_DOCTOR_RUNTIME_NODE_VERSION=24.1.0 INSTALL_DOCTOR_RUNTIME_ARCHIVE="$TMP/runtime.tar.gz" \
  bash -c 'source "$1"; ensureProvisionerNodeRuntime' _ "$PROVISION" >/dev/null 2>&1; then fail 'wrong runtime digest was accepted'; else pass 'wrong runtime digest fails closed'; fi

printf 'sealed handoff\n' >"$TMP/handoff-source"
if command -v sha256sum >/dev/null 2>&1; then HANDOFF_SHA="$(sha256sum "$TMP/handoff-source" | awk '{print $1}')"; else HANDOFF_SHA="$(shasum -a 256 "$TMP/handoff-source" | awk '{print $1}')"; fi
mkdir "$TMP/sealed"
ln -s "$TMP/handoff-source" "$TMP/sealed/symlink-target"
if bash -c 'source "$1"; idInstallSealedHandoffFile "$2" "$3" 0600 "$4"' _ "$PROVISION" "$TMP/handoff-source" "$TMP/sealed/symlink-target" "$HANDOFF_SHA"; then
  fail 'sealed handoff overwrote a symlink target'
else pass 'sealed handoff rejects a symlink target'; fi
printf 'preexisting\n' >"$TMP/sealed/precreated"
if bash -c 'source "$1"; idInstallSealedHandoffFile "$2" "$3" 0600 "$4"' _ "$PROVISION" "$TMP/handoff-source" "$TMP/sealed/precreated" "$HANDOFF_SHA"; then
  fail 'sealed handoff overwrote a precreated target'
else pass 'sealed handoff rejects a precreated target'; fi
if bash -c 'source "$1"; idInstallSealedHandoffFile "$2" "$3" 0600 "$4"' _ "$PROVISION" "$TMP/handoff-source" "$TMP/sealed/copied" "$HANDOFF_SHA"; then
  printf 'tampered\n' >"$TMP/sealed/copied"
  if bash -c 'source "$1"; idVerifySealedHandoffFile "$2" "$3"' _ "$PROVISION" "$TMP/sealed/copied" "$HANDOFF_SHA"; then fail 'handoff tampering passed pre-execution verification'; else pass 'handoff tampering fails pre-execution verification'; fi
else fail 'valid sealed handoff copy failed'; fi

mkdir "$TMP/install-doctor-runtime.forged"
if env TMPDIR="$TMP" INSTALL_DOCTOR_RUNTIME_STAGE="$TMP/install-doctor-runtime.forged" \
  bash -c 'source "$1"; idCleanupProvisionerRuntime' _ "$PROVISION" >/dev/null 2>&1; then
  fail 'cleanup accepted a caller-controlled runtime stage'
elif [ -d "$TMP/install-doctor-runtime.forged" ]; then
  pass 'cleanup refuses a caller-controlled lookalike stage'
else fail 'cleanup removed a caller-controlled lookalike stage'; fi

printf 'provision-node-runtime: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
