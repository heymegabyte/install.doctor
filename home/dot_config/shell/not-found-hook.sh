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
# Failed post-install configuration is durable debt, not a transient terminal message. The binary may
# already exist, so command-not-found will not fire again; `cnf_repair <command>` retries exactly the
# recorded hook. This state is local-only and carries integrity evidence, not a signature or trust root.
CNF_REPAIR_DIR="${CNF_REPAIR_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/install.doctor/cnf-repairs}"
CNF_REPAIR_TIMEOUT="${CNF_REPAIR_TIMEOUT:-300}"
CNF_REPAIR_LOCK_STALE="${CNF_REPAIR_LOCK_STALE:-600}"
CNF_POST_HOOK_DIR="${CNF_POST_HOOK_DIR:-$HOME/.local/bin/post-installx}"

__cnf_lock_path(){ printf '%s/%s.lock' "$CNF_LOCK_DIR" "$(printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_')"; }
__cnf_lock_age(){ local now mtime
  now="$(date +%s 2>/dev/null)" || return 1
  mtime="$(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null)" || return 1
  printf '%s' "$((now - mtime))"; }
__cnf_process_identity(){ ps -o lstart= -p "$1" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | head -1; }
__cnf_install_owner_live(){ local lock="$1" pid saved current
  [ -f "$lock/owner" ] && [ ! -L "$lock/owner" ] || return 1
  pid="$(sed -n '1p' "$lock/owner" 2>/dev/null)"; saved="$(sed -n '2p' "$lock/owner" 2>/dev/null)"
  case "$pid" in ''|*[!0-9]*) return 1;; esac
  [ -n "$saved" ] && kill -0 "$pid" 2>/dev/null || return 1
  current="$(__cnf_process_identity "$pid")"
  [ -n "$current" ] && [ "$current" = "$saved" ]
}
__cnf_release_install_lock(){ local lock="$1"
  [ -d "$lock" ] && [ ! -L "$lock" ] || return 1
  rm -f "$lock/owner" 2>/dev/null || return 1
  rmdir "$lock" 2>/dev/null
}
# Acquire the per-command install lock (atomic mkdir). Prints the lock path + returns 0 when acquired
# (caller installs then releases); returns 10 if a peer finished and the command now EXISTS (caller must
# NOT install); returns 11 on timeout (caller proceeds best-effort). Reaps stale locks (dead holder).
__cnf_acquire(){ local cmd="$1" lock waited=0 age owner_identity owner_pid
  __CNF_LOCK_RESULT=""
  lock="$(__cnf_lock_path "$cmd")"; mkdir -p "$CNF_LOCK_DIR" 2>/dev/null || true
  while :; do
    if mkdir "$lock" 2>/dev/null; then
      # Got the lock — but a peer may have installed it while we were blocked; re-check before claiming.
      hash -r 2>/dev/null || true
      command -v "$cmd" >/dev/null 2>&1 && { __cnf_release_install_lock "$lock" 2>/dev/null || true; return 10; }
      owner_pid="${BASHPID:-$$}"
      owner_identity="$(__cnf_process_identity "$owner_pid")"
      [ -n "$owner_identity" ] || { __cnf_release_install_lock "$lock" 2>/dev/null || true; return 1; }
      ( umask 077; printf '%s\n%s\n' "$owner_pid" "$owner_identity" > "$lock/owner" ) || { __cnf_release_install_lock "$lock" 2>/dev/null || true; return 1; }
      __CNF_LOCK_RESULT="$lock"; return 0
    fi
    age="$(__cnf_lock_age "$lock" 2>/dev/null)"
    if [ -n "$age" ] && [ "$age" -gt "$CNF_LOCK_STALE" ] && ! __cnf_install_owner_live "$lock"; then
      __cnf_release_install_lock "$lock" 2>/dev/null && continue
    fi
    hash -r 2>/dev/null || true
    command -v "$cmd" >/dev/null 2>&1 && return 10
    [ "$waited" -ge "$CNF_LOCK_WAIT" ] && return 11
    sleep 1; waited=$((waited + 1))
  done; }

