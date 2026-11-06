#!/usr/bin/env bash
# Workflow action-pin supply-chain gate (fire #355). A GitHub Action pinned to a MOVING branch ref
# (`uses: owner/action@main|@master|@latest|…`) auto-pulls whatever that branch holds on the NEXT CI run — a
# compromised/changed upstream lands new code with the workflow's `secrets.GITHUB_TOKEN` access, no review.
# Every external action MUST be pinned to a full commit SHA. Tags are mutable names and are not a supply-chain
# boundary. Asserts zero tag/branch refs across .github/workflows/ and remains non-vacuous.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WFDIR="${WORKFLOW_DIR:-$ROOT/.github/workflows}"
EXTERNAL='uses:[[:space:]]*[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@'
FULL_SHA='uses:[[:space:]]*[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}([[:space:]]|$)'

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "workflow action-pin supply-chain (full commit SHAs only)"

if [ ! -d "$WFDIR" ]; then
  fail "no .github/workflows dir ($WFDIR)"
  say "action-pins: $P passed, $F failed"
  exit 1
fi

# 1. Non-vacuity: there ARE action refs to check (a vacuous 0-moving on an empty set is no protection).
refs="$(grep -rhoE 'uses:[[:space:]]*[A-Za-z0-9_./-]+@[A-Za-z0-9_.-]+' "$WFDIR" 2> /dev/null | wc -l | tr -d ' ')"
if [ "${refs:-0}" -ge 8 ]; then
  pass "found $refs pinned-action refs to check (gate is non-vacuous)"
else
  fail "only ${refs:-0} action refs found — grep/dir wrong, the gate would be vacuous"
fi

# 2. Every external action is a full lowercase commit SHA. Local ./ actions are outside this check.
unpinned="$(grep -rnE "$EXTERNAL" "$WFDIR" 2> /dev/null | grep -vE "$FULL_SHA" || true)"
if [ -z "$unpinned" ]; then
  pass "every external action is pinned to a full commit SHA"
else
  fail "tag/branch/short-SHA action ref(s) remain: $(printf '%s' "$unpinned" | tr '\n' ';')"
fi

say "action-pins: $P passed, $F failed"
[ "$F" -eq 0 ]
