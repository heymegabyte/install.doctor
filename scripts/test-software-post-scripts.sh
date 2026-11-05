#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$ROOT/home/dot_config/system/usr/local/bin/executable_process-software-post-scripts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

mkdir -p "$TMP/home/.local/share/chezmoi" "$TMP/bin"
cat >"$TMP/home/.local/share/chezmoi/software.yml" <<'YAML'
softwarePackages:
  succeeds:
    _bin: fixture-bin
    _post:
      - |-
        printf '%s\n' "words stay together" > "$POST_TEST_OUTPUT"
        printf '%s\n' first second >> "$POST_TEST_OUTPUT"
  fails:
    _bin: fixture-bin
    _post:
      - 'exit 23'
YAML
cat >"$TMP/bin/gum" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >&2
SH
cat >"$TMP/bin/fixture-bin" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$TMP/bin/gum" "$TMP/bin/fixture-bin"

if HOME="$TMP/home" XDG_DATA_HOME="$TMP/home/.local/share" PATH="$TMP/bin:$PATH" POST_TEST_OUTPUT="$TMP/output" bash "$RUNNER" >"$TMP/stdout" 2>"$TMP/stderr"; then
  fail "runner must return non-zero when any concurrent _post command fails"
else
  pass "runner propagates a concurrent _post failure"
fi

EXPECTED="$(printf 'words stay together\nfirst\nsecond')"
ACTUAL="$(cat "$TMP/output" 2>/dev/null || true)"
if [ "$ACTUAL" = "$EXPECTED" ]; then
  pass "array commands preserve spaces and multiline command bodies"
else
  fail "array command changed during YAML/JSON/shell transport: $ACTUAL"
fi

if grep -q 'Post-install task failed: fails:_post' "$TMP/stderr"; then
  pass "failure identifies the owning package and action"
else
  fail "failure output does not identify the failed action"
fi

printf 'software-post-scripts: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