# E09 (v2): all hook status/progress goes to STDERR so a resolved command's STDOUT stays clean
# (e.g. `out=$(missingtool)` captures only the tool's output, not install chatter). E08 stream integrity.
__cnf_say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" >&2 || printf '\033[1;36m%s\033[0m\n' "$*" >&2; }
__cnf_warn(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "$*" >&2 || printf '\033[1;33m%s\033[0m\n' "$*" >&2; }

__cnf_sha256(){
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else return 1; fi
}
__cnf_sha256_text(){
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'
  else return 1; fi
}
__cnf_repair_path(){ printf '%s/%s.repair' "$CNF_REPAIR_DIR" "$(printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_')"; }
__cnf_prepare_repair_dir(){
  case "$CNF_REPAIR_DIR" in /*) :;; *) __cnf_warn 'CNF_REPAIR_DIR must be absolute'; return 1;; esac
  if [ -L "$CNF_REPAIR_DIR" ]; then __cnf_warn 'refusing symlinked configuration-repair directory'; return 1; fi
  ( umask 077; mkdir -p "$CNF_REPAIR_DIR" ) 2>/dev/null || return 1
  [ -d "$CNF_REPAIR_DIR" ] && [ ! -L "$CNF_REPAIR_DIR" ] && [ -O "$CNF_REPAIR_DIR" ] || return 1
  chmod 0700 "$CNF_REPAIR_DIR" 2>/dev/null || return 1
}
__cnf_record_repair(){ local cmd="$1" key="$2" mgr="$3" pkg="$4" hook="$5" row="$6" state tmp hook_hash index_hash row_hash
  __cnf_prepare_repair_dir || return 1
  [ -f "$CNF_INDEX" ] && [ ! -L "$CNF_INDEX" ] && [ -f "$hook" ] && [ ! -L "$hook" ] || return 1
  hook_hash="$(__cnf_sha256 "$hook")" || return 1
  index_hash="$(__cnf_sha256 "$CNF_INDEX")" || return 1
  row_hash="$(printf '%s' "$row" | __cnf_sha256_text)" || return 1
  state="$(__cnf_repair_path "$cmd")"
  [ ! -L "$state" ] || { __cnf_warn 'refusing symlinked configuration-repair record'; return 1; }
  tmp="$(mktemp "$CNF_REPAIR_DIR/.repair.XXXXXX")" || return 1
  chmod 0600 "$tmp" || { rm -f "$tmp"; return 1; }
  if ! printf 'schema=1\ncmd=%s\nkey=%s\nmgr=%s\npkg=%s\nhook=%s\nhook_sha256=%s\nindex_sha256=%s\nrow_sha256=%s\n' \
    "$cmd" "$key" "$mgr" "$pkg" "$hook" "$hook_hash" "$index_hash" "$row_hash" > "$tmp"; then
    rm -f "$tmp"; return 1
  fi
  mv -f "$tmp" "$state" || { rm -f "$tmp"; return 1; }
}
__cnf_complete_repair(){ local state="$1" completed
  [ -f "$state" ] && [ ! -L "$state" ] || return 1
  completed="$state.completed.$$"
  [ ! -e "$completed" ] && [ ! -L "$completed" ] || return 1
  mv "$state" "$completed" || return 1
  rm -f "$completed"
}
__cnf_trusted_root_binary(){ local binary="$1" uid mode
  [ -f "$binary" ] && [ ! -L "$binary" ] || return 1
  uid="$(stat -f '%u' "$binary" 2>/dev/null || stat -c '%u' "$binary" 2>/dev/null)"
  mode="$(stat -c '%a' "$binary" 2>/dev/null || stat -f '%Lp' "$binary" 2>/dev/null)"
  [ "$uid" = 0 ] || return 1
  case "$mode" in *[2367][0-9]|*[0-9][2367]) return 1;; esac
}
__cnf_run_hook_isolated(){ local hook="$1" kernel sandbox bwrap home
  kernel="$(uname -s 2>/dev/null)"
  case "$kernel" in
    Darwin)
      sandbox="$(command -v sandbox-exec 2>/dev/null)"
      __cnf_trusted_root_binary "$sandbox" || { __cnf_warn 'post-install configuration is unsupported on macOS without a trusted sandbox-exec boundary; select the package/service in desired state'; return 78; }
      "$sandbox" -p '(version 1)(allow default)(deny process-exec (regex #".*/(launchctl|systemctl|service|brew)$"))(deny mach-lookup (regex #"com\\.apple\\.(system\\.)?launchd.*"))' /bin/bash "$hook"
      ;;
    Linux)
      bwrap="$(command -v bwrap 2>/dev/null)"
      __cnf_trusted_root_binary "$bwrap" || { __cnf_warn 'post-install configuration is unsupported on Linux without trusted Bubblewrap; select the package/service in desired state'; return 78; }
      home="${HOME:-/nonexistent}"
      case "$home" in /*) :;; *) return 78;; esac
      "$bwrap" --die-with-parent --new-session --unshare-all \
        --ro-bind / / --bind "$home" "$home" --tmpfs /run --tmpfs /tmp --proc /proc --dev /dev \
        --ro-bind "$hook" /install-doctor-post-hook --chdir "$home" /bin/bash /install-doctor-post-hook
      ;;
    *) __cnf_warn "post-install configuration is unsupported on $kernel without an enforceable isolation primitive; select it in desired state"; return 78;;
  esac
}
__cnf_run_hook_bounded(){ (
  local hook="$1" timeout="$CNF_REPAIR_TIMEOUT" pid waited=0 rc interrupted=0
  case "$timeout" in ''|*[!0-9]*) timeout=300;; esac
  [ "$timeout" -ge 1 ] 2>/dev/null && [ "$timeout" -le 3600 ] 2>/dev/null || timeout=300
  INSTALL_DOCTOR_NO_SERVICE_AUTO_ENABLE=1 __cnf_run_hook_isolated "$hook" >&2 </dev/null & pid=$!
  if [ -n "${__CNF_REPAIR_ACTIVE_LOCK:-}" ] && [ -d "$__CNF_REPAIR_ACTIVE_LOCK" ] && [ ! -L "$__CNF_REPAIR_ACTIVE_LOCK" ]; then
    local hook_identity
    hook_identity="$(__cnf_process_identity "$pid")"
    [ -n "$hook_identity" ] && ( umask 077; printf '%s\n%s\n' "$pid" "$hook_identity" > "$__CNF_REPAIR_ACTIVE_LOCK/hook-owner" ) || true
  fi
  trap 'interrupted=1; kill "$pid" 2>/dev/null || true' HUP INT TERM
  while kill -0 "$pid" 2>/dev/null; do
    [ "$waited" -lt "$timeout" ] || { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; return 124; }
    sleep 1; waited=$((waited + 1))
  done
  wait "$pid"; rc=$?
  trap - HUP INT TERM
  [ "$interrupted" -eq 0 ] || return 130
  return "$rc"
); }

__cnf_repair(){ local cmd="${1:-}" state lock schema saved_cmd key mgr pkg hook hook_hash index_hash row_hash current_index current_row current_row_hash current_hook_hash rc __CNF_REPAIR_ACTIVE_LOCK=""
  case "$cmd" in ''|*[!A-Za-z0-9_.-]*) __cnf_warn 'repair requires one safe command name'; return 64;; esac
  __cnf_prepare_repair_dir || return 1
  state="$(__cnf_repair_path "$cmd")"
  [ -f "$state" ] && [ ! -L "$state" ] && [ -O "$state" ] || { __cnf_warn "no safe configuration repair is recorded for '$cmd'"; return 1; }
  [ "$(stat -c '%a' "$state" 2>/dev/null || stat -f '%Lp' "$state" 2>/dev/null)" = 600 ] || { __cnf_warn 'configuration-repair record is not private'; return 1; }
  [ "$(wc -l < "$state" | tr -d ' ')" = 9 ] || { __cnf_warn 'configuration-repair record has an invalid schema'; return 1; }
  schema="$(awk -F= '$1=="schema"{print substr($0,index($0,"=")+1)}' "$state")"
  saved_cmd="$(awk -F= '$1=="cmd"{print substr($0,index($0,"=")+1)}' "$state")"
  key="$(awk -F= '$1=="key"{print substr($0,index($0,"=")+1)}' "$state")"
  mgr="$(awk -F= '$1=="mgr"{print substr($0,index($0,"=")+1)}' "$state")"
  pkg="$(awk -F= '$1=="pkg"{print substr($0,index($0,"=")+1)}' "$state")"
  hook="$(awk -F= '$1=="hook"{print substr($0,index($0,"=")+1)}' "$state")"
  hook_hash="$(awk -F= '$1=="hook_sha256"{print substr($0,index($0,"=")+1)}' "$state")"
  index_hash="$(awk -F= '$1=="index_sha256"{print substr($0,index($0,"=")+1)}' "$state")"
  row_hash="$(awk -F= '$1=="row_sha256"{print substr($0,index($0,"=")+1)}' "$state")"
  [ "$schema" = 1 ] && [ "$saved_cmd" = "$cmd" ] && [ -n "$key" ] && [ -n "$mgr" ] && [ -n "$pkg" ] || return 1
  case "$hook" in "$CNF_POST_HOOK_DIR/post-$key.sh"|"$CNF_POST_HOOK_DIR/post-$cmd.sh") :;; *) __cnf_warn 'saved hook is outside the exact command/package binding'; return 1;; esac
  [ -f "$CNF_INDEX" ] && [ ! -L "$CNF_INDEX" ] && [ -f "$hook" ] && [ ! -L "$hook" ] || return 1
  current_index="$(__cnf_sha256 "$CNF_INDEX")" || return 1
  current_row="$(awk -F'\t' -v c="$cmd" '$1==c{print; exit}' "$CNF_INDEX" 2>/dev/null)"
  current_row_hash="$(printf '%s' "$current_row" | __cnf_sha256_text)" || return 1
  current_hook_hash="$(__cnf_sha256 "$hook")" || return 1
  if [ "$current_index" != "$index_hash" ] || [ "$current_row_hash" != "$row_hash" ] || [ "$current_hook_hash" != "$hook_hash" ]; then
    __cnf_warn "configuration repair for '$cmd' no longer matches its recorded index and hook evidence; rebuild/review before retrying"
    return 1
  fi
  lock="$state.lock"
  if ! mkdir "$lock" 2>/dev/null; then
    local stale_owner stale_identity current_identity stale_hook hook_identity lock_age
    stale_owner="$(sed -n '1p' "$lock/owner" 2>/dev/null)"; stale_identity="$(sed -n '2p' "$lock/owner" 2>/dev/null)"
    case "$stale_owner" in ''|*[!0-9]*)
      lock_age="$(__cnf_lock_age "$lock" 2>/dev/null)"
      if [ -n "$lock_age" ] && [ "$lock_age" -gt "$CNF_REPAIR_LOCK_STALE" ]; then
        rm -f "$lock/owner" "$lock/hook-owner" 2>/dev/null || true; rmdir "$lock" 2>/dev/null || true
      fi;;
    *)
      current_identity="$(__cnf_process_identity "$stale_owner")"
      if ! kill -0 "$stale_owner" 2>/dev/null || [ -z "$current_identity" ] || [ "$current_identity" != "$stale_identity" ]; then
        stale_hook="$(sed -n '1p' "$lock/hook-owner" 2>/dev/null)"; hook_identity="$(sed -n '2p' "$lock/hook-owner" 2>/dev/null)"
        case "$stale_hook" in ''|*[!0-9]*) :;; *)
          current_identity="$(__cnf_process_identity "$stale_hook")"
          [ -n "$current_identity" ] && [ "$current_identity" = "$hook_identity" ] && kill "$stale_hook" 2>/dev/null || true;;
        esac
        rm -f "$lock/owner" "$lock/hook-owner" 2>/dev/null || true; rmdir "$lock" 2>/dev/null || true
      fi;;
    esac
    mkdir "$lock" 2>/dev/null || { __cnf_warn "configuration repair for '$cmd' is already running"; return 75; }
  fi
  local owner_identity owner_pid
  owner_pid="${BASHPID:-$$}"; owner_identity="$(__cnf_process_identity "$owner_pid")"
  [ -n "$owner_identity" ] && ( umask 077; printf '%s\n%s\n' "$owner_pid" "$owner_identity" > "$lock/owner" ) || { rmdir "$lock" 2>/dev/null || true; return 1; }
  __CNF_REPAIR_ACTIVE_LOCK="$lock"
  __cnf_say "⚙ retrying bounded post-install configuration for '$cmd'…"
  __cnf_run_hook_bounded "$hook"; rc=$?
  if [ "$rc" -eq 0 ]; then
    __cnf_complete_repair "$state" || { [ ! -e "$state" ] || return 1; }
    __cnf_journal "$cmd" "$mgr" "$pkg" 'configuration-repaired' 0
    __cnf_say "✓ configuration repaired for '$cmd'"
  else
    __cnf_warn "configuration repair for '$cmd' failed or was interrupted (status $rc); retry state was preserved. Legitimate service mutation must be handed off as selectedServices entry '$key' and applied by install.doctor desired state."
  fi
  rm -f "$lock/owner" "$lock/hook-owner" 2>/dev/null || true
  rmdir "$lock" 2>/dev/null || true
  return "$rc"
}
cnf_repair(){ __cnf_repair "$@"; }

__cnf_os(){ case "$(uname -s)" in
  Darwin) echo darwin;;
  Linux)  command -v apt-get >/dev/null 2>&1 && { echo apt; return; }
          command -v dnf     >/dev/null 2>&1 && { echo dnf; return; }
          command -v pacman  >/dev/null 2>&1 && { echo pacman; return; }
          command -v apk     >/dev/null 2>&1 && { echo apk; return; }
          echo linux;;
  *) echo unknown;; esac; }

# per-OS installer preference (mirrors software.yml installerPreference; names = index columns)
__cnf_pref(){ case "$1" in
  darwin) echo "cask brew go cargo npm pipx pip gem";;
  apt)    echo "apt brew go cargo npm pipx pip gem";;
  dnf)    echo "dnf brew go cargo npm pipx pip gem";;
  pacman) echo "pacman brew go cargo npm pipx pip gem";;
  apk)    echo "apk brew go cargo npm pipx pip gem";;
  *)      echo "brew go cargo npm pipx pip gem";; esac; }

__cnf_effective_uid(){ id -u 2>/dev/null || printf '1'; }

__cnf_do_install(){ local mgr="$1" pkg="$2"
  # D03/E07 (v2 #163): $pkg may be a SPACE-JOINED package LIST — software.yml allows an ARRAY per manager
  # (docker apt: [containerd.io, docker-ce, docker-ce-cli, docker-compose-plugin]) which the index joins into
  # one column. Split it back into SEPARATE argv so the manager installs N packages, NEVER one quoted "a b c"
  # (which apt/brew try to install as a single, unfindable package → all 61 array entries' lazy-install broke).
  # MANUAL peel into positional params (like the $pref loop below): neither `arr=($x)` NOR `set -- $x` word-
  # splits in zsh (SH_WORD_SPLIT off) — only explicit ${x%% *} peeling is portable across bash+zsh. All quoted
  # → no glob, no eval (E10 — never reinterpret the string as shell).
  local rest="$pkg" tok
  set --
  while [ -n "$rest" ]; do
    tok="${rest%% *}"
    case "$rest" in *" "*) rest="${rest#* }";; *) rest="";; esac
    [ -n "$tok" ] && set -- "$@" "$tok"
  done
  [ "$#" -gt 0 ] || return 1
  if [ "$mgr" = go ]; then
    [ "$#" -eq 1 ] || { __cnf_warn 'refusing ambiguous Go provider list'; return 1; }
    if ! printf '%s\n' "$1" | grep -Eq '@v[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
      __cnf_warn "refusing mutable Go provider '$1'; select an exact semantic or pseudo-version in desired state"
      return 1
    fi
  fi
  case "$mgr" in
    brew)   brew install "$@";;
    apt)    sudo apt-get update -qq && sudo apt-get install -y "$@";;
    dnf)    sudo dnf install -y "$@";;
    pacman) sudo pacman -S --noconfirm "$@";;
    apk)    sudo apk add "$@";;
    cask)   brew install --cask "$@";;
    choco)  choco install -y "$@";;
    scoop)  scoop install "$@";;
    go)     go install "$@";;
    cargo)  cargo install "$@";;
    npm)    npm install -g "$@";;
    pipx)   uv tool install "$@";;
    pip)    pip install --user "$@";;
    gem)    gem install "$@";;
    *) return 1;; esac; }

# U09/U10 telemetry. Sanitize to a safe charset so a value can NEVER break the JSON line (no quotes,
# backslashes, or control chars reach the file). Append-only; fail-soft (a journal error never breaks
# an install). Fields: ts, cmd, mgr, pkg, outcome
# (installed|failed|configuration-failed|concurrent-skip|lock-timeout), duration_ms.
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
    brew|apt|apt-get|dnf|pacman|apk|cargo|go|npm|pipx|pip|pip3|gem|choco|scoop) ;;
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
  if [ -z "${CNF_DRY:-}" ]; then
    if [ "${CNF_DISABLE:-0}" = 1 ]; then
      __cnf_warn "lazy installation is disabled; select '$cmd' in desired state and rerun install.doctor"
      return 127
    fi
    if [ "${CNF_OFFLINE:-0}" = 1 ]; then
      __cnf_warn "offline policy blocks first-use installation of '$cmd'; add it to a signed offline bundle before retrying"
      return 69
    fi
    if [ "$(__cnf_effective_uid)" -eq 0 ]; then
      __cnf_warn "refusing privileged first-use installation of '$cmd'; rerun as the enrolled install user or select it in desired state"
      return 77
    fi
  fi
  # E13/E14 (v2): NEVER auto-install on a miss in a NON-INTERACTIVE shell (CI, a script, a background
  # job, an untrusted project's command) — only an APPROVED job opts in (aid exec / prewarming export
  # CNF_ALLOW_NONINTERACTIVE=1). CNF_DRY is always safe (installs nothing). An unknown/denied command
  # then returns ORDINARY not-found (127), so untrusted or automated contexts can't trigger an
  # unauthorized install. (Interactive shells keep the lazy-install golden path.)
  if [ -z "${CNF_ALLOW_NONINTERACTIVE:-}" ] && [ -z "${CNF_DRY:-}" ]; then
    case "$-" in *i*) :;; *) __cnf_warn "noninteractive first-use installation of '$cmd' requires an approved plan; select it in desired state and rerun install.doctor"; return 127;; esac
  fi
  local __cnf_prev="${__CNF_RESOLVING:-}"; __CNF_RESOLVING="$__cnf_prev $cmd"
  local os pref row mgr="" pkg="" col rc=127 lock acq __key="" __post_hook="" __hook_failed=0 __hook_rc=0 __CNF_LOCK_RESULT=""
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
  # self-heal: (re)build the index on first use if MISSING or EMPTY/truncated (a 0-byte index from an
  # interrupted/external write or disk-full must NOT silently disable lazy-install) + the builder exists.
  [ -s "$CNF_INDEX" ] || { command -v cnf-build-index >/dev/null 2>&1 && cnf-build-index >/dev/null 2>&1 || true; }
  # read only a non-empty index; silence a vanished/unreadable-file awk error so a degraded index falls
  # through to ORDINARY not-found with no terminal noise (E14).
  row=""; [ -s "$CNF_INDEX" ] && row="$(awk -F'\t' -v c="$cmd" '$1==c{print; exit}' "$CNF_INDEX" 2>/dev/null)"
  if [ -n "$row" ]; then
    # columns: 1 bin 2 key 3 brew 4 apt 5 dnf 6 pacman 7 cask 8 choco 9 scoop 10 go 11 cargo 12 npm 13 pipx 14 pip 15 gem
    __key="$(printf '%s' "$row" | cut -f2)"
    # manual word-split (zsh does NOT split unquoted $pref like bash does)
    local rest="$pref" m mbin
    while [ -n "$rest" ]; do
      m="${rest%% *}"; case "$rest" in *" "*) rest="${rest#* }";; *) rest="";; esac
      case "$m" in brew)col=3;;apt)col=4;;dnf)col=5;;pacman)col=6;;cask)col=7;;choco)col=8;;scoop)col=9;;go)col=10;;cargo)col=11;;npm)col=12;;pipx)col=13;;pip)col=14;;gem)col=15;;apk)col=16;;*)col=0;;esac
      # F02/D06 (#164): the availability check tests the manager's BINARY, but `cask` has NO standalone binary —
      # it's `brew install --cask`. Map cask→brew so the 253 cask-ONLY GUI apps (cask col set, brew col empty)
      # actually install instead of silently falling through (`command -v cask` always fails). Other managers
      # match their binary name.
      mbin="$m"; [ "$m" = cask ] && mbin=brew
      if [ "$col" -gt 0 ] && command -v "$mbin" >/dev/null 2>&1; then
        pkg="$(printf '%s' "$row" | cut -f"$col")"; [ -n "$pkg" ] && { mgr="$m"; break; }
      fi
    done
  fi
  if [ -n "${CNF_DRY:-}" ] && [ -n "$mgr" ] && [ -n "$pkg" ]; then
    __cnf_say "   [CNF_DRY] would install via $mgr: $pkg"; __CNF_RESOLVING="$__cnf_prev"; return 0
  fi
  if [ -n "$mgr" ] && [ -n "$pkg" ]; then
    # E11: serialize concurrent installs of the SAME tool (atomic lockdir; bounded wait; stale reap).
    __cnf_acquire "$cmd"; acq=$?; lock="${__CNF_LOCK_RESULT:-}"
    if [ "$acq" -eq 10 ]; then
      __cnf_say "✓ '$cmd' installed by a concurrent shell — skipping duplicate install"
      __cnf_journal "$cmd" "$mgr" "$pkg" "concurrent-skip" 0 # U10: a warm hit — a peer did the install
    elif [ "$acq" -eq 11 ]; then
      __cnf_warn "'$cmd' is still being installed by another process; retry after the current installation finishes"
      __cnf_journal "$cmd" "$mgr" "$pkg" "lock-timeout" 0
      __CNF_RESOLVING="$__cnf_prev"
      return 75
    else
      __cnf_say "↻ installing '$cmd' → $mgr: $pkg (first run)…"
      local __t0 __dur
      __t0="$(date +%s 2>/dev/null || echo 0)"
      # E09: installer stdout → stderr (not the command's stdout); </dev/null so it never eats the
      # command's stdin.
      if __cnf_do_install "$mgr" "$pkg" >&2 </dev/null; then
        __dur=$(( ( $(date +%s 2>/dev/null || echo "$__t0") - __t0 ) * 1000 ))
        # R14/F06/L06: persist exact configuration debt BEFORE invoking the hook. If the hook fails or
        # is interrupted, the binary exists but `cnf_repair <command>` remains able to retry it safely.
        for __post_hook in "${CNF_POST_HOOK_DIR:-$HOME/.local/bin/post-installx}/post-${__key:-$cmd}.sh" "${CNF_POST_HOOK_DIR:-$HOME/.local/bin/post-installx}/post-${cmd}.sh"; do
          if [ -f "$__post_hook" ]; then
            __cnf_say "⚙ running post-install config hook: $(basename "$__post_hook")…"
            if ! __cnf_record_repair "$cmd" "${__key:-$cmd}" "$mgr" "$pkg" "$__post_hook" "$row"; then
              __hook_failed=1
              __cnf_warn "could not safely persist configuration repair state for '$cmd'; configuration was not run"
            else
              __cnf_run_hook_bounded "$__post_hook"; __hook_rc=$?
              if [ "$__hook_rc" -ne 0 ]; then
                __hook_failed=1
                if [ "$__hook_rc" -eq 78 ]; then
                  __cnf_warn "configuration for '$cmd' requires an unavailable enforcement boundary; hand service mutation off as selectedServices entry '${__key:-$cmd}' in install.doctor desired state"
                else
                  __cnf_warn "configuration failed for '$cmd'; repair with: cnf_repair '$cmd'"
                fi
              else
                __cnf_complete_repair "$(__cnf_repair_path "$cmd")" || __hook_failed=1
              fi
            fi
            break
          fi
        done
        if [ "$__hook_failed" -eq 0 ]; then
          __cnf_journal "$cmd" "$mgr" "$pkg" "installed" "$__dur" # U09/U10: cold install + latency
        else
          __cnf_journal "$cmd" "$mgr" "$pkg" "configuration-failed" "$__dur"
        fi
      else
        __dur=$(( ( $(date +%s 2>/dev/null || echo "$__t0") - __t0 ) * 1000 ))
        __cnf_warn "install via $mgr failed"
        __cnf_journal "$cmd" "$mgr" "$pkg" "failed" "$__dur"
      fi
      [ "$acq" -eq 0 ] && { __cnf_release_install_lock "$lock" 2>/dev/null || true; }
      if [ "$__hook_failed" -ne 0 ]; then
        __CNF_RESOLVING="$__cnf_prev"
        return 1
      fi
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
