#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
target="$PWD/home/dot_local/bin/executable_get-secret"
zx_path=$(command -v zx)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
export HOME="$fixture/home"
export PATH="$fixture/bin:$PATH"
export FIXTURE_LOG="$fixture/requests"
mkdir -p "$fixture/bin" "$HOME/.config/infisical"
chmod 700 "$HOME"
secret_dir="$HOME/.local/share/chezmoi/home/.chezmoitemplates/secrets-$(hostname -s)"
mkdir -p "$secret_dir"
printf '%s\n' fixture-offline-value >"$secret_dir/AGE_PASSWORD"
printf '%s\n' fixture-unapproved-value >"$secret_dir/OPERATIONAL_FIXTURE"
printf '%s\n' fixture-machine-credential >"$HOME/.config/infisical/universal-auth-client-secret"
chmod 600 "$HOME/.config/infisical/universal-auth-client-secret"
cat >"$fixture/bin/security" <<'SH'
#!/usr/bin/env bash
set -eu
[[ "$*" = 'find-generic-password -a fixture.megabyte.space -s com.heymegabyte.infisical-universal-auth-client-secret -w' ]]
printf '%s\n' fixture-machine-credential
SH
cat >"$fixture/bin/chezmoi" <<'SH'
#!/usr/bin/env bash
set -eu
[[ $* = decrypt ]]
printf 'offline\n' >>"$FIXTURE_LOG"
cat
SH
cat >"$fixture/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
request=$(cat)
if [[ "$*" == *'/api/v1/auth/universal-auth/login'* ]]; then
  [[ "$request" = '{"clientId":"22222222-2222-4222-8222-222222222222","clientSecret":"fixture-machine-credential"}' ]]
  printf 'login\n' >>"$FIXTURE_LOG"
  [[ "${FIXTURE_SCENARIO:-}" != outage ]] || exit 7
  printf '{"accessToken":"fixture-access-token"}\n'
else
  [[ "$*" = '--config -' ]]
  [[ "$request" == *'projectId=11111111-1111-4111-8111-111111111111&environment=prod&secretPath=%2F'* ]]
  [[ "$request" == *'Authorization: Bearer fixture-access-token'* ]]
  printf 'read\n' >>"$FIXTURE_LOG"
  [[ "${FIXTURE_SCENARIO:-}" = permitted ]] || exit 22
  printf '{"secret":{"secretValue":"fixture-operational-value"}}\n'
fi
SH
chmod +x "$fixture/bin/"*
cat >"$HOME/.infisical.json" <<'JSON'
{"workspaceId":"11111111-1111-4111-8111-111111111111","secretPath":"/","hostId":"fixture.megabyte.space","clientId":"22222222-2222-4222-8222-222222222222"}
JSON

get_secret() { "$zx_path" "$target" "$@"; }
expect_unavailable() {
  local output
  if output=$(get_secret "$@" 2>&1) || [[ "$output" == *fixture-offline-value* ]]; then
    printf 'Unexpected secret resolution for %s\n' "$*" >&2
    exit 1
  fi
}
export INSTALL_DOCTOR_SECRET_BACKEND=auto
export INFISICAL_ENVIRONMENT=fixture-other-environment
export OPERATIONAL_FIXTURE=fixture-ambient-value
: >"$FIXTURE_LOG"
[[ "$(FIXTURE_SCENARIO=permitted get_secret OPERATIONAL_FIXTURE)" = fixture-operational-value ]]
[[ "$(cat "$FIXTURE_LOG")" = $'login\nread' ]]
: >"$FIXTURE_LOG"
FIXTURE_SCENARIO=denied expect_unavailable AGE_PASSWORD
[[ "$(cat "$FIXTURE_LOG")" = $'login\nread' ]]
: >"$FIXTURE_LOG"
FIXTURE_SCENARIO=outage expect_unavailable --exists AGE_PASSWORD
[[ "$(cat "$FIXTURE_LOG")" = login ]]
: >"$FIXTURE_LOG"
[[ "$(INSTALL_DOCTOR_SECRET_BACKEND=local get_secret AGE_PASSWORD)" = fixture-offline-value ]]
[[ "$(cat "$FIXTURE_LOG")" = offline ]]
: >"$FIXTURE_LOG"
INSTALL_DOCTOR_SECRET_BACKEND=local expect_unavailable OPERATIONAL_FIXTURE
[[ ! -s "$FIXTURE_LOG" ]]

mv "$HOME/.infisical.json" "$HOME/.infisical.fixture.json"
sed 's#"secretPath":"/"#"secretPath":"/other-host"#' "$HOME/.infisical.fixture.json" >"$HOME/.infisical.json"
expect_unavailable AGE_PASSWORD
[[ ! -s "$FIXTURE_LOG" ]]

zfs_hook=home/dot_local/bin/post-installx/executable_post-zfs-prep.sh
! grep -Fq 'infisical secrets get' "$zfs_hook"
! grep -Eq 'get-secret[[:space:]]+SUDO_PASSWORD|SUDO_PASSWORD|SUDO_ASKPASS' "$zfs_hook"
echo 'get-secret-fail-closed: PASS'
