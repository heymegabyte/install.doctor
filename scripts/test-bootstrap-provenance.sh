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

# CI-env defaults must RESPECT an externally-provided value (${VAR:-default}), never UNCONDITIONALLY
# overwrite it. A bare `export PRIMARY_EMAIL="brian@..."` in setCIEnvironmentVariables clobbers a secret/
# CI-provided identity, which post-postfix then uses for root-mail forwarding (.forward / aliases) — the
# #254 cross-machine class. Guard BOTH the generated provision.sh AND its template SoT (they drifted: the
# template set them unconditionally while the deployed used ${VAR:-}; fixed #258). Identity/mail vars only.
for rel in "scripts/provision.sh" "scripts/src/provision.sh.tmpl"; do
  f="$ROOT/$rel"
  envbad=""
  for v in PRIMARY_EMAIL PUBLIC_SERVICES_DOMAIN; do
    grep -qE "export $v=\"[^\$]" "$f" 2> /dev/null && envbad="$envbad $v"
  done
  [ -z "$envbad" ] \
    && pass "$rel: CI-env identity vars use \${VAR:-default} (respect a provided value, no unconditional overwrite)" \
    || fail "$rel: unconditionally overwrites CI-provided$envbad (clobbers a secret-provided identity → postfix root-mail misrouting; use \${VAR:-})"
done

# The SoT template src/provision.sh.tmpl is STALE — ~530 lines behind the hand-maintained, SERVED
# scripts/provision.sh. A gomplate regen (scripts/.gomplate.yaml: src/ -> provision.sh) would CLOBBER
# deployed-only, load-bearing functions + the #258 env-safe CI defaults. Lock BOTH halves: (1) the deployed
# keeps its critical functions (a regen/edit dropping them REDs); (2) the template carries a DO-NOT-REGENERATE
# warning so it can't silently look authoritative. Full reconciliation = a focused-session item (TOP-next). #259.
PROV="$ROOT/scripts/provision.sh"
dmiss=""
for fn in setEnvironmentVariables applyEnvClassDefaults; do
  grep -qE "^${fn}\(\)" "$PROV" 2> /dev/null || dmiss="$dmiss $fn"
done
[ -z "$dmiss" ] \
  && pass "deployed provision.sh keeps its critical hand-maintained functions (setEnvironmentVariables, applyEnvClassDefaults)" \
  || fail "deployed provision.sh is MISSING$dmiss — a stale-template regen likely clobbered it (see scripts/.gomplate.yaml)"
if grep -qE 'DO NOT REGENERATE|STALE TEMPLATE' "$ROOT/scripts/src/provision.sh.tmpl" 2> /dev/null; then
  pass "src/provision.sh.tmpl carries the STALE / DO-NOT-REGENERATE warning (won't silently clobber the served provision.sh)"
else
  fail "src/provision.sh.tmpl has NO stale/do-not-regenerate warning — a gomplate regen would clobber the served provision.sh (#259)"
fi

# partials/basic-deps (the SHARED source inlined into provision.sh's ensureBasicDeps) must stay consistent
# with the deployed's improvements: the detect_os SSOT (not an ad-hoc `[ -d /Applications ]` check) + HEADLESS
# gating around the macOS CLT/Rosetta installs (CLAUDE.md §3 cross-platform parity + headless-safety). Drift
# here = inconsistent duplicate code, and a regen would revert the deployed's improvements. #260.
bdp="$ROOT/scripts/partials/basic-deps"
if grep -qE 'detect_os' "$bdp" 2> /dev/null && grep -qE 'HEADLESS_INSTALL' "$bdp" 2> /dev/null; then
  pass "partials/basic-deps uses detect_os + HEADLESS gating (consistent with the deployed ensureBasicDeps)"
else
  fail "partials/basic-deps is STALE vs the deployed ensureBasicDeps — missing detect_os SSOT and/or HEADLESS gating (inconsistent duplicate; a regen would revert the deployed's cross-platform + headless improvements)"
fi

# More partials drifted from the deployed's detect_os SSOT (same class as basic-deps #260). Lock the ones
# reconciled #261: import-cloudflare-certificate + reboot must use detect_os, not the ad-hoc
# `[ -d /Applications ] && [ -d /System ]` check (which also carried an SC2181 `$?` test + a ||/&& precedence
# bug). full-disk-access reconciled #262 (own block below); only ensurePackageManagerHomebrew remains (#263).
pdrift=""
for pf in import-cloudflare-certificate reboot; do
  f="$ROOT/scripts/partials/$pf"
  grep -qE 'detect_os' "$f" 2> /dev/null || pdrift="$pdrift $pf(no-detect_os)"
  grep -qE '\[ -d /Applications \] && \[ -d /System \]' "$f" 2> /dev/null && pdrift="$pdrift $pf(ad-hoc-macos-check)"
done
[ -z "$pdrift" ] \
  && pass "partials import-cloudflare-certificate + reboot use the detect_os SSOT (reconciled to the deployed, no ad-hoc macOS check)" \
  || fail "partial(s) still drifted from the deployed detect_os form:$pdrift"

