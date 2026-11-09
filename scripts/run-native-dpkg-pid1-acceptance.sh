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
(
  cd "$ROOT/packages/installer-engine"
  npm run bundle:broker-worker
)
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
  --tmpfs /run:rw,nosuid,nodev,exec,mode=755 \
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

# Enroll the fixed unprivileged peer used by the composed broker acceptance.
# The pinned Node base already supplies uid 1000; fail closed if that identity
# disappears instead of silently substituting a root or arbitrary host user.
docker exec "$CONTAINER" /bin/sh -ceu '
  enrolled_uid=1000
  passwd_entry="$(getent passwd "$enrolled_uid")"
  [ -n "$passwd_entry" ]
  enrolled_name="${passwd_entry%%:*}"
  [ -n "$enrolled_name" ]
  [ "$(id -u "$enrolled_name")" -eq "$enrolled_uid" ]
  enrolled_gid="$(id -g "$enrolled_name")"
  [ "$enrolled_gid" -gt 0 ]
  for path in /run/user/1000 /run/install.doctor /run/install.doctor/broker /run/desktop-tools /run/desktop-tools/authority /run/desktop-tools/broker; do
    [ ! -L "$path" ]
  done
  install -d -o "$enrolled_uid" -g "$enrolled_gid" -m 0700 /run/user/1000
  install -d -o 0 -g "$enrolled_gid" -m 0750 /run/install.doctor /run/install.doctor/broker
  install -d -o 0 -g "$enrolled_gid" -m 0750 /run/desktop-tools /run/desktop-tools/broker
  install -d -o 0 -g 0 -m 0711 /run/desktop-tools/authority
  [ "$(stat -c %u:%g:%a /run/user/1000)" = "$enrolled_uid:$enrolled_gid:700" ]
  [ "$(stat -c %u:%g:%a /run/install.doctor)" = "0:$enrolled_gid:750" ]
  [ "$(stat -c %u:%g:%a /run/install.doctor/broker)" = "0:$enrolled_gid:750" ]
  [ "$(stat -c %u:%g:%a /run/desktop-tools/broker)" = "0:$enrolled_gid:750" ]
  [ "$(stat -c %u:%g:%a /run/desktop-tools/authority)" = "0:0:711" ]
  setpriv --reuid="$enrolled_uid" --regid="$enrolled_gid" --init-groups --reset-env \
    /bin/sh -ceu '\''[ "$(id -u)" -eq 1000 ]; [ -w /run/user/1000 ]; [ -x /run/install.doctor/broker ]; [ ! -w /run/install.doctor/broker ]; [ -x /run/desktop-tools/authority ]; [ -x /run/desktop-tools/broker ]; [ ! -w /run/desktop-tools/broker ]'\''
'

docker exec "$CONTAINER" /usr/bin/setpriv --bounding-set=-net_admin --no-new-privs -- \
  node /opt/install.doctor/packages/installer-engine/acceptance.mjs /evidence/receipt.json \
  | tee "$EVIDENCE_ROOT/run.ndjson"
test -s "$EVIDENCE_ROOT/receipt.json"
# The container creates the receipt as root under a deliberately restrictive
# umask. Make the evidence readable before crossing back to the unprivileged
# CI host; the host cannot chmod a root-owned bind-mounted file.
docker exec "$CONTAINER" chmod 0644 /evidence/receipt.json
chmod 0644 "$EVIDENCE_ROOT/run.ndjson"
