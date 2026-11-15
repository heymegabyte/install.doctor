#!/usr/bin/env bash
# Offline contract gate for post-installx/executable_post-gitlab-runner.sh (#134 / MEG-70).
#
# The hook replaces the deprecated pre-minted `GITLAB_RUNNER_TOKEN_*` flow with a dynamic
# `POST /api/v4/user/runners` mint, mirroring how the GitHub runner used to acquire its
# registration token. This gate proves, with stub `curl`/`gitlab-runner` binaries and no
# network, that the hook:
#   B1 no-ops when gitlab-runner is absent (binary gate, never installs anything),
#   B2 no-ops without INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1 (explicit opt-in only),
#   B3 fails closed (20) when no GITLAB_ACCESS_TOKEN can be resolved,
#   B4 rejects an unsupported scope and a missing group id (2) before any API call,
#   B5 mints runner_type=group_type with group_id and registers the returned token,
#      never echoing the token to stdout/stderr, writing the config 0600,
#   B6 is idempotent: a second run skips the API entirely for the registered name.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-gitlab-runner.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/gitlab-runner-post-hook.XXXXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT HUP INT TERM

PASS=0
FAIL=0
pass() { printf 'PASS %s\n' "$*"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; FAIL=$((FAIL + 1)); }

[ -f "$HOOK" ] || { fail "hook missing at $HOOK"; exit 1; }

mkdir -p "$TMP/bin" "$TMP/home/.config"

# --- stub toolchain ---------------------------------------------------------
cat >"$TMP/bin/gitlab-runner" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${RUNNER_CALLS:?}"
cmd="${1:-}"
shift || true
config=''
while [ $# -gt 0 ]; do
  case "$1" in
    --config) config="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$cmd" in
  register)
    [ -n "$config" ] || exit 1
    mkdir -p "$(dirname -- "$config")"
    {
      printf 'concurrent = 1\n'
      printf '[[runners]]\n'
      printf '  name = "%s"\n' "${STUB_RUNNER_NAME:-fixture-runner}"
      printf '  token = "glrt-fixture"\n'
    } >"$config"
    ;;
  verify) : ;;
  *) : ;;
esac
SH

cat >"$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
: "${CURL_CALLS:?}"
printf '%s\n' "$*" >>"$CURL_CALLS"
output=''
prev=''
for arg in "$@"; do
  if [ "$prev" = --output ]; then output="$arg"; fi
  prev="$arg"
done
[ -n "$output" ] || exit 2
printf '{"id":1,"token":"glrt-minted-fixture"}\n' >"$output"
SH

chmod 700 "$TMP/bin/"*
export PATH="$TMP/bin:/usr/bin:/bin"
export HOME="$TMP/home"
export XDG_CONFIG_HOME="$TMP/home/.config"
export GITLAB_RUNNER_CONFIG="$XDG_CONFIG_HOME/gitlab-runner/config.toml"
export GITLAB_RUNNER_NAME=fixture-runner
export STUB_RUNNER_NAME=fixture-runner
export CURL_CALLS="$TMP/curl.calls"
export RUNNER_CALLS="$TMP/runner.calls"
: >"$CURL_CALLS"
: >"$RUNNER_CALLS"

run_hook() {
  # Captures combined output so token-leak assertions can inspect it.
  set +e
  HOOK_OUT="$(env "$@" bash "$HOOK" 2>&1)"
  HOOK_STATUS=$?
  set -e
}

# B1 — binary gate: no gitlab-runner on PATH means nothing to do.
mv "$TMP/bin/gitlab-runner" "$TMP/gitlab-runner.stub"
run_hook INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1 GITLAB_ACCESS_TOKEN=fixture-token
if [ "$HOOK_STATUS" -eq 0 ] && printf '%s' "$HOOK_OUT" | grep -q 'not installed'; then
  pass 'B1 no-ops when gitlab-runner is not installed'
else
  fail "B1 expected a clean skip, got status $HOOK_STATUS: $HOOK_OUT"
fi
mv "$TMP/gitlab-runner.stub" "$TMP/bin/gitlab-runner"

# B2 — opt-in gate: the hook must never enroll unprompted.
run_hook GITLAB_ACCESS_TOKEN=fixture-token
if [ "$HOOK_STATUS" -eq 0 ] && printf '%s' "$HOOK_OUT" | grep -q 'lazy enrollment'; then
  pass 'B2 no-ops without INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1'
