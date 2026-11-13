#!/usr/bin/env bash
# scripts/test-vim-config.sh — Regression suite for install.doctor#78 (VIM Errors):
#   1. Legacy colors/lists/default.vim recursion (E679 -> E169 -> E121 -> E108 -> SEGV) via syncolor.vim
#   2. Unguarded vim-plug startup errors (E117/E492) when autoload/plug.vim is absent
#   3. Destructive runtimepath= assignment clobbering $VIMRUNTIME/after and built-in packages
#   4. Betelgeuse.vim highlight-clear ordering, light/dark palette completeness, recursion guard, unlet!
#   5. XDG state undo/viminfo directories and VIMINIT/GVIMINIT Neovim + missing-file guards
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIMRC="$ROOT/home/dot_config/vim/vimrc"
COLOR="$ROOT/home/dot_config/vim/colors/Betelgeuse.vim"
CHEZMOI_REMOVE="$ROOT/home/.chezmoiremove"
PROFILE_TMPL="$ROOT/home/dot_config/shell/profile.sh.tmpl"
POST_VIM="$ROOT/home/dot_local/bin/post-installx/executable_post-vim.sh"

P=0
F=0
pass() { printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { printf '\033[1;31mFAIL\033[0m %s\n' "$*" >&2; F=$((F + 1)); }

# 1. .chezmoiremove cleans stale colors/lists/default.vim on existing hosts
if grep -qxF '.config/vim/colors/lists/default.vim' "$CHEZMOI_REMOVE" \
  && grep -qxF '.config/vim/colors/lists' "$CHEZMOI_REMOVE" \
  && grep -qxF '.vim/colors/lists/default.vim' "$CHEZMOI_REMOVE" \
  && grep -qxF '.vim/colors/lists' "$CHEZMOI_REMOVE"; then
  pass ".chezmoiremove removes legacy .config/vim/colors/lists/default.vim and .vim/colors/lists/default.vim"
else
  fail ".chezmoiremove is missing cleanup entries for legacy colors/lists/default.vim"
fi

# 2. Source tree never ships a user colors/lists/default.vim shadowing $VIMRUNTIME
if [ ! -e "$ROOT/home/dot_config/vim/colors/lists/default.vim" ] \
  && [ ! -e "$ROOT/home/dot_vim/colors/lists/default.vim" ]; then
  pass "source tree does not ship user colors/lists/default.vim"
else
  fail "source tree still contains colors/lists/default.vim"
fi

# 3. Betelgeuse.vim structural safety: recursion guard, highlight clear before palette branch, else fallback, unlet!
clear_line="$(grep -n '^[[:space:]]*highlight clear' "$COLOR" | head -n1 | cut -d: -f1)"
bg_line="$(grep -n '^[[:space:]]*if &background' "$COLOR" | head -n1 | cut -d: -f1)"
if grep -q 's:betelgeuse_loading' "$COLOR" \
  && [ -n "$clear_line" ] && [ -n "$bg_line" ] && [ "$clear_line" -lt "$bg_line" ] \
  && grep -q "exists('syntax_on')" "$COLOR" \
  && grep -q '^[[:space:]]*else[[:space:]]*$' "$COLOR" \
  && ! grep -q '^[[:space:]]*unlet[[:space:]]' "$COLOR" \
  && grep -q '^[[:space:]]*unlet!' "$COLOR"; then
  pass "Betelgeuse.vim guards re-entrancy, runs highlight clear before &background, defines else fallback, and uses unlet!"
else
  fail "Betelgeuse.vim lacks re-entrancy guard, highlight-clear ordering, else fallback, or unlet!"
fi

# 4. vimrc preserves $VIMRUNTIME, guards vim-plug before colorscheme, and uses XDG state
plug_line="$(grep -n 'plug#begin' "$VIMRC" | head -n1 | cut -d: -f1)"
color_line="$(grep -n 'colorscheme Betelgeuse' "$VIMRC" | head -n1 | cut -d: -f1)"
if ! grep -q '^set runtimepath=' "$VIMRC" \
  && grep -q 'autoload/plug\.vim' "$VIMRC" \
  && [ -n "$plug_line" ] && [ -n "$color_line" ] && [ "$plug_line" -lt "$color_line" ] \
  && ! grep -q '\.config/\.vim/temp_dirs/undodir' "$VIMRC"; then
  pass "vimrc preserves default runtimepath, guards vim-plug before colorscheme, and drops broken .config/.vim undodir"
else
  fail "vimrc still overwrites runtimepath=, leaves vim-plug unguarded/after colorscheme, or uses broken .config/.vim undodir"
fi

# 5. profile.sh.tmpl guards VIMINIT and GVIMINIT against missing files and Neovim
if grep -q 'GVIMINIT=.*!has("nvim").*filereadable(\$MYGVIMRC)' "$PROFILE_TMPL" \
  && grep -q 'VIMINIT=.*!has("nvim").*filereadable(\$MYVIMRC)' "$PROFILE_TMPL"; then
  pass "profile.sh.tmpl guards VIMINIT and GVIMINIT with !has(\"nvim\") and filereadable(...)"
else
  fail "profile.sh.tmpl leaves VIMINIT or GVIMINIT unguarded"
fi

# 6. Live Vim 9+ runtime verification (clean startup, Issue #78 rogue file immunity + cleanup, light/dark toggle, persistent undo)
if command -v vim >/dev/null 2>&1; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  setup_isolated_vim_home() {
    local base="$1"
    mkdir -p "$base/home" "$base/config/vim/colors" "$base/data" "$base/state"
    cp "$VIMRC" "$base/config/vim/vimrc"
    cp "$COLOR" "$base/config/vim/colors/Betelgeuse.vim"
  }

  # 6a. Fresh host WITHOUT autoload/plug.vim: edit & save hey.txt with zero errors, persistent undo, no ~/.viminfo
  setup_isolated_vim_home "$TMP/clean"
  HOME="$TMP/clean/home" \
  XDG_CONFIG_HOME="$TMP/clean/config" \
  XDG_DATA_HOME="$TMP/clean/data" \
  XDG_STATE_HOME="$TMP/clean/state" \
  MYVIMRC="$TMP/clean/config/vim/vimrc" \
  VIMINIT='if !has("nvim") && filereadable($MYVIMRC) | source $MYVIMRC | endif' \
    vim --not-a-term -V1"$TMP/clean/vim.log" \
      -c 'call setline(1, ["hello install.doctor #78"])' \
      -c 'wq!' \
      "$TMP/clean/hey.txt" </dev/null >/dev/null 2>&1
  vim_rc=$?

  if [ "$vim_rc" -eq 0 ] \
    && [ -f "$TMP/clean/hey.txt" ] \
    && grep -qxF 'hello install.doctor #78' "$TMP/clean/hey.txt" \
    && ! grep -E 'Error detected|E117:|E492:|E679:|E169:|E121:|E108:|E484:' "$TMP/clean/vim.log" >/dev/null 2>&1; then
    pass "live vim opens, edits, and saves hey.txt without plug.vim with exit 0 and zero startup errors"
  else
    fail "live vim emitted startup errors or non-zero exit (rc=$vim_rc)"
    grep -E 'Error detected|E[0-9]+:' "$TMP/clean/vim.log" >&2 || true
  fi

  if [ -d "$TMP/clean/state/vim/undo" ] && [ ! -e "$TMP/clean/home/.viminfo" ]; then
    pass "live vim creates XDG undo directory and avoids polluting \$HOME/.viminfo"
  else
    fail "live vim missing XDG state/vim/undo directory or leaked \$HOME/.viminfo"
  fi

  # 6b. Verify runtimepath retains $VIMRUNTIME and Betelgeuse colorscheme is active in both dark and light modes
  HOME="$TMP/clean/home" \
  XDG_CONFIG_HOME="$TMP/clean/config" \
  XDG_DATA_HOME="$TMP/clean/data" \
  XDG_STATE_HOME="$TMP/clean/state" \
  MYVIMRC="$TMP/clean/config/vim/vimrc" \
  VIMINIT='if !has("nvim") && filereadable($MYVIMRC) | source $MYVIMRC | endif' \
    vim --not-a-term -V1"$TMP/clean/CheckRtp.log" \
      -c 'if stridx(&runtimepath, $VIMRUNTIME) < 0 | cquit 3 | endif' \
      -c 'if get(g:, "colors_name", "") !=# "Betelgeuse" | cquit 4 | endif' \
      -c 'set background=light | colorscheme Betelgeuse' \
      -c 'set background=dark | colorscheme Betelgeuse' \
      -c 'qa!' </dev/null >/dev/null 2>&1
  rtp_rc=$?
  if [ "$rtp_rc" -eq 0 ] \
    && ! grep -E 'Error detected|E[0-9]+:' "$TMP/clean/CheckRtp.log" >/dev/null 2>&1; then
    pass "live vim preserves \$VIMRUNTIME in runtimepath and switches Betelgeuse light/dark cleanly"
  else
    fail "live vim failed runtimepath or light/dark Betelgeuse switch (rc=$rtp_rc)"
    grep -E 'Error detected|E[0-9]+:' "$TMP/clean/CheckRtp.log" >&2 || true
  fi

  # 6c. Issue #78 exact reproduction: rogue colors/lists/default.vim present
  setup_isolated_vim_home "$TMP/rogue"
  mkdir -p "$TMP/rogue/config/vim/colors/lists"
  cp "$COLOR" "$TMP/rogue/config/vim/colors/lists/default.vim"

  # Even before post-vim.sh runs, hardened Betelgeuse.vim must not trigger E679 / SEGV if sourced via syncolor.vim
  HOME="$TMP/rogue/home" \
  XDG_CONFIG_HOME="$TMP/rogue/config" \
  XDG_DATA_HOME="$TMP/rogue/data" \
  XDG_STATE_HOME="$TMP/rogue/state" \
  MYVIMRC="$TMP/rogue/config/vim/vimrc" \
  VIMINIT='if !has("nvim") && filereadable($MYVIMRC) | source $MYVIMRC | endif' \
    vim --not-a-term -V1"$TMP/rogue/pre_hook.log" -c 'qa!' "$TMP/rogue/hey.txt" </dev/null >/dev/null 2>&1
  pre_rc=$?
  if [ "$pre_rc" -eq 0 ] \
    && ! grep -E 'E679:|E169:|E121:|E108:' "$TMP/rogue/pre_hook.log" >/dev/null 2>&1; then
    pass "hardened Betelgeuse.vim prevents E679 syncolor recursion and SEGV even if placed in colors/lists/default.vim"
  else
    fail "Betelgeuse.vim still recurses or errors when placed in colors/lists/default.vim (rc=$pre_rc)"
    grep -E 'Error detected|E[0-9]+:' "$TMP/rogue/pre_hook.log" >&2 || true
  fi

  # post-vim.sh detects (--check -> 10), removes (--apply -> 0), and verifies (--verify -> 0) rogue colors/lists/default.vim
  HOME="$TMP/rogue/home" XDG_CONFIG_HOME="$TMP/rogue/config" XDG_DATA_HOME="$TMP/rogue/data" XDG_STATE_HOME="$TMP/rogue/state" \
    bash "$POST_VIM" --apply >/dev/null 2>&1 || true
  # Re-plant rogue file after initial state creation so --check specifically flags rogue colors/lists/default.vim
  mkdir -p "$TMP/rogue/config/vim/colors/lists"
  cp "$COLOR" "$TMP/rogue/config/vim/colors/lists/default.vim"

  HOME="$TMP/rogue/home" XDG_CONFIG_HOME="$TMP/rogue/config" XDG_DATA_HOME="$TMP/rogue/data" XDG_STATE_HOME="$TMP/rogue/state" \
    bash "$POST_VIM" --check >/dev/null 2>&1
  check_rc=$?
  HOME="$TMP/rogue/home" XDG_CONFIG_HOME="$TMP/rogue/config" XDG_DATA_HOME="$TMP/rogue/data" XDG_STATE_HOME="$TMP/rogue/state" \
    bash "$POST_VIM" --apply >/dev/null 2>&1
  apply_rc=$?
  HOME="$TMP/rogue/home" XDG_CONFIG_HOME="$TMP/rogue/config" XDG_DATA_HOME="$TMP/rogue/data" XDG_STATE_HOME="$TMP/rogue/state" \
    bash "$POST_VIM" --verify >/dev/null 2>&1
  verify_rc=$?

  if [ "$check_rc" -eq 10 ] && [ "$apply_rc" -eq 0 ] && [ "$verify_rc" -eq 0 ] \
    && [ ! -e "$TMP/rogue/config/vim/colors/lists/default.vim" ]; then
    pass "post-vim.sh detects (--check=10), removes (--apply=0), and verifies (--verify=0) legacy colors/lists/default.vim"
  else
    fail "post-vim.sh failed rogue colors/lists/default.vim lifecycle (check=$check_rc apply=$apply_rc verify=$verify_rc)"
  fi

  # 6d. GVIMINIT guard does not error when gvimrc is absent, and vim-plug loads cleanly when autoload/plug.vim is present
  mkdir -p "$TMP/clean/config/vim/autoload" "$TMP/clean/data/vim/plugged/vim-sensible"
  cat > "$TMP/clean/config/vim/autoload/plug.vim" <<'EOF'
let g:test_plugs = []
function! plug#begin(...) abort
  command! -nargs=+ -bar Plug call add(g:test_plugs, <q-args>)
endfunction
function! plug#end() abort
  delcommand Plug
endfunction
EOF

  HOME="$TMP/clean/home" \
  XDG_CONFIG_HOME="$TMP/clean/config" \
  XDG_DATA_HOME="$TMP/clean/data" \
  XDG_STATE_HOME="$TMP/clean/state" \
  MYVIMRC="$TMP/clean/config/vim/vimrc" \
  MYGVIMRC="$TMP/clean/config/vim/gvimrc" \
  VIMINIT='if !has("nvim") && filereadable($MYVIMRC) | source $MYVIMRC | endif' \
    vim --not-a-term -V1"$TMP/clean/gvim.log" \
      -c 'if !has("nvim") && filereadable($MYGVIMRC) | source $MYGVIMRC | endif' \
      -c 'if len(get(g:, "test_plugs", [])) != 1 | cquit 5 | endif' \
      -c 'qa!' </dev/null >/dev/null 2>&1
  gvim_rc=$?
  if [ "$gvim_rc" -eq 0 ] && ! grep -E 'Error detected|E484:|E117:|E492:' "$TMP/clean/gvim.log" >/dev/null 2>&1; then
    pass "GVIMINIT guard succeeds when gvimrc is absent and vim-plug registers installed plugins when plug.vim exists"
  else
    fail "GVIMINIT guard or vim-plug registration failed (rc=$gvim_rc)"
    grep -E 'Error detected|E[0-9]+:' "$TMP/clean/gvim.log" >&2 || true
  fi
fi

printf 'vim-config: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
