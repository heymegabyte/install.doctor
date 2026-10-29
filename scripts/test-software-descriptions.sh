#!/usr/bin/env bash
# software.yml description quality (master-prompt §10: "verify metadata against canonical projects;
# correct fabricated or stale descriptions using evidence"). Many `_desc`/`_short` fields are
# AI-generated and some are fabricated — contradicting their own `_github` (e.g. atuin="AWS
# infrastructure", hishtory="browsing history", distrobox="custom Linux distribution").
#
# HARD gate: zero pure-hedge "It appears to be" descriptions — the clearest fabrication tell (a real
# description never hedges that the writer doesn't know the tool). Fix each against the GitHub repo's
# canonical `.description` (GET api.github.com/repos/<owner>/<repo>).
# Softer low-confidence tells are surfaced as INFO for incremental cleanup (not yet gated — too many).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SW="$ROOT/software.yml"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
P=0; F=0

say "software.yml description quality"

hedge="$(grep -cE 'It appears to be' "$SW" 2>/dev/null || true)"; hedge="${hedge:-0}"
[ "$hedge" -eq 0 ] && pass "no 'It appears to be' hedges (fabrication tell)" || fail "$hedge fabricated-hedge description(s) remain — correct against the GitHub repo .description"

# fire #96 — HARD gate on the USER-FACING _short only (shown in the App Store list/search/detail): zero
# "I don't know this tool" meta-commentary — repo-naming instead of describing ("is a GitHub repository
# for …", "is a project on GitHub by …") or a "likely/for detailed information/visit the repository"
# hedge. Fix each against the real tool (GitHub/GitLab .description). The _desc field (NOT user-facing)
# still carries this slop and is tracked as INFO below, not gated.
shortslop="$(grep -cE '^[[:space:]]*_short:.*([Ii]t likely (involves|provides|contains|is|relate)|likely (contains|related|involves|provides)|you should visit the repositor|visit the repository directly|[Ff]or (more )?detailed information|is a (project (on|hosted on) Git|GitHub repository)|This is a GitHub repository|is a GitHub repository (for|named|belonging|maintained|that|containing))' "$SW" 2>/dev/null || true)"; shortslop="${shortslop:-0}"
[ "$shortslop" -eq 0 ] && pass "user-facing _short carries no fabrication meta-commentary (App Store shows these)" || fail "$shortslop _short with fabrication slop — rewrite against the real tool (GitHub .description)"

say "softer tells (tracked for incremental correction, not gated):"
for pat in 'For more detailed information' \
           'you can (explore|visit|refer|check)[^.]*(repositor|github|website)' \
           'available on GitHub at https' \
           '_(desc|short):.*\blikely\b'; do
  printf '   info: %4s  %s\n' "$(grep -cE "$pat" "$SW" 2>/dev/null || true)" "$pat"
done

say "software.yml descriptions: $P passed, $F failed"
[ "$F" -eq 0 ]
