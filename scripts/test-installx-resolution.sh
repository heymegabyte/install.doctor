#!/usr/bin/env bash
# Locks the most-specific installx field-resolution order for distro and OS keys.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

for expected in \
  'return `${pref}:${installer}:${osId}`' \
  'return `${pref}:${osId}:${installer}`' \
  'return `${pref}:${osId}`'; do
  if grep -Fq "$expected" "$INSTALLX"; then
    pass "installx returns the matched distro-specific key: $expected"
  else
    fail "installx must return the matched distro-specific key: $expected"
  fi
done

if grep -Fq 'if (!pkgs[i]) throw new Error(`unknown package dependency: ${i}`)' "$INSTALLX" \
  && grep -Fq 'if (visiting.has(i)) throw new Error(`dependency cycle detected at package: ${i}`)' "$INSTALLX"; then
  pass "dependency expansion rejects unknown and cyclic package keys"
else
  fail "dependency expansion must reject unknown and cyclic package keys"
fi

if grep -Fq 'case '\''pipx'\'':' "$INSTALLX" && grep -Fq 'uv tool install' "$INSTALLX" \
  && ! grep -Fq 'pipx install' "$INSTALLX"; then
  pass "pipx catalog recipes execute through the preloaded uv tool backend"
else
  fail "pipx catalog recipes must execute through uv tool install, never the deprecated pipx binary"
fi

if grep -Fq "acquireManagerList('uv', \`uv tool list" "$INSTALLX" \
  && ! grep -Fq "acquireManagerList('pipx'" "$INSTALLX"; then
  pass "installed Python tools are detected through uv, preventing repeat installs"
else
  fail "pipx-provider inventory must come from uv tool list"
fi

printf 'installx-resolution: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
