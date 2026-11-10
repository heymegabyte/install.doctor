#!/usr/bin/env bash
# D09/D11 — bootstrap CLONE-URL provenance gate.
#
# The `curl|bash` installer's clone/fetch URLs must point at the CANONICAL OWNED org
# `heymegabyte/install.doctor`, NEVER the legacy `megabyte-labs/install.doctor`. The legacy org name
# is a name-squat supply-chain risk: it resolves today ONLY via GitHub's transfer-redirect, and if that
# org name is ever re-registered, every default `curl -fsSL https://app.install.doctor/start | bash` would
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

# The canonical provisioner must default START_REPO to the canonical org.
for rel in "scripts/provision.sh"; do
  grep -q 'START_REPO="https://github.com/heymegabyte/install.doctor.git"' "$ROOT/$rel" \
    && pass "$rel: default START_REPO = canonical heymegabyte" \
    || fail "$rel: default START_REPO is not the canonical heymegabyte clone URL"
done

# CI-env defaults must RESPECT an externally-provided value (${VAR:-default}), never UNCONDITIONALLY
# overwrite it. A bare `export PRIMARY_EMAIL="brian@..."` in setCIEnvironmentVariables clobbers a secret/
# CI-provided identity, which post-postfix then uses for root-mail forwarding (.forward / aliases) — the
# #254 cross-machine class. Guard the single authored provisioner. Identity/mail vars only.
for rel in "scripts/provision.sh"; do
  f="$ROOT/$rel"
  envbad=""
  for v in PRIMARY_EMAIL PUBLIC_SERVICES_DOMAIN; do
    grep -qE "export $v=\"[^\$]" "$f" 2> /dev/null && envbad="$envbad $v"
  done
  [ -z "$envbad" ] \
    && pass "$rel: CI-env identity vars use \${VAR:-default} (respect a provided value, no unconditional overwrite)" \
    || fail "$rel: unconditionally overwrites CI-provided$envbad (clobbers a secret-provided identity → postfix root-mail misrouting; use \${VAR:-})"
done

# The served provisioner is the single source of truth. Keep its critical functions and reject reintroduction
# of the stale generator template that previously could clobber them.
PROV="$ROOT/scripts/provision.sh"
dmiss=""
for fn in setEnvironmentVariables applyEnvClassDefaults; do
  grep -qE "^${fn}\(\)" "$PROV" 2> /dev/null || dmiss="$dmiss $fn"
done
[ -z "$dmiss" ] \
  && pass "deployed provision.sh keeps its critical hand-maintained functions (setEnvironmentVariables, applyEnvClassDefaults)" \
  || fail "deployed provision.sh is MISSING$dmiss"
if [ ! -e "$ROOT/scripts/src/provision.sh.tmpl" ]; then
  pass "stale provision.sh generator template remains absent"
else
  fail "stale provision.sh generator template was reintroduced"
fi

# provision.sh OS detection is a SOURCE-ELSE-INLINE pattern (#266, verify-against-source + the prompt's "no
# duplicate code"): it SOURCES the detect_os SSOT `scripts/lib/detect_os.sh` when present (cloned-repo → consumes
# the SSOT, CLAUDE.md §9 #2), ELSE defines an INLINE fallback `detect_os()`. That inline copy is LOAD-BEARING,
# NOT removable duplicate code: on a fresh `curl|bash` box ONLY provision.sh exists (the user never fetched
# scripts/lib/), so the `[ -f …/lib/detect_os.sh ]` test is FALSE and the inline fallback is the ONLY detect_os.
# A naive "dedup" that drops the inline branch would break curl|bash provisioning (detect_os undefined → every
# call fails). Lock BOTH halves. (The residual ad-hoc OS checks in the secondary entrypoints homebrew.sh /
# cloudflared-ssh.sh are the macOS branch of a PACKAGE-MANAGER chain — pacman/zypper/apk/macOS/cygwin/freebsd —
# that detect_os's macos|ubuntu|… can't express, so they are CORRECT self-contained idioms, NOT migration drift:
# #266 verified, do NOT churn them.) Non-vacuity: drop the source line OR the inline detect_os() → a half fails.
PROVOS="$ROOT/scripts/provision.sh"
ifl="$(grep -nE 'if \[ -f "\$SCRIPT_DIR/lib/detect_os\.sh" \]; then' "$PROVOS" 2> /dev/null | head -1 | cut -d: -f1)"
srcl="$(grep -nE 'source "\$SCRIPT_DIR/lib/detect_os\.sh"' "$PROVOS" 2> /dev/null | head -1 | cut -d: -f1)"
elsel="$(awk -v s="${ifl:-0}" 'NR>s && /^else$/{print NR; exit}' "$PROVOS" 2> /dev/null)"
fbl="$(awk -v s="${elsel:-0}" 'NR>s && /detect_os\(\) \{/{print NR; exit}' "$PROVOS" 2> /dev/null)"
{ [ -n "$ifl" ] && [ -n "$srcl" ]; } \
  && pass "provision.sh SOURCES the detect_os SSOT (scripts/lib/detect_os.sh) when present — consumes it in a cloned repo (CLAUDE.md §9 #2, no duplicate)" \
  || fail "provision.sh no longer sources the detect_os SSOT — the #2 consume-the-SSOT state regressed"
{ [ -n "$elsel" ] && [ -n "$fbl" ]; } \
  && pass "provision.sh keeps the INLINE detect_os() fallback in the else branch (L$fbl) — LOAD-BEARING for curl|bash (a fresh box has no scripts/lib/; do NOT 'dedup' it away)" \
  || fail "provision.sh LOST its inline detect_os() fallback — a fresh curl|bash box (no scripts/lib/detect_os.sh) would have detect_os UNDEFINED; restore the else-branch fallback"

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

