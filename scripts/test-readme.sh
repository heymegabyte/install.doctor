#!/usr/bin/env bash
# X01/X05/X14 — the README must describe the ACTUAL v2 product (not only the legacy provisioning
# blueprint): the deployed app, the pairing + dashboard, the real `aid` CLI, eager-vs-lazy install,
# and an HONEST live-vs-blocked status. This gate asserts those anchors are present + correct.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="$ROOT/README.md"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
P=0; F=0
has(){ grep -qiE "$1" "$R"; }

say "README v2-product gate (X01/X05/X14)"

[ -f "$R" ] && pass "README.md present" || { fail "README.md missing"; echo "0 passed"; exit 1; }
has 'app\.install\.doctor' && pass "names the deployed app (app.install.doctor)" || fail "no app.install.doctor"
has 'install\.doctor/start' && pass "shows the real bootstrap one-liner (install.doctor/start)" || fail "no bootstrap one-liner"
has 'aid-pair' && pass "documents browser-first pairing (aid-pair)" || fail "no aid-pair"
{ has 'aid status' && has 'aid (exec|prewarm|installs)'; } && pass "documents the real aid CLI subcommands" || fail "aid CLI subcommands missing"
{ has 'Machines' && has 'App Store' && has 'Recommendations' && has 'History'; } && pass "lists the live dashboard sections" || fail "dashboard sections missing"
{ has 'eager' && has 'lazy'; } && pass "explains eager-vs-lazy install (X05)" || fail "eager-vs-lazy not explained"
has 'command-not-found' && pass "documents the lazy CLI command-not-found installer" || fail "no command-not-found mention"
{ has 'Better Auth' && has 'blocked|not yet|pending|awaiting'; } && pass "HONEST status — names blocked/pending work (X14)" || fail "no honest blocked/pending status"
has 'chezmoi' && pass "keeps the installer layer (chezmoi) documented" || fail "chezmoi (installer layer) dropped"

say "readme: $P passed, $F failed"
[ "$F" -eq 0 ]
