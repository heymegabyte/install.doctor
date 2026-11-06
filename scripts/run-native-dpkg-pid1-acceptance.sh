#!/usr/bin/env bash
# Reproducible destructive acceptance test. All package and service mutations
# occur inside a disposable Debian container with systemd as PID 1.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE_ROOT="$ROOT/packages/installer-engine/test/fixtures/native-dpkg-pid1"
EVIDENCE_ROOT="${INSTALL_DOCTOR_PID1_EVIDENCE_ROOT:-$ROOT/.agent/evidence/native-dpkg-pid1}"
IMAGE="install-doctor/native-dpkg-pid1:bookworm"
CONTAINER="install-doctor-native-dpkg-pid1-${$}"

command -v docker >/dev/null 2>&1 || { printf 'docker is required\n' >&2; exit 69; }
[ -f "$ROOT/packages/installer-engine/dist/index.js" ] || {
  printf 'build packages/installer-engine before running the PID1 acceptance fixture\n' >&2
  exit 65
}
mkdir -p "$EVIDENCE_ROOT"
chmod 0700 "$EVIDENCE_ROOT"
rm -f "$EVIDENCE_ROOT/receipt.json" "$EVIDENCE_ROOT/run.ndjson"

cleanup() {
  docker rm --force "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM HUP

docker build --pull=false --tag "$IMAGE" --file "$FIXTURE_ROOT/Dockerfile" "$ROOT"
docker run --detach \
  --name "$CONTAINER" \
  --hostname native-dpkg-pid1 \
  --privileged \
  --cgroupns private \
  --network none \
  --tmpfs /run:rw,nosuid,nodev,mode=755 \
  --tmpfs /run/lock:rw,nosuid,nodev,noexec,mode=755 \
  --volume "$EVIDENCE_ROOT:/evidence" \
  "$IMAGE" /sbin/init >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" /bin/sh -c '[ "$(cat /proc/1/comm)" = systemd ] && systemctl is-system-running 2>/dev/null | grep -Eq "^(running|degraded)$"'; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" -eq 1 ] || { docker logs "$CONTAINER" >&2; exit 1; }

docker exec "$CONTAINER" /usr/bin/setpriv --bounding-set=-net_admin --no-new-privs -- \
  node /opt/install.doctor/packages/installer-engine/acceptance.mjs /evidence/receipt.json \
  | tee "$EVIDENCE_ROOT/run.ndjson"
test -s "$EVIDENCE_ROOT/receipt.json"
chmod 0644 "$EVIDENCE_ROOT/receipt.json" "$EVIDENCE_ROOT/run.ndjson"
