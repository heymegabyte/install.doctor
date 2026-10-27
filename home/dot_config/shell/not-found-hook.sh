# shellcheck shell=bash
# Command-not-found hook — the SINGLE canonical command-not-found handler for the estate.
# Sourced from the zsh/bash rc (dot_zshrc, dot_bashrc) which then call handle_command_not_found.
# Deployed by chezmoi to ~/.config/shell/not-found-hook.sh. When you run a CLI that isn't installed:
#   1. looks the binary up in a prebuilt index (from software.yml; self-heals via `cnf-build-index`),
#   2. installs it via the OS's preferred package manager with gorgeous gum/glow output,
#   3. SAFELY falls back to AI package discovery (off by default) when it's not in software.yml,
#   4. then transparently runs the exact command you typed.
# Index builder: ~/.local/bin/cnf-build-index (home/dot_local/bin/executable_cnf-build-index).
# Sourcing has NO side effects (defines functions only). All output via gum/glow ([[terminal-styling]]).
CNF_INDEX="${CNF_INDEX:-$HOME/.cache/cnf/index.tsv}"
# E11 (v2): serialize concurrent installs of the SAME tool so two shells missing it produce ONE install.
CNF_LOCK_DIR="${CNF_LOCK_DIR:-$HOME/.cache/cnf/locks}"
CNF_LOCK_WAIT="${CNF_LOCK_WAIT:-120}"   # max seconds to wait for a peer's install
CNF_LOCK_STALE="${CNF_LOCK_STALE:-600}" # a lock older than this is a dead holder → reaped
# U09/U10: append-only LOCAL lazy-install telemetry journal (cmd/manager/pkg/outcome/duration — never
# in Git, never a secret). Lets aid report cold/warm latency + cache effectiveness.
CNF_JOURNAL="${CNF_JOURNAL:-$HOME/.local/var/log/install.doctor/cnf-installs.ndjson}"

__cnf_lock_path(){ printf '%s/%s.lock' "$CNF_LOCK_DIR" "$(printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_')"; }
__cnf_lock_age(){ local now mtime
  now="$(date +%s 2>/dev/null)" || return 1
  mtime="$(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null)" || return 1
  printf '%s' "$((now - mtime))"; }
# Acquire the per-command install lock (atomic mkdir). Prints the lock path + returns 0 when acquired
# (caller installs then releases); returns 10 if a peer finished and the command now EXISTS (caller must
# NOT install); returns 11 on timeout (caller proceeds best-effort). Reaps stale locks (dead holder).
__cnf_acquire(){ local cmd="$1" lock waited=0 age
  lock="$(__cnf_lock_path "$cmd")"; mkdir -p "$CNF_LOCK_DIR" 2>/dev/null || true
  while :; do
    if mkdir "$lock" 2>/dev/null; then
      # Got the lock — but a peer may have installed it while we were blocked; re-check before claiming.
      hash -r 2>/dev/null || true
      command -v "$cmd" >/dev/null 2>&1 && { rmdir "$lock" 2>/dev/null || true; return 10; }
      printf '%s' "$lock"; return 0
    fi
    age="$(__cnf_lock_age "$lock" 2>/dev/null)"
    [ -n "$age" ] && [ "$age" -gt "$CNF_LOCK_STALE" ] && { rmdir "$lock" 2>/dev/null || rm -rf "$lock" 2>/dev/null; continue; }
    hash -r 2>/dev/null || true
    command -v "$cmd" >/dev/null 2>&1 && return 10
    [ "$waited" -ge "$CNF_LOCK_WAIT" ] && return 11
    sleep 1; waited=$((waited + 1))
  done; }

# E09 (v2): all hook status/progress goes to STDERR so a resolved command's STDOUT stays clean
# (e.g. `out=$(missingtool)` captures only the tool's output, not install chatter). E08 stream integrity.
__cnf_say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" >&2 || printf '\033[1;36m%s\033[0m\n' "$*" >&2; }
__cnf_warn(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "$*" >&2 || printf '\033[1;33m%s\033[0m\n' "$*" >&2; }

__cnf_os(){ case "$(uname -s)" in
  Darwin) echo darwin;;
  Linux)  command -v apt-get >/dev/null 2>&1 && { echo apt; return; }
          command -v dnf     >/dev/null 2>&1 && { echo dnf; return; }
          command -v pacman  >/dev/null 2>&1 && { echo pacman; return; }
          echo linux;;
  *) echo unknown;; esac; }