# basic-deps is THE primary prerequisites installer (inlined into the curl|bash /start entrypoint, runs FIRST),
# so its Alpine apk branch is LOAD-BEARING: without it a fresh `curl|bash` on Alpine (a supported fleet role,
# CLAUDE.md §2) can't install curl/git/build-base → provisioning dies at step 1. The #270 SYSTEMATIC Alpine
# sweep confirmed the critical path is Alpine-covered (basic-deps apk + #267 cron `apk upgrade` + #268 cnf apk +
# #269 WARP `update-ca-certificates`) — lock the primary bootstrap path so it can't regress. (The one remaining
# Alpine gap — run_before_04's secondary `$packages` installer has no alpine branch — is a LOWER-impact BACKLOG
# item: core deps are basic-deps' job, and the rest of the sweep's hits were false positives: display/config,
# the Qubes path [Fedora/Debian templates, not Alpine], and the legacy ansible layer.)
if grep -qE 'apk add .*build-base.*curl.*git' "$bdp" 2> /dev/null; then
  pass "partials/basic-deps has the Alpine apk branch (apk add build-base curl expect git … — the primary curl|bash prerequisites installer bootstraps Alpine)"
else
  fail "partials/basic-deps LOST its Alpine apk branch — a fresh curl|bash on Alpine (supported fleet role) can't install core prerequisites; restore 'elif command -v apk' → apk add build-base curl ..."
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
# mapped partial drift. The installer is downloaded from one immutable commit into a local file and run with
# NONINTERACTIVE=1 on both paths; no moving HEAD or command-substitution execution is permitted.
# (2) its single trailing `/opt/homebrew` chown used an UNGUARDED `$USER` (empty USER → `sudo chown -R ""
# /opt/homebrew` errors); the deployed guards it `[ -n "$USER" ]` (warn-and-skip when unset), per branch.
# Reconciled to the deployed #263 → the src↔deployed PARTIAL axis is now FULLY reconciled (basic-deps #260 ·
# import-cloudflare+reboot #261 · full-disk-access #262 · homebrew #263). The other 5 homebrew fns were already
# identical. Lock: pinned helper on BOTH install paths (count == 2) + the USER-guarded chown present.
hb="$ROOT/scripts/partials/homebrew"
hbbad=""
grep -qF "commit='959bdd728192d78c47287c177796c3d86d111f09'" "$hb" 2>/dev/null || hbbad="$hbbad pinned-homebrew-commit-missing"
[ "$(grep -Fc 'runPinnedHomebrewInstaller || BREW_EXIT_CODE="$?"' "$hb" 2> /dev/null)" = 2 ] || hbbad="$hbbad pinned-installer-not-on-both-install-paths"
grep -qE '\[ -n "\$USER" \]' "$hb" 2> /dev/null || hbbad="$hbbad unguarded-opt-homebrew-chown"
[ -z "$hbbad" ] \
  && pass "partials/homebrew: immutable noninteractive installer on both paths + USER-guarded /opt/homebrew chown" \
  || fail "partials/homebrew still drifted from the deployed ensurePackageManagerHomebrew:$hbbad"

