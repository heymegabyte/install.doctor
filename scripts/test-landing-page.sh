#!/usr/bin/env bash
# M-series — landing-page install-method integrity (the install.doctor homepage, site/).
#
# The landing page advertises the install one-liners; a command it shows a user MUST resolve, and the
# numbered `started__list` (site/src/store.ts) is index-paired with the `panels` array in
# landing-page.tsx (rendered `started__list.map((...,i) => panels[i])`) — so removing one requires
# removing BOTH at the same index AND renumbering the displayed `number` strings to stay sequential.
# #183 removed the dead Vagrant method — panels[2] + started__list[2] ('03', "Test it out in a VM with
# Vagrant") whose /vagrant + /windows-vagrant commands 404 (vagrant.sh/.ps1 exist nowhere; the firebase
# redirects were removed #182) — and renumbered 04..07 -> 03..06.
#
# Pure FILE assertions — `site/node_modules` is absent locally (volta can't fetch the pinned node), so
# the authoritative Stencil build-verify runs in CI at deploy time (CI downloads node fine).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LP="$ROOT/site/src/pages/landing-page/landing-page.tsx"
STORE="$ROOT/site/src/store.ts"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
P=0; F=0

say "Landing-page install-method integrity (M)"

# 1. no dead Vagrant commands shown to users + the PowerShell HEADLESS_INSTALL spillover fix
if [ -f "$LP" ]; then
  grep -qE 'install\.doctor/(vagrant|windows-vagrant)' "$LP" \
    && fail "landing page shows a dead /vagrant command (removed #183)" \
    || pass "no dead /vagrant + /windows-vagrant commands on the landing page"
  # PowerShell: bare `true` is not a boolean literal (it reads as a command) — must be the quoted string 'true'
  # (provision.ps1 checks `-eq 'true'`). This was a latent bug on the Windows headless example.
  grep -qE '\$env:HEADLESS_INSTALL = true([^A-Za-z0-9_'"'"']|$)' "$LP" \
    && fail "bare \$env:HEADLESS_INSTALL = true (PowerShell needs the quoted string 'true')" \
    || pass "\$env:HEADLESS_INSTALL uses a quoted string (valid PowerShell)"
else
  fail "landing-page.tsx missing ($LP)"
fi

# 2. store.ts started__list: no Vagrant entry + numbers stay sequential after the renumber
if [ -f "$STORE" ]; then
  grep -qF 'Test it out in a VM with Vagrant' "$STORE" \
    && fail "store.ts still has the Vagrant started__list entry (removed #183)" \
    || pass "store.ts: Vagrant started__list entry removed"
  nums="$(grep -oE "number: '[0-9]+'" "$STORE" | grep -oE '[0-9]+' | tr '\n' ' ')"
  if [ "$nums" = "01 02 03 04 05 06 " ]; then
    pass "started__list numbers sequential 01..06 (no gap/dup after the Vagrant removal + renumber)"
  else
    fail "started__list numbers not sequential 01..06 (got: [$nums]) — renumber 04..07 -> 03..06 incomplete"
  fi
else
  fail "store.ts missing ($STORE)"
fi

# 3. Canonical-org provenance (#187): the SERVED user-facing GitHub links (Fork/github/discussions in
# store.ts + the doc-gen URLs in markdown.sh) must point at the canonical heymegabyte org — a legacy
# github.com/megabyte-labs/install.doctor Fork link makes a visitor FORK THE WRONG REPO. (The `gitlab`
# social/CTA links are DELIBERATE + LIVE — gitlab.com/megabyte-labs/install.doctor resolves 200; only the
# GITHUB org moved to heymegabyte, NOT the GitLab mirror. Asserted PRESENT below (#4), never removed.)
grep -q 'github\.com/megabyte-labs/install\.doctor' "$STORE" \
  && fail "store.ts has a LEGACY github.com/megabyte-labs/install.doctor user-facing link (wrong repo)" \
  || pass "store.ts: no legacy megabyte-labs GitHub link (Fork/github/discussions canonical)"
MDGEN="$ROOT/site/docs/scripts/markdown.sh"
if [ -f "$MDGEN" ]; then
  grep -q 'github\.com/megabyte-labs/install\.doctor' "$MDGEN" \
    && fail "markdown.sh (generate-plugin-docs) emits legacy megabyte-labs GitHub URLs into generated docs" \
    || pass "markdown.sh: no legacy megabyte-labs GitHub URLs"
fi

# 4. DELIBERATE GitLab mirror (#188): the project KEEPS a live GitLab presence — the "Connect on GitLab"
# content block (store.ts) explicitly invites users there, and gitlab.com/megabyte-labs/install.doctor
# verified 200 (org page + raw README). The #187 BACKLOG wrongly recommended DROPPING this link on a
# FALSE "the project left gitlab" premise — reconciled #188. Assert the social link is PRESENT so a
# future fire can't re-make that wrong removal (the GitHub org moving to heymegabyte does NOT move the
# GitLab mirror — gitlab stays megabyte-labs).
grep -qF "gitlab: 'https://gitlab.com/megabyte-labs/install.doctor'" "$STORE" \
  && pass "store.ts: deliberate live GitLab mirror link present (kept by design — the project did NOT leave gitlab)" \
  || fail "store.ts: the deliberate GitLab mirror social link was removed (it is a live 200 mirror — keep it; see #188)"

say "landing-page: $P passed, $F failed"
[ "$F" -eq 0 ]
