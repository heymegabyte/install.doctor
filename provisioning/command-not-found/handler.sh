# command-not-found AI lazy-installer — source from the zsh/bash rc.
# Megabyte estate / install.doctor. When you run a CLI that isn't installed, this:
#   1. looks the binary up in the prebuilt index (from software.yml),
#   2. installs it via the OS's preferred installer with gorgeous gum/glow output,
#   3. falls back to AI package discovery (mods) when it's not in software.yml,
#   4. then transparently runs the exact command you typed.
# Index is built by build-index.sh → $CNF_INDEX. All output via gum/glow ([[terminal-styling]]).
CNF_INDEX="${CNF_INDEX:-$HOME/.cache/cnf/index.tsv}"

__cnf_say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
__cnf_warn(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "$*" || printf '\033[1;33m%s\033[0m\n' "$*"; }

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

__cnf_ai_fallback(){ local cmd="$1" os="$2" inst=""
  __cnf_warn "✦ '$cmd' not in software.yml — asking AI how to install it on $os…"
  if command -v mods >/dev/null 2>&1; then
    inst="$(printf 'Output ONLY the exact shell command to install the CLI named "%s" on %s (prefer brew then the native package manager). No prose, one line.' "$cmd" "$os" | mods --quiet 2>/dev/null | head -1)"
  fi
  if [ -n "$inst" ]; then __cnf_say "→ $inst"; eval "$inst"; else
    __cnf_warn "Could not auto-resolve '$cmd' (no software.yml entry, no AI CLI). Install manually."; return 1; fi; }

__cnf_resolve(){ local cmd="$1"; shift
  local os pref row mgr="" pkg="" col
  os="$(__cnf_os)"; pref="$(__cnf_pref "$os")"
  __cnf_say "⟳ '$cmd' not found — resolving via install.doctor…"
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
  if [ -n "$mgr" ] && [ -n "$pkg" ]; then
    __cnf_say "↻ installing '$cmd' → $mgr: $pkg (first run)…"
    [ -n "${CNF_DRY:-}" ] && { __cnf_say "   [CNF_DRY] would install via $mgr: $pkg"; return 0; }
    __cnf_do_install "$mgr" "$pkg" || { __cnf_warn "install via $mgr failed"; return 1; }
  else
    __cnf_ai_fallback "$cmd" "$os" || return 127
  fi
  hash -r 2>/dev/null || true
  if command -v "$cmd" >/dev/null 2>&1; then __cnf_say "✓ installed — running: $cmd $*"; "$cmd" "$@"
  else __cnf_warn "'$cmd' still not found after install"; return 127; fi; }

# zsh + bash entry points
command_not_found_handler(){ __cnf_resolve "$@"; }   # zsh
command_not_found_handle(){  __cnf_resolve "$@"; }   # bash