# CHEZMOISCRIPT headless-safety (#264, verify-against-source): the run_* chezmoiscript scan found they are NOT
# the partial-drift class — their ad-hoc `[ -d /Applications ] && [ -d /System ]` macOS check is the CORRECT
# self-contained idiom (detect_os is NOT in a chezmoiscript's scope; chezmoi renders per-host), and their bare
# `$DEBUG`/`$DEBUG_MODE` is a harmless pervasive idiom (the universal/profile* preambles set NO `set -u`, unlike
# the post-installx hooks that A10 covers). So NEITHER is drift — do NOT "fix" them (fabricated churn). The ONE
# genuinely-lockable invariant: the interactive Full-Disk-Access System-Settings pane-open in run_before_01-prepare
# MUST stay HEADLESS-gated (the #262 class on the chezmoiscript surface) — else a headless Proxmox/Coolify/Qubes
# macOS provision opens a GUI pane it can't display. (2 uncertain host-gated HEADLESS candidates it surfaced —
# xcode-select --install [02-homebrew] + the foreground osascript default-browser [20-post-install] — are BACKLOG,
# not force-fixed in-loop.) Non-vacuity: the only HEADLESS guard between the enclosing fn header and the open is
# the FDA early-return; remove it and this fails.
pf="$ROOT/home/.chezmoiscripts/universal/run_before_01-prepare.sh.tmpl"
ol="$(grep -n 'open "x-apple.systempreferences' "$pf" 2> /dev/null | head -1 | cut -d: -f1)"
if [ -z "$ol" ]; then
  fail "run_before_01-prepare: the FDA System-Settings pane-open was not found (code changed — re-verify HEADLESS gating)"
else
  fs="$(awk -v o="$ol" 'NR<=o && /^[a-zA-Z_][a-zA-Z0-9_]*\(\)[ ]*\{/{ln=NR} END{print ln}' "$pf")"
  if awk -v a="$fs" -v b="$ol" 'NR>a && NR<b && /HEADLESS_INSTALL/{g=1} END{exit g?0:1}' "$pf"; then
    pass "run_before_01-prepare FDA pane-open (L$ol) is HEADLESS-gated inside its fn (L$fs) — an interactive macOS op can't hang a headless provision (#262 class on the chezmoiscript surface)"
  else
    fail "run_before_01-prepare FDA pane-open (L$ol) has NO HEADLESS_INSTALL guard in its enclosing fn (L$fs) — a headless macOS provision would open a GUI pane it can't display"
  fi
fi

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
  [ -f "$ROOT/$pf" ] || continue
  prov_n=$((prov_n + 1))
  grep -q 'megabyte-labs/install\.doctor' "$ROOT/$pf" && { prov_legacy=$((prov_legacy + 1)); fail "provision variant $pf carries the LEGACY megabyte-labs clone URL"; }
done < <(git -C "$ROOT" ls-files | grep -E '(^|/)provision\.sh(\.tmpl)?$' | grep -vE '^site/')
[ "$prov_legacy" -eq 0 ] && pass "no provision.sh variant carries a legacy megabyte-labs clone URL ($prov_n variants globbed)"

# The public /start route must converge on the signed-manifest stage zero and
# never bypass verification by redirecting directly to a moving Git ref.
FB="$ROOT/site/firebase.json"
if [ -f "$FB" ]; then
  start_dest="$(grep -A2 '"/start"' "$FB" | grep -oE 'https://[^"]+' | head -1)"
  if [ "$start_dest" = 'https://app.install.doctor/start' ]; then
    pass "/start redirects to the canonical signed stage-zero endpoint"
  else
    fail "/start bypasses the canonical signed stage zero: $start_dest"
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
  [ "$dangling" -eq 0 ] && pass "no dangling raw-script redirects ($checked remaining install.doctor redirect target(s) all exist)"
  # the dead Vagrant redirects must be GONE (the landing-page Vagrant surfaces are scoped to #183 — need a site build).
  grep -qE '"/vagrant(-windows)?"' "$FB" && fail "dead /vagrant redirect still present (removed #182)" || pass "dead /vagrant + /vagrant-windows redirects removed"
fi

