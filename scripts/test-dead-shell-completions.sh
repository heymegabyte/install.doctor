#!/usr/bin/env bash
# Regression lock for the dead shell-completion cleanup (removal-wave-two
# XS-20 atuin + XS-21 fig/plz). All three tools are filtered out of fresh
# installs: atuin is `_deprecated` (superseded by hiSHtory per
# docs/aid/decisions/0001), fig is `_deprecated` (Acquired by Amazon →
# CodeWhisperer), and plz has no software.yml entry at all. Yet their
# chezmoi completion templates still shipped to every machine, guarded only
# by `lookPath` (a no-op on a standard host), so they were pure dead weight.
#
# This gate locks the REMOVAL while asserting the source of truth is preserved:
# the software.yml catalog tombstones must remain (historical knowledge) and
# the remaining completion directory must keep its live entries. Hermetic
# (pure file assertions, no network, no chezmoi, no host).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

# A1 — the four dead completion templates are gone.
dead_paths=(
  "home/dot_local/share/zsh-completion/_atuin.tmpl"
  "home/dot_local/share/bash-completion/completions/atuin.bash.tmpl"
  "home/dot_local/share/bash-completion/completions/fig.bash.tmpl"
  "home/dot_local/share/bash-completion/completions/plz.bash.tmpl"
)
missing=()
for path in "${dead_paths[@]}"; do
  [ ! -e "$ROOT/$path" ] || missing+=("$path")
done
if [ "${#missing[@]}" -eq 0 ]; then
  pass "dead completion templates removed (${#dead_paths[@]} paths absent)"
else
  fail "dead completion templates restored: ${missing[*]}"
fi

# A2 — source of truth preserved: atuin + fig remain _deprecated tombstones
#      (historical knowledge), and plz remains absent from the catalog.
if grep -qE '^  atuin:$' "$ROOT/software.yml" && grep -qE '^  fig:$' "$ROOT/software.yml"; then
  pass "software.yml atuin + fig catalog entries preserved (tombstones)"
else
  fail "software.yml atuin/fig catalog entry missing (unexpected removal)"
fi
if awk '/^  atuin:$/{f=1} f&&/_deprecated:/{print; exit}' "$ROOT/software.yml" | grep -q '_deprecated:' \
  && awk '/^  fig:$/{f=1} f&&/_deprecated:/{print; exit}' "$ROOT/software.yml" | grep -q '_deprecated:'; then
  pass "atuin + fig remain marked _deprecated in software.yml"
else
  fail "atuin/fig _deprecated marker missing from software.yml"
fi
if ! grep -qE '^  plz:$' "$ROOT/software.yml"; then
  pass "plz still absent from the catalog (no re-entry introduced)"
else
  fail "plz re-entered the catalog without a completion decision"
fi

# A3 — no live code/doc re-references the deleted paths (path-only grep, never
#      values; excludes this gate, which necessarily names the paths it locks).
completion_refs="$(git -C "$ROOT" grep -nE \
  '_atuin\.tmpl|atuin\.bash\.tmpl|fig\.bash\.tmpl|plz\.bash\.tmpl' \
  -- home scripts docs site 2>/dev/null || true)"
completion_refs="$(printf '%s\n' "$completion_refs" | grep -v '^scripts/test-dead-shell-completions\.sh:' || true)"
if [ -z "$completion_refs" ]; then
  pass "no active reference to the deleted completion paths"
else
  printf '%s\n' "$completion_refs" >&2
  fail "dangling reference to a deleted completion path remains"
fi

# A4 — non-vacuous self-test: plant a fixture, re-run the same detector, remove it.
planted="$ROOT/home/dot_local/share/bash-completion/completions/plz.bash.tmpl"
mkdir -p "$(dirname "$planted")"
printf '{{- if (lookPath "plz") -}}\n{{- end -}}\n' > "$planted"
if [ -e "$planted" ]; then
  hit=0
  for path in "${dead_paths[@]}"; do
    [ ! -e "$ROOT/$path" ] || hit=1
  done
  rm -f "$planted"
  if [ "$hit" -eq 1 ]; then
    pass "self-test: planted plz fixture was detected by the completion detector"
  else
    fail "self-test: planted plz fixture was NOT detected (guard is vacuous)"
  fi
else
  fail "self-test: could not plant plz fixture"
fi

printf 'dead-shell-completions: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
