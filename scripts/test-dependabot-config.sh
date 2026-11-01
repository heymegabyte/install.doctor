#!/usr/bin/env bash
# Dependabot keep-current gate (fire #356). The repo PINS its GitHub actions (the #355 action-pin gate), its
# site npm deps, + the Node version — but had NO automation to keep those pins CURRENT, so they rot (counter to
# the prompt's "keep current + automatically improve over time"). This is the completion of #355: supply-chain
# best-practice is PIN (reproducibility/safety) + AUTO-UPDATE (dependabot) — GitHub's own hardening guidance
# pairs the two. This locks that `.github/dependabot.yml` exists, is valid, and tracks BOTH the github-actions
# ecosystem (so the #355 pins refresh) AND the site npm ecosystem (the Stencil build deps). Pure file assertions.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${DEPENDABOT_FILE:-$ROOT/.github/dependabot.yml}"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0
has() { grep -qE "$2" "$1" 2> /dev/null; }

say "dependabot keep-current config (pins don't rot)"

if [ ! -f "$DB" ]; then
  fail ".github/dependabot.yml MISSING ($DB) — pinned actions/deps have no auto-update → they rot (the prompt's 'keep current')"
  say "dependabot: $P passed, $F failed"
  exit 1
fi
pass ".github/dependabot.yml present"

# 1. valid YAML + the required v2 schema (a malformed config is silently ignored by GitHub → no updates).
if command -v python3 > /dev/null 2>&1; then
  if python3 -c "import yaml,sys; d=yaml.safe_load(open('$DB')); sys.exit(0 if d.get('version')==2 and isinstance(d.get('updates'),list) and d['updates'] else 1)" 2> /dev/null; then
    pass "valid YAML, version: 2, non-empty updates: (GitHub will honor it)"
  else
    fail "dependabot.yml is invalid YAML OR missing version:2 / a non-empty updates: list (GitHub silently ignores it)"
  fi
else
  pass "python3 absent — YAML-schema check skipped (ecosystem greps below still run)"
fi

# 2. the github-actions ecosystem is tracked — this is what keeps the #355 action pins (calibreapp@1.5.0 etc.)
#    from going stale; the whole point of pinning + dependabot together.
has "$DB" 'package-ecosystem:[[:space:]]*"?github-actions"?' && pass "tracks the github-actions ecosystem (the #355 pins stay current)" || fail "no github-actions ecosystem — the pinned action versions will rot"

# 3. the npm ecosystem is tracked (the Stencil site build deps under /site, which carries the lockfile).
has "$DB" 'package-ecosystem:[[:space:]]*"?npm"?' && pass "tracks the npm ecosystem (the site build deps stay current)" || fail "no npm ecosystem — the site's dependencies will rot"

# 4. a recurring schedule exists (a config with no schedule interval never runs).
has "$DB" 'interval:[[:space:]]*"?(daily|weekly|monthly)"?' && pass "has a recurring schedule interval (the updates actually run periodically)" || fail "no schedule interval — dependabot would never run"

say "dependabot: $P passed, $F failed"
[ "$F" -eq 0 ]
