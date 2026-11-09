#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-mise.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

mkdir -p "$TMP/bin" "$TMP/home"
cat > "$TMP/bin/gum" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$TMP/bin/mise" <<'SH'
#!/usr/bin/env bash
case "${1:-}" in
  ls)
    [ "${2:-}" = --missing ] || exit 2
    [ -f "$MISE_TEST_STATE" ] || printf 'java openjdk-21\n'
    ;;
  install)
    printf 'install\n' >> "$MISE_TEST_LEDGER"
    if [ -f "$MISE_TEST_FAIL_ONCE" ]; then rm -f "$MISE_TEST_FAIL_ONCE"; exit 130; fi
    : > "$MISE_TEST_STATE"
    ;;
  *) exit 2 ;;
esac
SH
chmod 0700 "$TMP/bin/gum" "$TMP/bin/mise"

export HOME="$TMP/home" PATH="$TMP/bin:/usr/bin:/bin"
export MISE_TEST_STATE="$TMP/state" MISE_TEST_LEDGER="$TMP/ledger" MISE_TEST_FAIL_ONCE="$TMP/fail-once"

set +e
bash "$HOOK" --check >/dev/null 2>&1
initial_status=$?
set -e
[ "$initial_status" -eq 10 ] && pass 'missing configured runtimes require apply' || fail 'missing runtime check was not actionable'

: > "$MISE_TEST_FAIL_ONCE"
if bash "$HOOK" --apply >/dev/null 2>&1; then
  fail 'interrupted mise install was reported successful'
else
  pass 'interrupted mise install remains a failed resumable attempt'
fi

if bash "$HOOK" --check >/dev/null 2>&1; then
  fail 'interrupted mise install fabricated its postcondition'
else
  pass 'interrupted mise install remains pending on reconciliation'
fi

if bash "$HOOK" --apply >/dev/null 2>&1 && bash "$HOOK" --verify >/dev/null 2>&1; then
  pass 'retry converges and verifies the configured runtime closure'
else
  fail 'retry did not converge the configured runtime closure'
fi

before="$(wc -l < "$MISE_TEST_LEDGER" | tr -d ' ')"
if bash "$HOOK" --check >/dev/null 2>&1 && bash "$HOOK" --verify >/dev/null 2>&1 \
  && [ "$(wc -l < "$MISE_TEST_LEDGER" | tr -d ' ')" -eq "$before" ]; then
  pass 'unchanged reconciliation performs no additional install'
else
  fail 'unchanged reconciliation repeated mutation'
fi

printf 'mise-post-hook: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
