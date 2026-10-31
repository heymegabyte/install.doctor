#!/usr/bin/env bash
# Dead removed-tool guard (new-arc "cycle every file, remove what doesn't serve the project" sweep, fire #199).
# CLAUDE.md §6 drops bash-it (zsh+zinit is the everywhere shell) and Mackup (chezmoi owns every dotfile it
# touched; unmaintained since 2024). Retaining their ACTIVE install/config code is dead weight that runs on
# every provision for no benefit. This guard asserts the LIVE provisioning surfaces carry NO active reference
# to them, so a future edit can't silently reintroduce the dead path. Pure file assertions, no network.
#
# Scope = real provisioning code only. EXCLUDES: *.md docs, scripts/test-*.sh (assertion strings name the
# tools deliberately), and comment lines (a historical "<tool> was dropped" note is legitimate documentation).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "dead removed-tool guard (bash-it + Mackup §6 · Nix + MacPorts §7)"

# The live provisioning surfaces to scan (NOT the test suite, NOT docs).
SURFACES="home/.chezmoiscripts home/dot_local/bin home/dot_config/shell scripts/partials"

# grep for an ACTIVE-code pattern across SURFACES, dropping comment-only lines + the guard's own test dir.
# Returns the matching "file:line: text" hits (empty = clean).
activeHits() {
  grep -rnE "$1" $SURFACES 2>/dev/null \
    | grep -vE '\.md:' \
    | grep -vE '/test-[a-z-]+\.sh:' \
    | grep -vE ':[0-9]+:[[:space:]]*#' \
    || true
}

# 1. bash-it — the whole bashItPlugins() subsystem (install + powerline + ble.sh + enable completions/plugins).
bi="$(activeHits 'bashItPlugins|bash-it (enable|install)|command -v bash-it|\$BASH_IT/install\.sh')"
if [ -z "$bi" ]; then pass "no active bash-it code in provisioning surfaces (§6: zsh+zinit is the everywhere shell)"; else fail "active bash-it code remains:"; printf '%s\n' "$bi" | head -6; fi

# 2. Mackup — the backup-apps wrapper invoked it; the whole wrapper is dead now Mackup is dropped.
mk="$(activeHits 'command -v mackup|mackup (backup|restore)|\bmackup\b')"
if [ -z "$mk" ]; then pass "no active Mackup code in provisioning surfaces (§6: chezmoi owns the dotfiles)"; else fail "active Mackup code remains:"; printf '%s\n' "$mk" | head -6; fi

# 3. the backup-apps Mackup wrapper file is deleted (it served no purpose without Mackup).
if [ ! -f home/dot_local/bin/executable_backup-apps.tmpl ]; then pass "executable_backup-apps.tmpl (Mackup wrapper) removed"; else fail "executable_backup-apps.tmpl still present (dead Mackup wrapper)"; fi

# 3b (#284). the Mackup CONFIG dir must also be gone — it deployed `~/.config/mackup` (a .mackup.cfg + per-app
#   .cfg set + README) to EVERY machine for a tool §6 dropped + provisioning never installs; nothing active reads
#   it (the wrapper above is deleted), so it's pure dead deployed weight (prompt: remove unnecessary files +
#   install closer to the minimum). The software.yml catalog entry stays (deploy-gated regen) + the historical
#   Qubes-Ansible `roles/system/mackup` ref stays (externally-resolved, CLAUDE.md §5 keep) — separate lifecycles.
if [ ! -d home/dot_config/mackup ]; then pass "no deployed Mackup config dir (home/dot_config/mackup removed — §6 dead-tool config no longer ships to every machine)"; else fail "home/dot_config/mackup/ still present — a removed tool's config deploys to every machine (remove it; §6 chezmoi owns the dotfiles)"; fi

# 3c (#286). the Whalebrew config orphan must be gone — `home/dot_config/brew/whalebrew` was a 1-byte newline-only
#   file deploying to `~/.config/brew/whalebrew` on EVERY machine for Whalebrew, REMOVED in d8171e6c (§7 removed
#   table: niche + broke regularly → docker compose). Brewfile.tmpl doesn't reference it + nothing active reads it
#   — pure dead deployed weight (sibling of the #284 mackup config removal). The Brewfile.tmpl itself stays (live).
if [ ! -e home/dot_config/brew/whalebrew ]; then pass "no deployed Whalebrew config orphan (home/dot_config/brew/whalebrew removed — §7 dead-tool residue)"; else fail "home/dot_config/brew/whalebrew still present — a removed tool's config deploys to every machine (remove it; §7 Whalebrew dropped d8171e6c)"; fi