# full-disk-access partial (printFullDiskAccessNotice + ensureFullDiskAccess, inlined into provision.sh's
# ensureFullDiskAccess call) was the last detect_os-class partial drift: it used the ad-hoc
# `[ -d /Applications ] && [ -d /System ]` macOS check, and ensureFullDiskAccess LACKED the deployed's
# HEADLESS_INSTALL early-return (a headless Proxmox/Coolify/Qubes box would open a GUI pane it can't display
# then exit 0 — stalling provisioning). It also carried a useless-cat (SC2002) grep + a `gum log` call + a dead
# Linux sed branch. Reconciled to the deployed #262: detect_os SSOT + HEADLESS early-return + `grep -q` + `logg`
# + dropped the dead Linux branch. ensurePackageManagerHomebrew (echo-pipe + guarded chown) remains (#263).
fda="$ROOT/scripts/partials/full-disk-access"
fdabad=""
grep -qE 'detect_os' "$fda" 2> /dev/null || fdabad="$fdabad no-detect_os"
grep -qE '\[ -d /Applications \] && \[ -d /System \]' "$fda" 2> /dev/null && fdabad="$fdabad ad-hoc-macos-check"
grep -qE 'HEADLESS_INSTALL' "$fda" 2> /dev/null || fdabad="$fdabad no-HEADLESS-gating"
[ -z "$fdabad" ] \
  && pass "partials/full-disk-access uses detect_os + HEADLESS gating (reconciled to the deployed ensureFullDiskAccess, no ad-hoc macOS check)" \
  || fail "partials/full-disk-access still drifted from the deployed ensureFullDiskAccess:$fdabad"

# homebrew partial (ensurePackageManagerHomebrew, inlined into provision.sh's ensureHomebrew) was the LAST
# mapped partial drift. Two deployed improvements the partial lacked: (1) its NO-SUDO install path used a BARE
# `bash -c "$(curl …install.sh)"` — the Homebrew installer blocks on an interactive RETURN prompt, so a
# headless / no-sudo provision HANGS; the deployed pipes `echo |` into BOTH install paths (non-interactive).
# (2) its single trailing `/opt/homebrew` chown used an UNGUARDED `$USER` (empty USER → `sudo chown -R ""
# /opt/homebrew` errors); the deployed guards it `[ -n "$USER" ]` (warn-and-skip when unset), per branch.
# Reconciled to the deployed #263 → the src↔deployed PARTIAL axis is now FULLY reconciled (basic-deps #260 ·
# import-cloudflare+reboot #261 · full-disk-access #262 · homebrew #263). The other 5 homebrew fns were already
# identical. Lock: echo-pipe on BOTH install paths (count == 2) + the USER-guarded chown present.
hb="$ROOT/scripts/partials/homebrew"
hbbad=""
# -F (fixed string): the literal carries `|` + `$(` + `"` — BSD grep's BRE mishandles the mid-pattern `$(` as
# an EOL anchor and matches 0 (the macOS-grep-quirk family, cf. the `\b`-unreliable reminder), making a plain
# `grep -c` a vacuously-broken sub-check. `-Fc` matches the literal: 1 (sudo path only) now → 2 (both) on port.
[ "$(grep -Fc 'echo | bash -c "$(curl' "$hb" 2> /dev/null)" = 2 ] || hbbad="$hbbad echo-pipe-not-on-both-install-paths"
grep -qE '\[ -n "\$USER" \]' "$hb" 2> /dev/null || hbbad="$hbbad unguarded-opt-homebrew-chown"
[ -z "$hbbad" ] \
  && pass "partials/homebrew ensurePackageManagerHomebrew: echo-pipe on both install paths + USER-guarded /opt/homebrew chown (reconciled to the deployed, no interactive-hang / empty-USER chown)" \
  || fail "partials/homebrew still drifted from the deployed ensurePackageManagerHomebrew:$hbbad"

# ROBUST clone-URL coverage (#186, verify-against-source-of-truth: a gate must cover the FULL tree, not a
# hardcoded subset). The #181 checks above hardcoded scripts/provision.sh + the template, so they MISSED
# `local/provision.sh` — an unreferenced older variant (940 vs 1213 lines) that still carried the legacy
# clone URL. That dead variant was REMOVED #188 (drift-detection: unreferenced + undocumented); this glob
# stays as the durable guard so ANY future provision.sh/.tmpl variant (git ls-files, excl site/) that drifts
# to megabyte-labs is caught — the coverage no longer depends on which variants happen to exist today.
prov_legacy=0
prov_n=0
while IFS= read -r pf; do
  [ -n "$pf" ] || continue
  prov_n=$((prov_n + 1))
  grep -q 'megabyte-labs/install\.doctor' "$ROOT/$pf" && { prov_legacy=$((prov_legacy + 1)); fail "provision variant $pf carries the LEGACY megabyte-labs clone URL"; }
done < <(git -C "$ROOT" ls-files | grep -E '(^|/)provision\.sh(\.tmpl)?$' | grep -vE '^site/')
[ "$prov_legacy" -eq 0 ] && pass "no provision.sh variant carries a legacy megabyte-labs clone URL ($prov_n variants globbed)"

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
