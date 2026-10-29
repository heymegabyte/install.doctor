#!/usr/bin/env bash
# D09/D10/E10/W — installer supply-chain hygiene (fire #144). Every REMOTE-CODE-EXECUTION site in the
# installer scripts (home/dot_local/bin/post-installx + home/.chezmoiscripts) — a pipe-to-shell
# (curl|wget … | sh/bash) OR a download-then-execute (curl/wget → a tmp file, then sh/bash that file) —
# MUST be documented in scripts/installer-supply-chain-allowlist.json with a reason + a status
# (sanctioned = official installer with a mitigation like a mandatory dry-run; known-gap = a real
# unverified-download gap to harden later). A NEW undocumented remote-exec site FAILS the gate — so a
# stray `curl … | sh` can't creep into an installer unnoticed. The gate also rejects STALE allowlist
# entries (no matching site) and entries missing a reason/valid-status. A LOCAL test (no network); it
# does NOT claim the downloads are verified — it makes every remote-exec site VISIBLE + tracked.
set -uo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
PIX="$dir/../home/dot_local/bin/post-installx"
CHS="$dir/../home/.chezmoiscripts"
ALLOW="$dir/installer-supply-chain-allowlist.json"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "installer supply-chain hygiene (D09/D10) @ $PIX + $CHS"

# Detect every remote-code-execution site (by script basename), across both installer trees.
remote_exec_sites() {
  {
    # P1 — pipe-to-shell: curl/wget … | sh/bash
    grep -rlE '(curl|wget)[^|]*\|[^|]*\b(ba)?sh\b' "$PIX" "$CHS" 2>/dev/null
    # P2 — download-then-execute: a script that BOTH downloads (curl/wget to a file) AND execs a tmp file
    while IFS= read -r f; do
      [ -f "$f" ] || continue
      if grep -qE '(curl|wget).*(-o |-O |> )' "$f" 2>/dev/null &&
        grep -qE '\b(ba)?sh\s+"?\$?\{?(TMP|[A-Za-z_]*_TMP)|\b(ba)?sh\s+/tmp/' "$f" 2>/dev/null; then
        printf '%s\n' "$f"
      fi
    done < <(find "$PIX" "$CHS" -type f 2>/dev/null)
  } | while IFS= read -r p; do [ -n "$p" ] && basename "$p"; done | sort -u
}

sites="$(remote_exec_sites)"
nsites="$(printf '%s\n' "$sites" | grep -c .)"
[ "$nsites" -gt 0 ] && pass "detected $nsites remote-code-execution site(s) in the installer scripts" || fail "detector found 0 remote-exec sites (the detector itself is likely broken — cua + nginx-amplify are known sites)"

inlist() { [ -f "$ALLOW" ] && jq -e --arg k "$1" 'has($k)' "$ALLOW" >/dev/null 2>&1; }

if [ -f "$ALLOW" ]; then
  # (1) every detected remote-exec site is documented in the allowlist (else a new one slipped in).
  undoc=""
  for s in $sites; do inlist "$s" || undoc="$undoc $s"; done
  [ -z "$undoc" ] && pass "every remote-exec site is documented in the allowlist (no undocumented curl|sh / download-then-exec)" || fail "UNDOCUMENTED remote-exec site(s) — add to $ALLOW or remove the pattern:$undoc"

  # (2) no STALE allowlist entry — every key still corresponds to a detected site.
  stale=""
  for k in $(jq -r 'keys[]' "$ALLOW" 2>/dev/null); do printf '%s\n' "$sites" | grep -qx "$k" || stale="$stale $k"; done
  [ -z "$stale" ] && pass "no stale allowlist entries (every entry has a live remote-exec site)" || fail "stale allowlist entries (no matching site — remove):$stale"

  # (3) every entry carries a reason + a valid status (sanctioned|known-gap).
  badmeta=""
  for k in $(jq -r 'keys[]' "$ALLOW" 2>/dev/null); do
    r="$(jq -r --arg k "$k" '.[$k].reason // ""' "$ALLOW" 2>/dev/null)"
    st="$(jq -r --arg k "$k" '.[$k].status // ""' "$ALLOW" 2>/dev/null)"
    { [ -n "$r" ] && { [ "$st" = "sanctioned" ] || [ "$st" = "known-gap" ]; }; } || badmeta="$badmeta $k"
  done
  [ -z "$badmeta" ] && pass "every allowlist entry documents a reason + a valid status (sanctioned|known-gap)" || fail "entries missing reason/valid-status:$badmeta"

  # (4) honesty — surface the known-gap sites so they are TRACKED, never hidden behind a green gate.
  gaps="$(jq -r 'to_entries[] | select(.value.status=="known-gap") | .key' "$ALLOW" 2>/dev/null | tr '\n' ' ')"
  sanc="$(jq -r 'to_entries[] | select(.value.status=="sanctioned") | .key' "$ALLOW" 2>/dev/null | tr '\n' ' ')"
  say "  sanctioned: ${sanc:-none}"
  say "  known-gap (harden later): ${gaps:-none}"
  pass "known-gap remote-exec sites are tracked, not hidden (sanctioned=$(printf '%s' "$sanc" | wc -w | tr -d ' '), known-gap=$(printf '%s' "$gaps" | wc -w | tr -d ' '))"
else
  fail "allowlist missing ($ALLOW) — create it to document every installer remote-exec site (reason + status)"
fi

# (5) #145 — no installer script fetches EXECUTABLE code from a MOVING git branch (a /raw/master or /raw/main
# URL): a moving branch is an un-pinned, mutable supply-chain input (today's install.sh != tomorrow's). Pin to
# a release tag or commit SHA + verify a checksum instead. Per-file comment lines (^\s*#) are stripped first so
# a documentation-marker URL in a comment is not flagged. (This is what caught the archived nginx-amplify fetch.)
movingbranch=""
while IFS= read -r f; do
  [ -f "$f" ] || continue
  grep -vE '^[[:space:]]*#' "$f" 2>/dev/null | grep -qE '(curl|wget)[^|]*(github\.com/[^ ]*/raw/(master|main)/|raw\.githubusercontent\.com/[^ ]*/(master|main)/)' && movingbranch="$movingbranch $(basename "$f")"
done < <(find "$PIX" "$CHS" -type f 2>/dev/null)
[ -z "$movingbranch" ] && pass "no installer fetches executable code from a moving git branch (/raw/master|main) — pinned refs only (D09 supply-chain)" || fail "installer fetches from a MOVING branch (pin to a tag/commit + checksum):$movingbranch"

say "installer-supply-chain: $P passed, $F failed"
[ "$F" -eq 0 ]