# 4. the bash-it call sites in the post-install dispatch are gone (both the sync + the parallel branch).
if ! grep -qE 'bashItPlugins' home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl 2>/dev/null; then
  pass "post-install dispatch no longer calls bashItPlugins (sync + parallel branches clean)"
else
  fail "run_after_20-post-install still references bashItPlugins"
fi

# 4b (#285). the dead bash-it SOURCE block in the deployed dot_bashrc must be gone. §6 dropped bash-it (zsh+zinit
#   is the everywhere shell) + §4 purged the post-install DISPATCH — but dot_bashrc still exported BASH_IT /
#   BASH_IT_THEME + had a `[ -f "$BASH_IT/bash_it.sh" ]`-guarded prompt branch (permanently false, bash-it is never
#   installed) that deployed to every bash machine. Check ACTIVE code only (comments mentioning bash-it are fine).
if ! grep -vE '^[[:space:]]*#' home/dot_bashrc | grep -qE 'BASH_IT|bash_it\.sh'; then
  pass "dot_bashrc has no active bash-it code (dead BASH_IT prompt branch removed — §6, oh-my-posh is the bash prompt)"
else
  fail "dot_bashrc still has an active bash-it source block (BASH_IT / bash_it.sh) — a dead §6 branch deployed to every bash machine"
fi

# 4c (#287). the Antigen chezmoiexternal download must be gone. antigen was §7-removed (2f9ab27c: zinit turbo
#   replaces it — "reparsed 88 bundles every shell launch") + dot_zshrc uses zinit, nothing sources it. But
#   .chezmoiexternal.toml.tmpl still FETCHED antigen.zsh from GitHub to ~/.local/scripts on EVERY `chezmoi apply`
#   — a dead NETWORK download that slows every deploy (prompt: speed of deployment + install closer to the minimum).
if ! grep -qiE 'antigen' home/.chezmoiexternal.toml.tmpl 2>/dev/null; then
  pass "no Antigen chezmoiexternal download (dead §7 fetch removed — zinit is the zsh plugin manager, no per-apply antigen.zsh pull)"
else
  fail ".chezmoiexternal.toml.tmpl still fetches antigen.zsh — a dead §7 network download on every chezmoi apply (remove it; zinit replaced antigen 2f9ab27c)"
fi

# 4d (#288). CONSOLIDATED residue guard — generalizes the per-tool removals (#284 mackup · #285 bash-it · #286
#   whalebrew · #287 antigen) so NO §6/§7-removed tool can leave a config dir OR a chezmoiexternal download. The
#   #287 sweep confirmed m-cli/gVisor/macfuse/MacPorts have no residue, but nothing LOCKED that — this does, so a
#   future accidental re-introduction fails CI. Exact dir-name match (zero false-positive) + distinctive-name
#   chezmoiexternal grep. (nix excluded — "nix" substrings unix/minix; its active code is covered by #5. bash-it
#   rc by #4b, nested files like brew/whalebrew by #3c, active invocations by #1-#6.)
removed_residue=""
for t in mackup whalebrew antigen macfuse gvisor macports m-cli; do
  [ -d "home/dot_config/$t" ] && removed_residue="$removed_residue dot_config/$t"
  grep -qi "$t" home/.chezmoiexternal.toml.tmpl 2>/dev/null && removed_residue="$removed_residue ext:$t"
done
if [ -z "$removed_residue" ]; then
  pass "no §6/§7 removed-tool config/chezmoiexternal residue (mackup/whalebrew/antigen/macfuse/gvisor/macports/m-cli all clean — future-proofs the removals)"
else
  fail "§6/§7 removed-tool residue returned:$removed_residue — a dropped tool left a config dir or per-apply download (remove it)"
fi

