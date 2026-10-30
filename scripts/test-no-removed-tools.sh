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
cd "$ROOT"

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

# 4. the bash-it call sites in the post-install dispatch are gone (both the sync + the parallel branch).
if ! grep -qE 'bashItPlugins' home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl 2>/dev/null; then
  pass "post-install dispatch no longer calls bashItPlugins (sync + parallel branches clean)"
else
  fail "run_after_20-post-install still references bashItPlugins"
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

say "no-removed-tools: $P passed, $F failed"
[ "$F" -eq 0 ]
