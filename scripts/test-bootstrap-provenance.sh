#!/usr/bin/env bash
# D09/D11 — bootstrap CLONE-URL provenance gate.
#
# The `curl|bash` installer's clone/fetch URLs must point at the CANONICAL OWNED org
# `heymegabyte/install.doctor`, NEVER the legacy `megabyte-labs/install.doctor`. The legacy org name
# is a name-squat supply-chain risk: it resolves today ONLY via GitHub's transfer-redirect, and if that
# org name is ever re-registered, every default `bash <(curl -sSL https://install.doctor/start)` would
# clone an attacker-controlled repo. This guard asserts every EXECUTED clone/fetch default + the `/start`
# redirect is on the canonical org, and that the `/start` redirect targets a file that actually exists.
#
# SCOPED to install.doctor refs ONLY — `megabyte-labs` legitimately names a GCP project, a service
# account, a runner org, and other repos (gas-station/local-sites/betelgeuse/AstronVim) that are NOT part
# of this migration; the exact string `megabyte-labs/install.doctor` matches only the clone URLs.
# Out of scope (tracked in BACKLOG): ~85 stale doc-COMMENT links in post-installx @doc headers +
# package.json/README (non-executed; resolve via the transfer-redirect) + the dead /vagrant surfaces.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
P=0; F=0

say "Bootstrap clone-URL provenance (D09/D11)"

# The EXECUTED clone/fetch defaults — each must be canonical heymegabyte, never legacy megabyte-labs/install.doctor.
EXEC_FILES=(
  "scripts/provision.sh"
  "scripts/src/provision.sh.tmpl"
  "home/.chezmoi.yaml.tmpl"
  "home/.chezmoiexternal.toml.tmpl"
)
for rel in "${EXEC_FILES[@]}"; do
  f="$ROOT/$rel"
  if [ ! -f "$f" ]; then fail "$rel missing"; continue; fi
  if grep -q 'megabyte-labs/install\.doctor' "$f"; then
    fail "$rel still references the LEGACY megabyte-labs/install.doctor clone URL (name-squat risk)"
  else
    pass "$rel: no legacy megabyte-labs/install.doctor clone URL"
  fi
done

# provision.sh + its template must default START_REPO to the canonical org (positive assertion, not just absence).
for rel in "scripts/provision.sh" "scripts/src/provision.sh.tmpl"; do
  grep -q 'START_REPO="https://github.com/heymegabyte/install.doctor.git"' "$ROOT/$rel" \
    && pass "$rel: default START_REPO = canonical heymegabyte" \
    || fail "$rel: default START_REPO is not the canonical heymegabyte clone URL"
done

# ROBUST clone-URL coverage (#186, verify-against-source-of-truth: a gate must cover the FULL tree, not a
# hardcoded subset). The #181 checks above hardcoded scripts/provision.sh + the template, so they MISSED
# `local/provision.sh` — an unreferenced older variant (940 vs 1213 lines) that still carried the legacy
# clone URL. Glob EVERY provision.sh/.tmpl variant (git ls-files, excl site/) → NONE may be on megabyte-labs.
prov_legacy=0
prov_n=0
while IFS= read -r pf; do
  [ -n "$pf" ] || continue
  prov_n=$((prov_n + 1))
  grep -q 'megabyte-labs/install\.doctor' "$ROOT/$pf" && { prov_legacy=$((prov_legacy + 1)); fail "provision variant $pf carries the LEGACY megabyte-labs clone URL"; }
done < <(git -C "$ROOT" ls-files | grep -E '(^|/)provision\.sh(\.tmpl)?$' | grep -vE '^site/')
[ "$prov_legacy" -eq 0 ] && pass "no provision.sh variant carries a legacy megabyte-labs clone URL ($prov_n variants globbed, incl local/)"

# The /start firebase redirect must serve from the canonical org AND target a file that EXISTS (no dangling redirect).
FB="$ROOT/site/firebase.json"
if [ -f "$FB" ]; then
  start_dest="$(grep -A2 '"/start"' "$FB" | grep -oE 'https://raw.githubusercontent.com/[^"]+' | head -1)"
  case "$start_dest" in
    *heymegabyte/install.doctor/*) pass "/start redirect serves from canonical heymegabyte" ;;
    *) fail "/start redirect not on canonical heymegabyte: $start_dest" ;;
  esac
  # the target path (scripts/<file>) must exist in the repo — a redirect to a non-existent file is dangling
  tgt_file="${start_dest##*/master/}"
  if [ -n "$tgt_file" ] && [ -f "$ROOT/$tgt_file" ]; then
    pass "/start redirect targets an existing file ($tgt_file)"
  else
    fail "/start redirect targets a NON-existent file ($tgt_file) — dangling"
  fi
else
  fail "site/firebase.json missing"
fi

# NO DANGLING REDIRECT — every install.doctor redirect in firebase.json must target a scripts/<file> that
# EXISTS in the repo (generalizes the /start check to ALL redirects). A 301 to a non-existent file is a dead
# redirect the user hits as a 404 — the /vagrant + /vagrant-windows redirects pointed at vagrant.sh/.ps1
# which exist nowhere (Vagrant is not a v2 feature), removed #182. Locks out any future dangling redirect.
if [ -f "$FB" ]; then
  dangling=0; checked=0
  while IFS= read -r dest; do
    rel_tgt="${dest##*/install.doctor/master/}"
    checked=$((checked + 1))
    [ -f "$ROOT/$rel_tgt" ] || { dangling=$((dangling + 1)); fail "firebase redirect → NON-existent $rel_tgt (dangling)"; }
  done < <(grep -oE 'https://raw.githubusercontent.com/[^"]+install.doctor/master/[^"]+' "$FB")
  [ "$dangling" -eq 0 ] && pass "no dangling firebase redirects ($checked install.doctor redirect target(s) all exist)"
  # the dead Vagrant redirects must be GONE (the landing-page Vagrant surfaces are scoped to #183 — need a site build).
  grep -qE '"/vagrant(-windows)?"' "$FB" && fail "dead /vagrant redirect still present (removed #182)" || pass "dead /vagrant + /vagrant-windows redirects removed"
fi

say "bootstrap-provenance: $P passed, $F failed"
[ "$F" -eq 0 ]
