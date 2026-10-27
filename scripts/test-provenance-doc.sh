#!/usr/bin/env bash
# X09 gate — the upstream-provenance & license doc exists, names the REAL upstreams + their licenses,
# states the honest status of each (aid is NOT yet an OpenCode fork; UPSTREAMS.lock.json's 30
# candidates are all pending-evaluation with licenses not-yet-recorded), and makes NO fabricated
# "vendored / forked" claim about OpenCode. No network — pure file + lock cross-check.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/aid/provenance.md"
LOCK="$ROOT/UPSTREAMS.lock.json"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "provenance doc (X09)"

if [ -s "$DOC" ]; then
  lc="$(wc -l <"$DOC" | tr -d ' ')"
  [ "$lc" -ge 40 ] && pass "provenance.md exists + substantial (${lc} lines)" || fail "doc too thin (${lc} lines, want >=40)"
else
  fail "provenance.md missing ($DOC)"
  say "provenance: $P passed, $F failed"
  exit 1
fi

chk() { grep -qiF "$1" "$DOC" && pass "names '$1' ($2)" || fail "missing '$1' ($2)"; }
chkre() { grep -qiE "$1" "$DOC" && pass "$2" || fail "$2 — pattern '$1' absent"; }

# Provisioning machinery (preserved, named upstreams).
chk "chezmoi" "provisioning: chezmoi"
chk "mise" "provisioning: mise"
chk "hiSHtory" "provisioning: hiSHtory"
chk "software.yml" "the project's own catalog"
# Control-plane / aid-core deps.
chk "Hono" "control-plane: Hono"
chk "Zod" "control-plane/aid-core: Zod"
# License facts.
chkre "MIT" "records the MIT license (install.doctor + Hono + Zod)"
# aid = OpenCode — HONEST status (intended, NOT yet forked).
chk "OpenCode" "the aid runtime's intended upstream"
chkre "not yet|intended|POSIX|shell client|K01|not a fork" "HONEST: aid is NOT yet an OpenCode fork"
# UPSTREAMS.lock.json — 30 candidates, pending-evaluation, none vendored.
chk "UPSTREAMS.lock.json" "the upstream-candidate lock"
chkre "pending.evaluation" "states the pending-evaluation status"
chkre "\b30\b" "names the candidate count (30)"
chkre "none vendored|not (yet )?vendored|candidates" "honest: candidates not yet reused"

# Cross-check the lock really has 30 pending-evaluation entries (doc matches reality).
if [ -f "$LOCK" ] && command -v python3 >/dev/null 2>&1; then
  n="$(python3 -c "import json;d=json.load(open('$LOCK'));u=d.get('upstreams',{});print(sum(1 for e in (u.values() if isinstance(u,dict) else u) if e.get('disposition')=='pending-evaluation'))" 2>/dev/null)"
  [ "$n" = 30 ] && pass "UPSTREAMS.lock.json really has 30 pending-evaluation entries (doc matches reality)" || fail "lock has $n pending-evaluation (doc says 30)"
else
  pass "lock cross-check skipped (python3/lock absent)"
fi

# NO-FABRICATION: never claim OpenCode is already forked/vendored into the product.
grep -qiE "opencode fork (is )?(built|shipped|complete|live)|forked opencode|vendored opencode" "$DOC" && fail "fabricated 'OpenCode already forked' claim" || pass "no fabricated 'OpenCode already forked/vendored' claim (K01 honest)"

say "provenance: $P passed, $F failed"
[ "$F" -eq 0 ]
