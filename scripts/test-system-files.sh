#!/usr/bin/env bash
# System-file ownership guard. Preliminary setup may apply universal system
# files, but optional Docker configuration belongs to selected post-install
# capabilities and must not be written before Docker is admitted.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYS="$ROOT/home/.chezmoiscripts/universal/run_before_05-system.sh.tmpl"
SRC="$ROOT/home/dot_config/docker/daemon.json.tmpl"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0
has() { grep -qF "$2" "$1" 2>/dev/null; }

say "system-file ownership via chezmoi"

[ -f "$SYS" ] && pass "system run-script present (run_before_05-system.sh.tmpl)" || fail "run_before_05-system.sh.tmpl missing ($SYS)"

# 1. Docker is not configured by the preliminary phase.
if ! has "$SYS" '/etc/docker/daemon.json' && has "$SYS" 'Docker is not selected; preliminary setup will leave it absent'; then
  pass "preliminary setup leaves unselected Docker and its system configuration untouched"
else
  fail "preliminary setup bypasses Docker desired-state ownership"
fi

# 2. the chezmoi SOURCE template exists (dangling source ⇒ an empty /etc/docker/daemon.json — the /brew class).
[ -f "$SRC" ] && pass "chezmoi source template exists (home/dot_config/docker/daemon.json.tmpl — not dangling)" || fail "docker daemon.json source template MISSING → the tee would write nothing"

# 3. the source renders to VALID JSON for selected capability hooks. Skip strict JSON if it carries
#    chezmoi template syntax (can't validate un-rendered); current source is pure JSON so this check is live.
if [ -f "$SRC" ]; then
  if grep -q '{{' "$SRC" 2>/dev/null; then
    pass "source is a chezmoi template ({{ }}) — JSON validity checked post-render, skipped here"
  elif command -v python3 >/dev/null 2>&1 && python3 -c "import json,sys; json.load(open('$SRC'))" 2>/dev/null; then
    pass "source daemon.json is valid JSON (Docker will start)"
  else
    fail "source daemon.json is INVALID JSON (would stop Docker)"
  fi
fi

# 4. Universal chezmoi→/etc appliers.
#    run_after_01-pre-install copies chezmoi-managed sources INTO /etc: shell/exports.sh→/etc/zshenv (shell
#    env system-wide), fontconfig/fonts.conf→/etc/fonts/local.conf, .ssh/system/sshd_config→/etc/ssh/. Each
#    needs the cp-from-chezmoi-source→/etc line present AND a non-dangling source (a missing source ⇒ cp
#    writes nothing — the /brew class #204). This extends #205's coverage from docker-only to the full set.
PRE="$ROOT/home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl"
if has "$PRE" '/etc/zshenv' && [ -f "$ROOT/home/dot_config/shell/exports.sh.tmpl" ]; then
  pass "chezmoi→/etc: shell/exports.sh → /etc/zshenv (applier + source present)"
else
  fail "zshenv applier or its chezmoi source (dot_config/shell/exports.sh.tmpl) missing"
fi
if has "$PRE" '/etc/fonts/local.conf' && [ -f "$ROOT/home/dot_config/fontconfig/fonts.conf" ]; then
  pass "chezmoi→/etc: fontconfig/fonts.conf → /etc/fonts/local.conf (applier + source present)"
else
  fail "fonts applier or its chezmoi source (dot_config/fontconfig/fonts.conf) missing"
fi
sshsrc="$(ls "$ROOT"/home/*dot_ssh/system/sshd_config* 2> /dev/null | head -1)"
if has "$PRE" '/etc/ssh/sshd_config' && [ -n "$sshsrc" ]; then
  pass "chezmoi→/etc: .ssh/system/sshd_config → /etc/ssh/sshd_config (applier + source present)"
else
  fail "ssh sshd_config applier or its chezmoi source (home/*dot_ssh/system/sshd_config*) missing"
fi

# 8 (#309). COUPLED system file — the sshd_config #7 just validated DECLARES `Banner /etc/ssh/banner` (a
#    pre-auth login banner), so /etc/ssh/banner is a FILE THAT CONFIG REQUIRES. The #7 check validates
#    sshd_config but is BLIND to the banner it references: drop the banner applier/source and sshd logs
#    "Banner /etc/ssh/banner does not exist" on EVERY connection — a broken SSH config shipped PAST the
#    sshd_config check. Conditional on the REAL coupling (only fires when sshd_config declares the Banner),
#    so it can't go vacuous; same applier + non-dangling-source class as #7.
if [ -n "$sshsrc" ] && grep -qiE '^[[:space:]]*Banner[[:space:]]+/etc/ssh/banner' "$sshsrc" 2> /dev/null; then
  bansrc="$(ls "$ROOT"/home/*dot_ssh/system/banner 2> /dev/null | head -1)"
  if has "$PRE" '/etc/ssh/banner' && [ -n "$bansrc" ]; then
    pass "chezmoi→/etc: sshd_config's 'Banner /etc/ssh/banner' is BACKED — the banner applier + its source (home/*dot_ssh/system/banner) are present (no broken Banner reference)"
  else
    fail "sshd_config declares 'Banner /etc/ssh/banner' but the banner applier (/etc/ssh/banner in run_after_01) or its chezmoi source (home/*dot_ssh/system/banner) is MISSING → sshd logs 'Banner file does not exist' every connection"
  fi
else
  pass "sshd_config declares no '/etc/ssh/banner' Banner directive — no banner coupling to enforce (N/A)"
fi

say "system-files: $P passed, $F failed"
[ "$F" -eq 0 ]
