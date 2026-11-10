#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-github-runners.sh"
LEGACY_HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-github-runner.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/runner-temp"
printf 'preserve\n' > "$TMP/runner-temp/evidence"
cat > "$TMP/bin/uname" <<'SH'
#!/usr/bin/env sh
printf 'Linux\n'
SH
chmod 0700 "$TMP/bin/uname"

PATH="$TMP/bin:/usr/bin:/bin" GITHUB_RUNNER_COUNT=0 RUNNER_TEMP="$TMP/runner-temp" bash "$HOOK"
if PATH="$TMP/bin:/usr/bin:/bin" GITHUB_RUNNER_COUNT=1 GITHUB_RUNNER_REG_TOKEN=secret \
  RUNNER_TEMP="$TMP/runner-temp" bash "$HOOK"; then
  printf '%s\n' 'selected runner fleet incorrectly mutated or reported success' >&2
  exit 1
else
  test "$?" -eq 20
fi
test "$(cat "$TMP/runner-temp/evidence")" = preserve

if PATH="$TMP/bin:/usr/bin:/bin" GITHUB_RUNNER_COUNT=invalid bash "$HOOK"; then
  printf '%s\n' 'invalid runner count was accepted' >&2
  exit 1
else
  test "$?" -eq 2
fi

! rg -q '^[[:space:]]*(rm[[:space:]]+-[^ ]*r|.*GITHUB_RUNNER_REG_TOKEN|.*config\.sh|.*systemctl|.*useradd|.*sudo)' "$HOOK"
test ! -e "$LEGACY_HOOK"
printf '%s\n' 'github-runners-fail-closed: 7 passed, 0 failed'