else
  fail "B2 expected lazy enrollment skip, got status $HOOK_STATUS: $HOOK_OUT"
fi

# B3 — missing token fails closed before touching the API.
run_hook INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1 GITLAB_ACCESS_TOKEN=
if [ "$HOOK_STATUS" -eq 20 ] && [ ! -s "$CURL_CALLS" ]; then
  pass 'B3 fails closed (20) with no resolvable GITLAB_ACCESS_TOKEN and never calls the API'
else
  fail "B3 expected exit 20 with no API call, got status $HOOK_STATUS"
fi

# B4 — scope validation happens before the mint request.
run_hook INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1 GITLAB_ACCESS_TOKEN=fixture-token GITLAB_RUNNER_SCOPE=team
if [ "$HOOK_STATUS" -eq 2 ] && [ ! -s "$CURL_CALLS" ]; then
  pass 'B4a rejects an unsupported scope before the API call'
else
  fail "B4a expected exit 2 for GITLAB_RUNNER_SCOPE=team, got status $HOOK_STATUS"
fi

run_hook INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1 GITLAB_ACCESS_TOKEN=fixture-token GITLAB_RUNNER_SCOPE=group
if [ "$HOOK_STATUS" -eq 2 ] && [ ! -s "$CURL_CALLS" ]; then
  pass 'B4b requires GITLAB_RUNNER_GROUP_ID for group scope'
else
  fail "B4b expected exit 2 without GITLAB_RUNNER_GROUP_ID, got status $HOOK_STATUS"
fi

# B5 — happy path: mint then register, without leaking the token.
run_hook INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1 GITLAB_ACCESS_TOKEN=fixture-token \
  GITLAB_RUNNER_SCOPE=group GITLAB_RUNNER_GROUP_ID=42 GITLAB_RUNNER_TAGS=linux,docker
if [ "$HOOK_STATUS" -eq 0 ]; then
  pass 'B5a mints and registers successfully'
else
  fail "B5a expected exit 0, got $HOOK_STATUS: $HOOK_OUT"
fi
if grep -q 'runner_type=group_type' "$CURL_CALLS" && grep -q 'group_id=42' "$CURL_CALLS" \
  && grep -q 'tag_list=linux,docker' "$CURL_CALLS" && grep -q 'api/v4/user/runners' "$CURL_CALLS"; then
  pass 'B5b mints via POST /api/v4/user/runners with group_type, group_id and tag_list'
else
  fail "B5b mint request was wrong: $(cat "$CURL_CALLS")"
fi
if grep -q 'register' "$RUNNER_CALLS" && grep -q 'glrt-minted-fixture' "$RUNNER_CALLS" \
  && grep -q -- '--executor docker' "$RUNNER_CALLS"; then
  pass 'B5c registers the minted token non-interactively with the docker executor'
else
  fail "B5c gitlab-runner register was not driven with the minted token: $(cat "$RUNNER_CALLS")"
fi
if printf '%s' "$HOOK_OUT" | grep -q 'glrt-minted-fixture'; then
  fail 'B5d the minted runner token leaked to the hook output'
else
  pass 'B5d the minted runner token never reaches stdout/stderr'
fi
if [ -f "$GITLAB_RUNNER_CONFIG" ] && [ "$(stat -c '%a' "$GITLAB_RUNNER_CONFIG")" = 600 ]; then
  pass 'B5e the runner config is written 0600'
else
  fail "B5e config missing or not 0600: $(stat -c '%a' "$GITLAB_RUNNER_CONFIG" 2>/dev/null || echo absent)"
fi

# B6 — idempotency: the registered name is never re-minted.
: >"$CURL_CALLS"
: >"$RUNNER_CALLS"
run_hook INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1 GITLAB_ACCESS_TOKEN=fixture-token \
  GITLAB_RUNNER_SCOPE=group GITLAB_RUNNER_GROUP_ID=42
if [ "$HOOK_STATUS" -eq 0 ] && [ ! -s "$CURL_CALLS" ] && [ ! -s "$RUNNER_CALLS" ] \
  && printf '%s' "$HOOK_OUT" | grep -q 'already registered'; then
  pass 'B6 a second run is idempotent (no API call, no re-registration)'
else
  fail "B6 expected an idempotent skip, got status $HOOK_STATUS: $HOOK_OUT"
fi

printf 'gitlab-runner-post-hook: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
