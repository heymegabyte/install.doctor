#!/usr/bin/env bash
set -euo pipefail
trap 'printf "healthchecks Discord secret sync failed at line %s\n" "$LINENO" >&2' ERR

root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/healthchecks-discord-sync.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/state"

cat >"$fixture/bin/infisical" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
name=${3:?}
test "${FAIL_NAME:-}" != "$name" || exit 17
printf 'sentinel-%s\n' "$name"
EOF
cat >"$fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  info) printf 'active\n' ;;
  secret)
    case "${2:-}" in
      inspect) test -f "$DOCKER_SECRET_STATE/${3:?}" ;;
      create) test "${4:-}" = -; test ! -e "$DOCKER_SECRET_STATE/${3:?}"; dd of="$DOCKER_SECRET_STATE/${3:?}" status=none ;;
      rm) rm -f "$DOCKER_SECRET_STATE/${3:?}" ;;
      *) exit 2 ;;
    esac ;;
  *) exit 2 ;;
esac
EOF
chmod 700 "$fixture/bin/infisical" "$fixture/bin/docker"

run_sync() {
  PATH="$fixture/bin:$PATH" DOCKER_SECRET_STATE="$fixture/state" \
    bash "$root/home/dot_local/bin/executable_healthchecks-sync-discord-secrets" --project-id fixture-project
}

output=$(run_sync 2>"$fixture/stderr")
test "$output" = 'Provisioned Healthchecks Discord Docker secrets from Infisical.'
test ! -s "$fixture/stderr"
test "$(cat "$fixture/state/discord_client_id")" = 'sentinel-DISCORD_CLIENT_ID'
test "$(cat "$fixture/state/discord_client_secret")" = 'sentinel-DISCORD_CLIENT_SECRET'
! grep -q sentinel <<<"$output"

output=$(run_sync 2>"$fixture/stderr")
test "$output" = 'Healthchecks Discord Docker secrets already exist; no values retrieved.'
test ! -s "$fixture/stderr"

rm -f "$fixture/state/discord_client_id" "$fixture/state/discord_client_secret"
if PATH="$fixture/bin:$PATH" DOCKER_SECRET_STATE="$fixture/state" FAIL_NAME=DISCORD_CLIENT_SECRET \
  bash "$root/home/dot_local/bin/executable_healthchecks-sync-discord-secrets" --project-id fixture-project >/dev/null 2>&1; then
  printf 'partial Infisical failure unexpectedly succeeded\n' >&2
  exit 1
fi
test ! -e "$fixture/state/discord_client_id"
test ! -e "$fixture/state/discord_client_secret"

printf 'healthchecks Discord secret sync: ok\n'