# per-OS installer preference (mirrors software.yml installerPreference; names = index columns)
__cnf_pref(){ case "$1" in
  darwin) echo "cask brew go cargo npm pipx pip gem";;
  apt)    echo "apt brew go cargo npm pipx pip gem";;
  dnf)    echo "dnf brew go cargo npm pipx pip gem";;
  pacman) echo "pacman brew go cargo npm pipx pip gem";;
  *)      echo "brew go cargo npm pipx pip gem";; esac; }

__cnf_do_install(){ local mgr="$1" pkg="$2"
  case "$mgr" in
    brew)   brew install "$pkg";;
    apt)    sudo apt-get update -qq && sudo apt-get install -y "$pkg";;
    dnf)    sudo dnf install -y "$pkg";;
    pacman) sudo pacman -S --noconfirm "$pkg";;
    cask)   brew install --cask "$pkg";;
    choco)  choco install -y "$pkg";;
    scoop)  scoop install "$pkg";;
    go)     go install "$pkg";;
    cargo)  cargo install "$pkg";;
    npm)    npm install -g "$pkg";;
    pipx)   pipx install "$pkg";;
    pip)    pip install --user "$pkg";;
    gem)    gem install "$pkg";;
    *) return 1;; esac; }

# U09/U10 telemetry. Sanitize to a safe charset so a value can NEVER break the JSON line (no quotes,
# backslashes, or control chars reach the file). Append-only; fail-soft (a journal error never breaks
# an install). Fields: ts, cmd, mgr, pkg, outcome (installed|failed|concurrent-skip), duration_ms.
__cnf_jsan(){ printf '%s' "$1" | tr -cd 'A-Za-z0-9._/+@: -'; }
__cnf_journal(){ mkdir -p "$(dirname "$CNF_JOURNAL")" 2>/dev/null || return 0
  printf '{"ts":"%s","cmd":"%s","mgr":"%s","pkg":"%s","outcome":"%s","duration_ms":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" \
    "$(__cnf_jsan "$1")" "$(__cnf_jsan "$2")" "$(__cnf_jsan "$3")" "$(__cnf_jsan "$4")" "${5:-0}" \
    >> "$CNF_JOURNAL" 2>/dev/null || true; }

# Deterministic allowlist guard — AI text is NOT a trust boundary (ai-agent-security). Rejects shell
# metacharacters (chaining/redirection/substitution/newline) and anything whose leading token (after an
# optional sudo) is not a known package manager performing an install/add. This is the real gate; the
# prompt is not.
__cnf_ai_safe(){ local c="$1"
  case "$c" in *';'*|*'|'*|*'&'*|*'$('*|*'${'*|*'`'*|*'>'*|*'<'*|*$'\n'*) return 1;; esac
  case "$c" in 'sudo '*) c="${c#sudo }";; esac
  case "${c%% *}" in
    brew|apt|apt-get|dnf|pacman|cargo|go|npm|pipx|pip|pip3|gem|choco|scoop) ;;
    *) return 1;; esac
  case " $c " in *' install '*|*' add '*|*' -S '*|*' -Sy '*) return 0;; esac
  return 1; }

