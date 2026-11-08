#!/usr/bin/env bash
# Ensures no post-installx hook is named after a specific host or hardcodes host-specific unit/CLI names.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DIR="$ROOT/home/dot_local/bin/post-installx"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if ls "$HOOK_DIR"/*legion* "$HOOK_DIR"/*omen* "$HOOK_DIR"/*zen* "$HOOK_DIR"/*macos-workstation* >/dev/null 2>&1; then
  fail "host-specific post-installx filename exists in $HOOK_DIR"
else
  pass "no host-specific post-installx filenames exist"
fi

if [ -f "$HOOK_DIR/executable_post-workstation.sh" ]; then
  pass "canonical executable_post-workstation.sh exists"
else
  fail "canonical executable_post-workstation.sh is missing"
fi

hit="$(grep -n -iE 'legion|omen|zen\.megabyte|zen-asus|iwlwifi-zen|16irx9|ck100|n501jw|/Users/Apple' "$HOOK_DIR"/executable_post-*.sh 2>/dev/null | head -n 1 || true)"
if [ -z "$hit" ]; then
  pass "all post-installx hooks are free of hardcoded hostnames and model strings"
else
  fail "host-specific string found in post-installx hooks: $hit"
fi

printf 'no-host-specific-plays: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
