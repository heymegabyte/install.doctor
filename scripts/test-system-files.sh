#!/usr/bin/env bash
# System-files-via-chezmoi guard (the prompt's #1 ask: "leverage Chezmoi to apply the user's dot configs,
# IN ADDITION TO applying system files", fire #205). chezmoi natively owns dotfiles; SYSTEM files (/etc/*,
# which chezmoi can't write unprivileged) are applied by a run-script that RENDERS a chezmoi template then
# `sudo tee`s it into place. The canonical example: /etc/docker/daemon.json ← chezmoi cat the dot_config
# source → sudo tee. This mechanism had ZERO test coverage. The guard locks it so a future edit can't break
# the render-then-tee path, drop the source template (dangling → empty /etc file), or lose the idempotency /
# platform / source-missing guards. Pure file assertions, no network. (.tmpl files carry chezmoi `{{ }}`,
# so they are NOT bash -n-able — validated by chezmoi, not bash.)
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

say "system-files via chezmoi (render-then-tee → /etc)"

[ -f "$SYS" ] && pass "system run-script present (run_before_05-system.sh.tmpl)" || fail "run_before_05-system.sh.tmpl missing ($SYS)"

# 1. the render-then-tee mechanism: a chezmoi-rendered template piped into a privileged /etc write.
if has "$SYS" 'chezmoi cat' && has "$SYS" 'sudo tee /etc/docker/daemon.json'; then
  pass "chezmoi->/etc mechanism present — chezmoi cat .../docker/daemon.json piped to sudo tee /etc/docker/daemon.json"
else
  fail "the chezmoi-render → sudo-tee-/etc mechanism is missing (system files no longer applied via chezmoi)"
fi

# 2. the chezmoi SOURCE template exists (dangling source ⇒ an empty /etc/docker/daemon.json — the /brew class).
[ -f "$SRC" ] && pass "chezmoi source template exists (home/dot_config/docker/daemon.json.tmpl — not dangling)" || fail "docker daemon.json source template MISSING → the tee would write nothing"

# 3. source-missing is handled (the script warns + skips, never silently writes an empty daemon.json).
has "$SYS" 'daemon.json.tmpl is not available' && pass "source-missing path warns + skips (no silent empty /etc write)" || fail "no source-missing guard — a missing template could write an empty daemon.json"

# 4. idempotency — only writes when /etc/docker/daemon.json is ABSENT (never clobbers a user's config; re-run = no-op).
has "$SYS" '[ ! -f /etc/docker/daemon.json ]' && pass "idempotent — writes only when /etc/docker/daemon.json is absent (no clobber)" || fail "no idempotency guard — a re-run could overwrite an existing /etc/docker/daemon.json"

# 5. platform-gated — Linux only (macOS Docker Desktop manages its own daemon; writing /etc/docker there is wrong).
if has "$SYS" '[ ! -d /Applications ]' || has "$SYS" '[ ! -d /System ]'; then
  pass "platform-gated — the /etc/docker write is Linux-only (macOS excluded)"
else
  fail "the system-file write is not platform-gated (would wrongly run on macOS)"
fi

# 6. the source renders to VALID JSON (a malformed daemon.json stops Docker). Skip strict JSON if it carries
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

# 7. OTHER chezmoi→/etc appliers — the prompt says "apply system files" (PLURAL), not only docker.
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

say "system-files: $P passed, $F failed"
[ "$F" -eq 0 ]