# 5. Nix — removed fleet-wide (CLAUDE.md §7: 53 software.yml entries + install branches dropped). NixOS is
#    NOT a supported fleet role (§2), so a `command -v nix-env` OS-detection branch is dead. BSD-safe patterns
#    (no \b — macOS grep's \b is unreliable); the active invocations can't appear in a prose comment.
nx="$(activeHits 'command -v nix-env|nix-channel|nix-build|nixpkgs|installNix')"
if [ -z "$nx" ]; then pass "no active Nix code in provisioning surfaces (§7: Nix removed fleet-wide)"; else fail "active Nix code remains:"; printf '%s\n' "$nx" | head -6; fi

# 6. MacPorts — removed fleet-wide (CLAUDE.md §7: 110 software.yml entries + ensureMacportsInstalled dropped).
#    `[^a-z]port ` requires a non-letter before "port" so "report install" / "support" never false-match.
mp="$(activeHits '[^a-z]port (install|sync|selfupdate|upgrade)|ensureMacportsInstalled|/opt/local/bin/port')"
if [ -z "$mp" ]; then pass "no active MacPorts code in provisioning surfaces (§7: MacPorts removed fleet-wide)"; else fail "active MacPorts code remains:"; printf '%s\n' "$mp" | head -6; fi

# 7 (#293). The two ROOT rc files (home/dot_zshrc + home/dot_bashrc) are NOT in the SURFACES scan above
#   (SURFACES = the provisioning DIRS) — yet they're prime homes for a removed shell-integration tool, since
#   antigen/bash-it/mackup/nix were all shell hooks. #4b/#4c bespoke-checked ONLY dot_bashrc+bash-it and
#   chezmoiexternal+antigen; NOTHING scanned dot_zshrc at all, nor dot_bashrc for the OTHER removed tools.
#   Scan BOTH rc files (comment-stripped — a historical "X removed §6" note is legit) for an ACTIVE ref to
#   ANY §6/§7 removed tool, so a re-introduction into either shell's rc fails CI. Distinctive patterns only
#   (nix-env/nixpkgs not bare "nix"; /opt/local/bin/port not bare "port") → zero false-positive on export/unix.
rcres=""
for rc in home/dot_zshrc home/dot_bashrc; do
  if grep -vE '^[[:space:]]*#' "$rc" 2> /dev/null | grep -qE 'bash-it|bash_it|BASH_IT|antigen|mackup|m-cli|nix-env|nix-channel|nixpkgs|/opt/local/bin/port|ensureMacportsInstalled|whalebrew|macfuse|gvisor'; then
    rcres="$rcres ${rc#home/}"
  fi
done
if [ -z "$rcres" ]; then
  pass "root rc files (dot_zshrc + dot_bashrc) carry no active §6/§7 removed-tool reference (#285 bash-it gap generalized to BOTH shells + ALL removed tools)"
else
  fail "a root rc file has an active §6/§7 removed-tool reference:$rcres — a dropped tool's shell hook lingers (remove it)"
fi

# 8 (#303). CLEANUP PROPAGATION to EXISTING machines — removing a §6/§7 tool's config from the SOURCE
#   (#284 mackup · #286 whalebrew · #287 antigen) only stops FRESH machines deploying it; a machine that
#   ALREADY deployed the artifact KEEPS it (chezmoi does NOT auto-delete a removed source entry's target).
#   So each removed-tool DEPLOYED path must be listed in home/.chezmoiremove to clean existing machines on
#   their next `chezmoi apply` (the prompt's "remove unnecessary files"). Target-relative paths. Sibling of
#   #3b/#3c/#4d (which assert the SOURCE is clean); this asserts the TARGET gets cleaned too.
REMOVE="home/.chezmoiremove"
missing_rm=""
for p in '.config/mackup' '.config/brew/whalebrew' '.local/scripts/antigen.zsh'; do
  grep -qF "$p" "$REMOVE" 2> /dev/null || missing_rm="$missing_rm $p"
done
if [ -z "$missing_rm" ]; then
  pass ".chezmoiremove cleans the §6/§7 removed-tool deployed artifacts (mackup/whalebrew/antigen) from EXISTING machines on upgrade"
else
  fail ".chezmoiremove MISSING removed-tool cleanup path(s):$missing_rm — a source removal (#284/#286/#287) won't propagate; existing machines keep the stale config"
fi

say "no-removed-tools: $P passed, $F failed"
[ "$F" -eq 0 ]
