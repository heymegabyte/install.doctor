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
# DOWN-ONLY RATCHET (same idiom as test-preload-policy + X11): it does NOT force-pin the existing 16 (that is a
# network-dependent focused session — tracked in BACKLOG.md), but it FAILS the instant a NEW floating-ref
# external is added, so every FUTURE external must be PINNED to a SHA/tag (or the baseline consciously bumped).
# Pure file assertion — no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
EXT="home/.chezmoiexternal.toml.tmpl"
BASELINE="${CHEZMOI_EXTERNAL_FLOATING_BUDGET:-16}" # ratchet: may only go DOWN as externals get pinned (16 @ #298)

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "chezmoiexternal supply-chain integrity (floating-ref down-only ratchet)"

# The moving-branch URL signature (NOT a pinned SHA/tag). Excludes comment lines.
FLOATING_RE='url[[:space:]]*=.*(/raw/master|/raw/main|raw\.githubusercontent\.com/[^"]*/(master|main)/|/releases/latest/|@latest)'

if [ ! -f "$EXT" ]; then
  fail "$EXT missing — the chezmoiexternal manifest is gone"
else
  n="$(grep -vE '^[[:space:]]*#' "$EXT" | grep -cE "$FLOATING_RE")"

  # 1. the down-only ratchet — a NEW floating-ref external fails CI (pin it, don't add another /master pull).
  if [ "$n" -le "$BASELINE" ]; then
    pass "floating-ref externals: $n ≤ $BASELINE baseline (down-only — a NEW external must be PINNED to a commit SHA / version tag, never a fresh /master|/main pull)"
  else
    fail "floating-ref externals: $n > $BASELINE baseline — a NEW moving-branch download was added. PIN it (commit SHA or version tag) for reproducibility + supply-chain safety, OR consciously bump CHEZMOI_EXTERNAL_FLOATING_BUDGET (the ratchet is down-only — prefer pinning)"
  fi

  # 2. non-vacuity — the detector must actually match the known floating set, else a broken regex would make
  #    the ratchet pass vacuously (0 ≤ 16). The baseline is well-known to be ~16, so assert ≥1.
  if [ "$n" -ge 1 ]; then
    pass "floating-ref detector is non-vacuous (matched $n known moving-branch externals — a broken regex would read 0)"
  else
    fail "floating-ref detector matched 0 — the regex broke; it must match the known moving-branch externals (fzf/tmux/goto/…)"
  fi
fi

say "external-integrity: $P passed, $F failed"
[ "$F" -eq 0 ]
