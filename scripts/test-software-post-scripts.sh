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
  rejected:
    _bin: fixture-bin
    _preload: true
    _post: 'printf compromised > "$POST_TEST_OUTPUT"'
YAML
cat >"$TMP/bin/fixture-bin" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$TMP/bin/fixture-bin"

if HOME="$TMP/home" XDG_DATA_HOME="$TMP/home/.local/share" PATH="$TMP/bin:$PATH" POST_TEST_OUTPUT="$TMP/output" bash "$RUNNER" >"$TMP/stdout" 2>"$TMP/stderr"; then
  fail "validator must reject executable _post metadata"
else
  pass "validator rejects executable _post metadata"
fi

if [ ! -e "$TMP/output" ]; then
  pass "rejected catalog text never reaches a shell"
else
  fail "catalog _post text executed"
fi

if grep -q 'rejected:_post' "$TMP/stderr"; then
  pass "failure identifies the owning package and metadata key"
else
  fail "failure output does not identify rejected metadata"
fi

if ! grep -q 'bash -c' "$RUNNER"; then
  pass "catalog validator contains no shell-string execution path"
else
  fail "catalog validator still grants shell authority"
fi

mkdir -p "$TMP/release-source"
cp "$TMP/home/.local/share/chezmoi/software.yml" "$TMP/release-source/software.yml"
if HOME="$TMP/home" XDG_DATA_HOME="$TMP/missing" INSTALL_DOCTOR_SOFTWARE_YAML="$TMP/release-source/software.yml" \
  PATH="$TMP/bin:/usr/bin:/bin" POST_TEST_OUTPUT="$TMP/output" bash "$RUNNER" >"$TMP/bound.stdout" 2>"$TMP/bound.stderr"; then
  fail "plan-bound release catalog unexpectedly admitted executable _post metadata"
else
  pass "plan-bound release catalog is validated independently of the conventional chezmoi path"
fi

printf 'softwarePackages:\n  valid:\n    _preload: true\n' > "$TMP/home/.local/share/chezmoi/software.yml"
if HOME="$TMP/home" XDG_DATA_HOME="$TMP/home/.local/share" PATH="$TMP/bin:/usr/bin:/bin" bash "$RUNNER" >/dev/null 2>&1; then
  pass "validator accepts a valid catalog without optional yq or gum"
else
  fail "validator retained an undeclared optional bootstrap dependency"
fi

printf 'software-post-scripts: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