# Append the AI suggestion to an audit log; never fail the caller on a log error.
__cnf_log_suggestion(){ local dir="$HOME/.local/var/log/install.doctor"
  mkdir -p "$dir" 2>/dev/null || return 0
  printf '%s\tcmd=%s\tos=%s\tsuggestion=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" "$1" "$2" "$3" >> "$dir/cnf-ai-suggestions.log" 2>/dev/null || true; }

# AI fallback for a command not in software.yml. SAFE BY DEFAULT (master-prompt §10 — never run an
# arbitrary web-found install command on a mistype):
#   - CNF_AI_CMD overrides the AI call (manual override / test seam)
#   - the suggestion is logged + validated by __cnf_ai_safe BEFORE any execution
#   - CNF_DRY never executes; execution requires explicit CNF_AI_AUTOINSTALL=1 opt-in
__cnf_ai_fallback(){ local cmd="$1" os="$2" inst="${CNF_AI_CMD:-}"
  __cnf_warn "✦ '$cmd' not in software.yml — asking AI how to install it on ${os}…"
  if [ -z "$inst" ] && command -v mods >/dev/null 2>&1; then
    inst="$(printf 'Output ONLY the exact shell command to install the CLI named "%s" on %s (prefer brew then the native package manager). No prose, one line.' "$cmd" "$os" | mods --quiet 2>/dev/null | head -1)"
  fi
  [ -n "$inst" ] || { __cnf_warn "Could not auto-resolve '$cmd' (no software.yml entry, no AI CLI). Install manually."; return 1; }
  __cnf_say "→ suggested: $inst"
  __cnf_log_suggestion "$cmd" "$os" "$inst"
  if ! __cnf_ai_safe "$inst"; then
    __cnf_warn "✗ refusing to run AI suggestion — not a recognized, metachar-free installer. Review + run it yourself if trusted."; return 1; fi
  if [ -n "${CNF_DRY:-}" ]; then __cnf_say "   [CNF_DRY] would run: $inst"; return 0; fi
  if [ -z "${CNF_AI_AUTOINSTALL:-}" ]; then
    __cnf_warn "AI auto-install is OFF — set CNF_AI_AUTOINSTALL=1 to allow. Command above not run."; return 1; fi
  __cnf_say "↻ running (CNF_AI_AUTOINSTALL=1): $inst"
  # E10 (v2): NEVER eval model text or replay a shell string. __cnf_ai_safe already guaranteed $inst is
  # metachar-free + a known-installer invocation, so run it as plain argv in an ISOLATED subshell
  # (noglob word-split; no eval, no shell re-interpretation, no parent-shell mutation).
  ( set -f; IFS=$' \t\n'; set -- $inst; "$@" ) >&2 </dev/null; }

__cnf_resolve(){ local cmd="$1"; shift
  # E11 recursion guard: an install sub-step that re-triggers command-not-found for the SAME cmd must
  # NOT re-enter (infinite loop). Restored before every return via the single exit at the end.
  case " ${__CNF_RESOLVING:-} " in *" $cmd "*) return 127;; esac
  # E13/E14 (v2): NEVER auto-install on a miss in a NON-INTERACTIVE shell (CI, a script, a background
  # job, an untrusted project's command) — only an APPROVED job opts in (aid exec / prewarming export
  # CNF_ALLOW_NONINTERACTIVE=1). CNF_DRY is always safe (installs nothing). An unknown/denied command
  # then returns ORDINARY not-found (127), so untrusted or automated contexts can't trigger an
  # unauthorized install. (Interactive shells keep the lazy-install golden path.)
  if [ -z "${CNF_ALLOW_NONINTERACTIVE:-}" ] && [ -z "${CNF_DRY:-}" ]; then
    case "$-" in *i*) :;; *) return 127;; esac
  fi
  local __cnf_prev="${__CNF_RESOLVING:-}"; __CNF_RESOLVING="$__cnf_prev $cmd"
  local os pref row mgr="" pkg="" col rc=127 lock acq
  # E02 (ADR 0003): mise owns version-managed runtimes. If mise ALREADY provides this command, run it
  # VIA mise instead of redundantly installing it through a system package manager — never duplicate
  # mise's lazy machinery. `mise which` (stderr muted) succeeds only for a mise-managed tool. Only on the
  # normal exec path (not the install-only CNF_NO_EXEC callers, not CNF_DRY).
  if [ -z "${CNF_NO_EXEC:-}" ] && [ -z "${CNF_DRY:-}" ] && command -v mise >/dev/null 2>&1 && mise which "$cmd" >/dev/null 2>&1; then
    __cnf_say "↪ '$cmd' is provided by mise — running via mise (no duplicate install)"
    mise exec -- "$cmd" "$@"; rc=$?; __CNF_RESOLVING="$__cnf_prev"; return "$rc"
  fi
  os="$(__cnf_os)"; pref="$(__cnf_pref "$os")"
  __cnf_say "⟳ '$cmd' not found — resolving via install.doctor…"
  # self-heal: build the index on first use if missing + the deployed builder is available
  [ -f "$CNF_INDEX" ] || { command -v cnf-build-index >/dev/null 2>&1 && cnf-build-index >/dev/null 2>&1 || true; }
  row=""; [ -f "$CNF_INDEX" ] && row="$(awk -F'\t' -v c="$cmd" '$1==c{print; exit}' "$CNF_INDEX")"
  if [ -n "$row" ]; then
    # columns: 1 bin 2 key 3 brew 4 apt 5 dnf 6 pacman 7 cask 8 choco 9 scoop 10 go 11 cargo 12 npm 13 pipx 14 pip 15 gem
    # manual word-split (zsh does NOT split unquoted $pref like bash does)
    local rest="$pref" m
    while [ -n "$rest" ]; do
      m="${rest%% *}"; case "$rest" in *" "*) rest="${rest#* }";; *) rest="";; esac
      case "$m" in brew)col=3;;apt)col=4;;dnf)col=5;;pacman)col=6;;cask)col=7;;choco)col=8;;scoop)col=9;;go)col=10;;cargo)col=11;;npm)col=12;;pipx)col=13;;pip)col=14;;gem)col=15;;*)col=0;;esac
      if [ "$col" -gt 0 ] && command -v "$m" >/dev/null 2>&1; then
        pkg="$(printf '%s' "$row" | cut -f"$col")"; [ -n "$pkg" ] && { mgr="$m"; break; }
      fi
    done
  fi
  if [ -n "${CNF_DRY:-}" ] && [ -n "$mgr" ] && [ -n "$pkg" ]; then
    __cnf_say "   [CNF_DRY] would install via $mgr: $pkg"; __CNF_RESOLVING="$__cnf_prev"; return 0
  fi
  if [ -n "$mgr" ] && [ -n "$pkg" ]; then
    # E11: serialize concurrent installs of the SAME tool (atomic lockdir; bounded wait; stale reap).
    lock="$(__cnf_acquire "$cmd")"; acq=$?
    if [ "$acq" -eq 10 ]; then
      __cnf_say "✓ '$cmd' installed by a concurrent shell — skipping duplicate install"
      __cnf_journal "$cmd" "$mgr" "$pkg" "concurrent-skip" 0 # U10: a warm hit — a peer did the install
    else
      __cnf_say "↻ installing '$cmd' → $mgr: $pkg (first run)…"
      local __t0 __dur
      __t0="$(date +%s 2>/dev/null || echo 0)"
      # E09: installer stdout → stderr (not the command's stdout); </dev/null so it never eats the
      # command's stdin.
      if __cnf_do_install "$mgr" "$pkg" >&2 </dev/null; then
        __dur=$(( ( $(date +%s 2>/dev/null || echo "$__t0") - __t0 ) * 1000 ))
        __cnf_journal "$cmd" "$mgr" "$pkg" "installed" "$__dur" # U09/U10: cold install + latency
      else
        __dur=$(( ( $(date +%s 2>/dev/null || echo "$__t0") - __t0 ) * 1000 ))
        __cnf_warn "install via $mgr failed"
        __cnf_journal "$cmd" "$mgr" "$pkg" "failed" "$__dur"
      fi
      [ "$acq" -eq 0 ] && { rmdir "$lock" 2>/dev/null || true; }
    fi
  else
    __cnf_ai_fallback "$cmd" "$os" || { __CNF_RESOLVING="$__cnf_prev"; return 127; }
  fi
  hash -r 2>/dev/null || true
  if command -v "$cmd" >/dev/null 2>&1; then
    # CNF_NO_EXEC (E04 install-only primitive — the fish adapter + `aid exec` delegate here): INSTALL
    # but do NOT re-run; the caller re-runs the command in its OWN shell (bash can't re-run into fish).
    if [ -n "${CNF_NO_EXEC:-}" ]; then rc=0
    else __cnf_say "✓ installed — running: $cmd $*"; "$cmd" "$@"; rc=$?; fi
  else __cnf_warn "'$cmd' still not found after install"; rc=127; fi
  __CNF_RESOLVING="$__cnf_prev"; return "$rc"; }

# Entry points. The rc files source this file then call handle_command_not_found "$1"; the shell
# hooks are defined here too so the file is self-contained if sourced directly.
handle_command_not_found(){ __cnf_resolve "$@"; }   # rc entry point
command_not_found_handler(){ __cnf_resolve "$@"; }   # zsh
command_not_found_handle(){  __cnf_resolve "$@"; }   # bash
