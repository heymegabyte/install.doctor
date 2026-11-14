#!/usr/bin/env bash
# scripts/test-nvim-plugins.sh — Regression suite for install.doctor#123 (Headless install of VIM plugins):
#   1. Plugins reach Vim *and* Neovim from pinned, checksummed archives unpacked by `chezmoi apply`
#   2. No plugin manager downloads anything at editor startup (no `:PlugInstall`, no coc bootstrap, no lazy/packer)
#   3. Neovim auto-loads the shipped plugins as `pack/install-doctor/start` packages with no config and no install pane
#   4. Both editors stay idempotent on re-runs and never require network access on first open
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/home/.chezmoiexternal.toml.tmpl"
DATA="$ROOT/home/.chezmoidata.yaml"
VIMRC="$ROOT/home/dot_config/vim/vimrc"

P=0
F=0
pass() { printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { printf '\033[1;31mFAIL\033[0m %s\n' "$*" >&2; F=$((F + 1)); }

# 1. Every plugin in the catalog is unpacked for BOTH editors from the same immutable archive
plugin_data="$(awk '/^vimPlugins:$/ { in_vim=1 } in_vim && /^qubes:$/ { exit } in_vim' "$DATA")"
plugin_count="$(printf '%s\n' "$plugin_data" | grep -cE 'name: [a-z0-9.-]+, repo: [^,]+, commit: [a-f0-9]{40}, sha256: [a-f0-9]{64}, size: [1-9][0-9]*')"
vim_targets="$(grep -cF '[".local/share/vim/plugged/{{ $vimPlugin.name }}"]' "$EXT")"
nvim_targets="$(grep -cF '[".local/share/nvim/site/pack/install-doctor/start/{{ $vimPlugin.name }}"]' "$EXT")"

if [ "$plugin_count" -eq 8 ] && [ "$vim_targets" -eq 1 ] && [ "$nvim_targets" -eq 1 ]; then
  pass "all 8 catalogued plugins are declared for both Vim (plugged/) and Neovim (pack/install-doctor/start/)"
else
  fail "plugin parity broken (catalog=$plugin_count vim_targets=$vim_targets nvim_targets=$nvim_targets, expected 8/1/1)"
fi

# Both targets must sit inside the same range loop so a new catalog entry reaches both editors
loop_body="$(awk '/\{\{- \$vimPlugins := .vimPlugins \}\}/ { in_loop=1 } in_loop && /^\{\{- end \}\}$/ { exit } in_loop' "$EXT")"
if printf '%s\n' "$loop_body" | grep -qF '".local/share/vim/plugged/{{ $vimPlugin.name }}"' \
  && printf '%s\n' "$loop_body" | grep -qF '".local/share/nvim/site/pack/install-doctor/start/{{ $vimPlugin.name }}"' \
  && [ "$(printf '%s\n' "$loop_body" | grep -c 'checksum.sha256 = "{{ $vimPlugin.sha256 }}"')" -eq 2 ] \
  && [ "$(printf '%s\n' "$loop_body" | grep -c 'checksum.size = {{ $vimPlugin.size }}')" -eq 2 ] \
  && [ "$(printf '%s\n' "$loop_body" | grep -c 'codeload.github.com/{{ $vimPlugin.repo }}/tar.gz/{{ $vimPlugin.commit }}')" -eq 2 ] \
  && [ "$(printf '%s\n' "$loop_body" | grep -c 'exact = true')" -eq 2 ]; then
  pass "both editor targets are emitted from one loop bound to the same immutable commit + SHA-256 + size"
else
  fail "Vim and Neovim targets are not both derived from the pinned archive inside the plugin loop"
fi

# 2. Nothing in the tree downloads plugins at editor runtime
runtime_install_refs="$(grep -rIn --exclude-dir=node_modules --exclude-dir=.git --exclude="test-nvim-plugins.sh" \
  -E 'PlugInstall|PlugClean|PlugUpdate|coc#util#|coc-install|packer\.startup\(\{|\blazy\.setup\b|require\("lazy"\)' \
  "$ROOT/home" "$ROOT/scripts" 2>/dev/null \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' | wc -l)"
if [ "$runtime_install_refs" -eq 0 ]; then
  pass "no runtime plugin installer remains in home/ or scripts/ (no PlugInstall, coc bootstrap, lazy.nvim, or packer)"
else
  fail "runtime plugin installer references remain ($runtime_install_refs) — plugins must arrive via chezmoi apply only"
fi

# Vim's own vimrc must stay guard-only: it loads already-unpacked dirs and never triggers an install
if ! grep -qE '^\s*(PlugInstall|PlugUpdate|PlugClean)' "$VIMRC" \
  && grep -q 'autoload/plug\.vim' "$VIMRC" \
  && grep -q 'plugged' "$VIMRC"; then
  pass "vimrc loads pre-unpacked plugins and issues no install/update command"
else
  fail "vimrc issues a plugin install command or no longer reads the unpacked plugin directory"
fi

# 3./4. Neovim loads shipped plugins as start packages with no config, no prompt, and no network
if ! command -v nvim >/dev/null 2>&1; then
  printf '\033[1;33mSKIP\033[0m nvim is not installed on this host — live pack auto-load checks skipped\n'
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  nvim_env() {
    HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/config" XDG_DATA_HOME="$TMP/data" XDG_STATE_HOME="$TMP/state" \
      nvim --headless "$@"
  }

  mkdir -p "$TMP/home" "$TMP/config" "$TMP/state" \
    "$TMP/data/nvim/site/pack/install-doctor/start/livetest/plugin"

  # A start package that only reports itself if Neovim actually sourced it at startup
  cat > "$TMP/data/nvim/site/pack/install-doctor/start/livetest/plugin/livetest.vim" <<'EOF'
let g:install_doctor_pack_loaded = (get(g:, 'install_doctor_pack_loaded', 0) + 1)
EOF

  nvim_env -c 'lua print("pack=" .. tostring(vim.g.install_doctor_pack_loaded))' -c 'qa!' \
    </dev/null >"$TMP/first.log" 2>&1
  first_rc=$?

  if [ "$first_rc" -eq 0 ] \
    && grep -qxF 'pack=1' "$TMP/first.log" \
    && ! grep -E 'Press ENTER|Error detected|E[0-9]+:' "$TMP/first.log" >/dev/null 2>&1 \
    && [ ! -d "$TMP/config/nvim" ]; then
    pass "nvim auto-loads pack/install-doctor/start plugins with no init.lua and no install prompt"
  else
    fail "nvim did not auto-load the start package cleanly (rc=$first_rc)"
    sed -n '1,20p' "$TMP/first.log" >&2 || true
  fi

  nvim_env -c 'lua print("pack=" .. tostring(vim.g.install_doctor_pack_loaded))' -c 'qa!' \
    </dev/null >"$TMP/second.log" 2>&1
  second_rc=$?

  if [ "$second_rc" -eq 0 ] && grep -qxF 'pack=1' "$TMP/second.log"; then
    pass "re-running nvim is idempotent — the package is sourced once per session and never re-installed"
  else
    fail "re-running nvim regressed pack auto-load (rc=$second_rc, expected pack=1)"
    sed -n '1,20p' "$TMP/second.log" >&2 || true
  fi

  nvim_env -c 'qa!' </dev/null >"$TMP/quiet.log" 2>&1
  quiet_rc=$?
  if [ "$quiet_rc" -eq 0 ] && ! grep -E 'Press ENTER|Error detected|E[0-9]+:' "$TMP/quiet.log" >/dev/null 2>&1; then
    pass "nvim starts headless with zero prompts and zero errors on a freshly provisioned host"
  else
    fail "nvim headless startup emitted prompts or errors (rc=$quiet_rc)"
    sed -n '1,20p' "$TMP/quiet.log" >&2 || true
  fi
fi

printf 'nvim-plugins: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