# NO-ORPHAN scripts/*.sh (#265 — operationalizes the prompt's "remove unnecessary files / no dead code" as a
# deterministic gate; drift-detection § dead code). #232 manually confirmed 0 orphans + characterized the FP
# risk (a script referenced only DYNAMICALLY / non-textually) — so this promotes that manual scan to an auto-gate
# using the STRONGEST, lowest-FP signal: a top-level scripts/*.sh that is NOT a test-*.sh, NOT one of the 4
# served/harness entrypoints, AND has ZERO textual references to its basename anywhere else in the tracked tree
# is a true orphan (dead code to remove or wire). The fleet-role/util scripts (audit-deprecated, cloudflared-
# opnsense, drift-check, generate-sbom, pfsense, qubes-provision, validate-software-yml, …) all carry refs
# (README / Taskfile / CI) → correctly NOT flagged. Non-vacuity: a candidate-count sanity assert guards the
# classifier from vacuously excluding all; proven #265 by planting a zero-reference probe script → RED,
# removing it → GREEN. git grep --fixed-strings so a basename with regex chars can't mis-match. NOTE: candidate
# basenames are named here WITHOUT the `.sh` extension on purpose — the detector greps the full `<name>.sh`, so
# a bare "<name>" mention in this comment can't become a self-reference that masks a future real orphan.
ORPHAN_ENTRY="provision.sh homebrew.sh cloudflared-ssh.sh test-all.sh"
orphan_hits=""
orphan_cand=0
for f in "$ROOT"/scripts/*.sh; do
  b="$(basename "$f")"
  case "$b" in test-*.sh) continue ;; esac
  skip=0
  for e in $ORPHAN_ENTRY; do [ "$b" = "$e" ] && skip=1; done
  [ "$skip" = 1 ] && continue
  orphan_cand=$((orphan_cand + 1))
  # Scan the current worktree, not only the Git index. Release tooling is
  # generated and validated before its first commit, and treating a real
  # untracked caller/documentation reference as absent makes this gate report
  # a false orphan during the release build itself.
  tracked_refs="$(git -C "$ROOT" grep -IlF "$b" -- . ":(exclude)scripts/$b" 2>/dev/null | wc -l | tr -d ' ')"
  untracked_refs="$(git -C "$ROOT" ls-files --others --exclude-standard -z \
    | xargs -0 grep -IlF -- "$b" 2>/dev/null \
    | wc -l | tr -d ' ')"
  refs=$((tracked_refs + untracked_refs))
  [ "$refs" = 0 ] && orphan_hits="$orphan_hits $b"
done
[ "$orphan_cand" -ge 4 ] \
  && pass "no-orphan scan classified $orphan_cand candidate scripts/*.sh (non-test, non-entrypoint — exclusions are non-vacuous)" \
  || fail "no-orphan scan found only $orphan_cand candidates — the test-*/entrypoint exclusion likely over-matched (vacuous scan)"
[ -z "$orphan_hits" ] \
  && pass "no orphan scripts/*.sh (every non-test/non-entrypoint script has >=1 textual reference — no dead code)" \
  || fail "ORPHAN scripts/*.sh (zero textual references — dead code, remove or wire up):$orphan_hits"

# Unsupported providers are explicit failures, never successful no-ops. Their
# acquisition authority must be migrated to a verified adapter or typed
# immutable artifact before selection.
IX="$ROOT/home/dot_local/bin/executable_installx"
if grep -qF "catalog provider '\${key}' has no verified check/apply/verify adapter" "$IX" 2> /dev/null \
  && grep -qF "throw new Error(\`catalog provider" "$IX" 2> /dev/null; then
  pass "installx fails closed on providers without verified check/apply/verify adapters"
else
  fail "installx can silently succeed on a provider without a verified adapter"
fi

# installx has ZERO behavioral coverage (#272) — lock its two PROMPT-CENTRAL invariants. (1) The lazy/MINIMUM-
# install gate (the prompt's "install closer to the minimum … lazy loading … only pre-load what needs pre-config
# or desktop apps"): `--lazy` installs items flagged `_preload: true` plus service packages explicitly selected
# in the immutable desired-state plan, leaving every other CLI for the cnf hook to lazy-install on demand. If the
# `_preload` gate were dropped, `--lazy` could install EVERYTHING → the minimum-install promise breaks SILENTLY.
# (2) Headless-safety (CLAUDE.md §3): on a headless box
# `--lazy` must SKIP GUI apps (`_app`/flatpak/appimage → false), never pull a desktop app onto a server.
if grep -qF 'customArgv.lazy' "$IX" 2> /dev/null \
  && grep -qF 'return !!x._preload || selectedPackageKeys.has(x.listKey) || selectedServiceKeys.has(x.listKey)' "$IX" 2> /dev/null; then
  pass "installx --lazy gates on _preload plus explicitly selected packages and service dependencies (all other tools lazy-load via cnf)"
else
  fail "installx --lazy no longer gates on _preload — minimum-install would regress to installing EVERYTHING (breaks the prompt's 'install closer to the minimum')"
fi
if grep -qF 'x._app || x.flatpak || x.appimage' "$IX" 2> /dev/null; then
  pass "installx headless --lazy SKIPS GUI apps (_app/flatpak/appimage → false) — a headless provision never pulls desktop apps (CLAUDE.md §3)"
else
  fail "installx headless --lazy no longer skips GUI apps — a headless box would try to install desktop apps; restore the _app/flatpak/appimage skip"
fi

say "bootstrap-provenance: $P passed, $F failed"
[ "$F" -eq 0 ]
