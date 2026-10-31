#!/usr/bin/env bash
# Workflow action-pin supply-chain gate (fire #355). A GitHub Action pinned to a MOVING branch ref
# (`uses: owner/action@main|@master|@latest|…`) auto-pulls whatever that branch holds on the NEXT CI run — a
# compromised/changed upstream lands new code with the workflow's `secrets.GITHUB_TOKEN` access, no review.
# Every action MUST be pinned to an immutable TAG or SHA (GitHub's own hardening guidance + the repo's #298
# chezmoiexternal floating-ref discipline, now applied to ACTION refs). Asserts ZERO moving-branch action refs
# across .github/workflows/. Non-vacuous (asserts it actually found refs to check). No `\b` (BSD-grep-unsafe —
# ledger reminder); a trailing boundary-char alternation avoids false-matching a tag like @maintenance. File-only.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WFDIR="${WORKFLOW_DIR:-$ROOT/.github/workflows}"
MOVING='uses:[[:space:]]*[A-Za-z0-9_./-]+@(main|master|latest|develop|trunk|HEAD)($|[^A-Za-z0-9._-])'

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "workflow action-pin supply-chain (no moving @branch refs)"

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

# 2. ZERO moving-branch refs — every `uses:` must be an immutable tag/SHA.
moving="$(grep -rnE "$MOVING" "$WFDIR" 2> /dev/null || true)"
if [ -z "$moving" ]; then
  pass "every action is pinned to an immutable tag/SHA — 0 moving-branch (@main/@master/…) refs"
else
  fail "moving-branch action ref(s) — pin each to a release tag or SHA (supply-chain): $(printf '%s' "$moving" | tr '\n' ';')"
fi

say "action-pins: $P passed, $F failed"
[ "$F" -eq 0 ]
