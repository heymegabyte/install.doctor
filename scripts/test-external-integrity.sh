#!/usr/bin/env bash
# chezmoiexternal supply-chain integrity gate (#298) — a DOWN-ONLY floating-ref ratchet.
#
# home/.chezmoiexternal.toml.tmpl fetches external assets during `chezmoi apply`. ~16 entries pull EXECUTABLE
# shell / fonts / a key from a MOVING branch (`raw.githubusercontent.com/<repo>/master|main/…`, `/raw/master`,
# `releases/latest`) rather than a pinned commit SHA or version tag. A moving ref is non-reproducible AND a
# supply-chain exposure: a compromised or merely-changed upstream `master` silently lands new content on the
# next machine's first apply. (Mitigations: NO entry sets `refreshPeriod`, so each is fetched ONCE per machine
# + chezmoi-cached — not re-pulled every apply; many deliberately track their tool — fzf/tmux/goto shell
# integrations.) The installer-supply-chain gate (#144/#145) covers pipe-to-shell in the installer SCRIPTS but
# NOT these downloads — this gate closes that surface.
#
# Zero-tolerance gate: executable externals must use a full immutable commit
# and bind the downloaded bytes by size and SHA-256. Pure file assertion.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
EXT="home/.chezmoiexternal.toml.tmpl"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "chezmoiexternal supply-chain integrity (immutable executable externals)"

# The moving-branch URL signature (NOT a pinned SHA/tag). Excludes comment lines.
FLOATING_RE='url[[:space:]]*=.*(/raw/master|/raw/main|raw\.githubusercontent\.com/[^"]*/(master|main)/|/releases/latest/|@latest)'

if [ ! -f "$EXT" ]; then
  fail "$EXT missing — the chezmoiexternal manifest is gone"
else
  n="$(grep -vE '^[[:space:]]*#' "$EXT" | grep -cE "$FLOATING_RE")"

  if [ "$n" -eq 0 ]; then
    pass "floating-ref executable externals: zero"
  else
    fail "floating-ref executable externals: $n (full commit pins are required)"
  fi

  pinned="$(grep -cE 'raw\.githubusercontent\.com/[^/]+/[^/]+/[a-f0-9]{40}/' "$EXT")"
  digests="$(grep -cE 'checksum\.sha256[[:space:]]*=[[:space:]]*"[a-f0-9]{64}"' "$EXT")"
  sizes="$(grep -cE 'checksum\.size[[:space:]]*=[[:space:]]*[1-9][0-9]*' "$EXT")"
  if [ "$pinned" -ge 10 ] && [ "$digests" -ge 15 ] && [ "$sizes" -ge 15 ]; then
    pass "all executable and font externals bind immutable source, SHA-256, and size"
  else
    fail "external authority incomplete (commit=$pinned sha256=$digests size=$sizes expected>=10/15/15)"
  fi
  if grep -q 'cacert-2026-11-05.pem' "$EXT" \
    && grep -q '427c064216761a1e72a8b30f0d954d08cb6e4435a82091fb865afd20c8497285' "$EXT" \
    && grep -q 'checksum.size = 200116' "$EXT"; then
    pass 'Mozilla CA bundle is date-pinned and bound by SHA-256 and size'
  else
    fail 'Mozilla CA bundle lacks immutable trust authority'
  fi
  font_authority=1
  for binding in \
    '0aa54352dfb5a20a736e384409e378f22fde3726bf5d30318934e4ee6853b2b1:2445204' \
    '8c02ee30eb4e371e3e769fc17f761d08b0d6665af623ca8ef7d86819c77b5498:2453600' \
    '0bd831dcf9cf0e51a7f5b346a414340cb4edf7c5d1c23915fe742223b2c37827:2452644' \
    '746205166b20dd962aafca3971c7fedd4c87e59b17f4fe8569e61467bcea9766:2459276'; do
    grep -q "${binding%:*}" "$EXT" && grep -q "checksum.size = ${binding#*:}" "$EXT" || font_authority=0
  done
  if [ "$font_authority" -eq 1 ] && grep -q 'b6c7639200240f2608e751a3aafe1720125895b3' "$EXT"; then
    pass 'all four Nerd Font artifacts bind an immutable commit, SHA-256, and size'
  else
    fail 'Nerd Font artifact authority is incomplete'
  fi
  vim_plugin_data="$(awk '/^vimPlugins:$/ { in_vim=1 } in_vim && /^qubes:$/ { exit } in_vim' home/.chezmoidata.yaml)"
  plugin_commits="$(printf '%s\n' "$vim_plugin_data" | grep -cE 'commit: [a-f0-9]{40}')"
  plugin_digests="$(printf '%s\n' "$vim_plugin_data" | grep -cE 'sha256: [a-f0-9]{64}')"
  plugin_sizes="$(printf '%s\n' "$vim_plugin_data" | grep -cE 'size: [1-9][0-9]*')"
  if [ "$plugin_commits" -eq 8 ] && [ "$plugin_digests" -eq 8 ] && [ "$plugin_sizes" -eq 8 ] \
    && grep -q 'https://codeload.github.com/{{ \$vimPlugin.repo }}/tar.gz/{{ \$vimPlugin.commit }}' "$EXT"; then
    pass 'all 8 Vim plugins use immutable checksummed archives'
  else
    fail "Vim plugin authority incomplete (commit=$plugin_commits sha256=$plugin_digests size=$plugin_sizes expected=8)"
  fi
  if ! grep -q 'type = "git-repo"' "$EXT" \
    && grep -q 'sha=854b544c4161a128dfa0da022016ea556b1c56b0' "$EXT" \
    && grep -q 'a0b1b5cb2c7b69d72cc9401a9becda3b7fb8e208b0f97460107a577c3ef99436' "$EXT"; then
    pass 'repository externals are immutable archives; no moving git clone remains'
  else
    fail 'a moving git-repo external or unverified Betelgeuse archive remains'
  fi
fi

say "external-integrity: $P passed, $F failed"
[ "$F" -eq 0 ]
