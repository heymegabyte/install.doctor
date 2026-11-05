#!/usr/bin/env bash
# Regression lock for the deprecated-tool residue cleanup (removal-wave-two
# XS-17 ntfy + XS-18/XS-19 tabby). ntfy and tabby are both `_deprecated` in
# software.yml, so installx never installs them on a fresh host — yet their
# chezmoi config/symlink sources and the post-tabby plugin hook still shipped
# to every machine, producing deploy-then-self-delete churn and a fleet-wide
# `npm install` hook for an app that is filtered out.
#
# This gate locks the RESIDUE removal while asserting the source of truth is
# preserved: the software.yml catalog tombstones must remain (historical
# knowledge), and the post-installx dispatcher must keep its wazuh example.
# Hermetic (pure file assertions, no network, no chezmoi, no host).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

# A1 — the deprecated-tool config/symlink/hook residue is gone.
dead_paths=(
  "home/dot_config/ntfy/private_ntfy.yml.tmpl"
  "home/Library/Application Support/ntfy/symlink_ntfy.yml.tmpl"
  "home/dot_config/tabby/plugins/package.json"
  "home/dot_config/tabby/private_config.yaml.tmpl"
  "home/Library/Application Support/tabby/symlink_config.yaml.tmpl"
  "home/Library/Application Support/tabby/symlink_plugins.tmpl"
  "home/dot_local/bin/post-installx/executable_post-tabby.sh"
)
missing=()
for path in "${dead_paths[@]}"; do
  [ ! -e "$ROOT/$path" ] || missing+=("$path")
done
if [ "${#missing[@]}" -eq 0 ]; then
  pass "ntfy + tabby config/symlink/hook residue removed (${#dead_paths[@]} paths absent)"
else
  fail "deprecated-tool residue restored: ${missing[*]}"
fi

# A2 — the ntfy auto-notify env var is no longer exported (its tool is deprecated).
if ! grep -qE 'AUTO_NTFY_DONE_IGNORE' "$ROOT/home/dot_config/shell/exports.sh.tmpl"; then
  pass "AUTO_NTFY_DONE_IGNORE export removed from exports.sh.tmpl"
else
  fail "AUTO_NTFY_DONE_IGNORE still exported in exports.sh.tmpl (dead ntfy residue)"
fi

# A3 — source of truth preserved: software.yml still carries the tombstones
#      (historical knowledge) and installx still filters them as deprecated.
if grep -qE '^  ntfy:$' "$ROOT/software.yml" && grep -qE '^  tabby:$' "$ROOT/software.yml"; then
  pass "software.yml ntfy + tabby catalog entries preserved (tombstones)"
else
  fail "software.yml ntfy/tabby catalog entry missing (unexpected removal)"
fi
if awk '/^  ntfy:$/{f=1} f&&/_deprecated:/{print; exit}' "$ROOT/software.yml" | grep -q '_deprecated:' \
  && awk '/^  tabby:$/{f=1} f&&/_deprecated:/{print; exit}' "$ROOT/software.yml" | grep -q '_deprecated:'; then
  pass "ntfy + tabby remain marked _deprecated in software.yml"
else
  fail "ntfy/tabby _deprecated marker missing from software.yml"
fi

# A4 — the post-installx dispatcher still has its wazuh per-tool example and no
#      software.yml script: entry points at the removed post-tabby hook.
if [ -f "$ROOT/home/dot_local/bin/post-installx/executable_post-wazuh.sh" ]; then
  pass "post-wazuh.sh preserved (dispatcher example intact)"
else
  fail "post-wazuh.sh missing (dispatcher example regressed)"
fi
if ! grep -qE 'post-installx/post-tabby\.sh' "$ROOT/software.yml"; then
  pass "no software.yml script: dispatch references the removed post-tabby hook"
else
  fail "software.yml still dispatches the removed post-tabby hook (dangling dispatch)"
fi

# A5 — non-vacuous self-test: plant a fixture, re-run the same detector, remove it.
planted="$ROOT/home/dot_config/tabby/private_config.yaml.tmpl"
mkdir -p "$(dirname "$planted")"
printf '{{ .chezmoi.os }}\n' > "$planted"
if [ -e "$planted" ]; then
  hit=0
  for path in "${dead_paths[@]}"; do
    [ ! -e "$ROOT/$path" ] || hit=1
  done
  rm -rf "$ROOT/home/dot_config/tabby"
  if [ "$hit" -eq 1 ]; then
    pass "self-test: planted tabby fixture was detected by the residue detector"
  else
    fail "self-test: planted tabby fixture was NOT detected (guard is vacuous)"
  fi
else
  fail "self-test: could not plant tabby fixture"
fi

printf 'deprecated-tool-residue: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
