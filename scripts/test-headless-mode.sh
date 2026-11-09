#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"

# Sourcing is side-effect free: provisionLogic runs only when the file is the
# executable entrypoint.
source "$PROVISION"
logg() { :; }

assert_normalized() {
  local input="$1" expected="$2"
  HEADLESS_INSTALL="$input"
  idNormalizeHeadlessMode
  [ "$HEADLESS_INSTALL" = "$expected" ] || {
    printf 'HEADLESS_INSTALL=%q normalized to %q, expected %q\n' "$input" "$HEADLESS_INSTALL" "$expected" >&2
    exit 1
  }
}

assert_normalized true true
assert_normalized 1 true
assert_normalized false ''
assert_normalized 0 ''
assert_normalized '' ''

HEADLESS_INSTALL=maybe
if idNormalizeHeadlessMode >/dev/null 2>&1; then
  printf 'ambiguous HEADLESS_INSTALL value was accepted\n' >&2
  exit 1
fi

logic="$(sed -n '/^provisionLogic() {/,/^}/p' "$PROVISION")"
normalize_line="$(printf '%s\n' "$logic" | grep -n 'idNormalizeHeadlessMode' | head -n 1 | cut -d: -f1)"
defaults_line="$(printf '%s\n' "$logic" | grep -n 'applyEnvClassDefaults' | head -n 1 | cut -d: -f1)"
inputs_line="$(printf '%s\n' "$logic" | grep -n 'collectInputsUpfront' | head -n 1 | cut -d: -f1)"
[ -n "$normalize_line" ] && [ "$normalize_line" -lt "$defaults_line" ] && [ "$normalize_line" -lt "$inputs_line" ] || {
  printf 'headless normalization must precede environment defaults and every terminal input decision\n' >&2
  exit 1
}

printf 'headless-mode: pass\n'
