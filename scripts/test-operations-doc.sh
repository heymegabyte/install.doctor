#!/usr/bin/env bash
# X08 gate — the operations (troubleshooting / rollback / decommission) guide exists, names the REAL
# recovery commands + endpoints that ship today (aid-pair · aid up · aid apply · wrangler rollback ·
# D1 Time Travel · POST /api/devices/:id/revoke · revision_mismatch · insufficient_scope), and is
# HONEST about what is NOT built (encrypted-backup restore / replacement-host drills = J ⬜). No network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/aid/operations.md"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "operations doc (X08)"

if [ -s "$DOC" ]; then
  lc="$(wc -l <"$DOC" | tr -d ' ')"
  [ "$lc" -ge 40 ] && pass "operations.md exists + substantial (${lc} lines)" || fail "doc too thin (${lc} lines, want >=40)"
else
  fail "operations.md missing ($DOC)"
  say "operations: $P passed, $F failed"
  exit 1
fi

chk() { grep -qiF "$1" "$DOC" && pass "names '$1' ($2)" || fail "missing '$1' ($2)"; }
chkre() { grep -qiE "$1" "$DOC" && pass "$2" || fail "$2 — pattern '$1' absent"; }

# Troubleshooting — the real recovery commands that ship today.
chk "aid-pair" "re-pair recovery (token revoked/not paired)"
chk "aid up" "drift recovery (pull+plan)"
chk "aid apply" "apply the fix"
chkre "offline|no.network|control.plane (is )?(un)?reachable|standalone" "offline local-plan path (S23)"
chkre "revision_mismatch|stale plan" "stale-plan guard (§3/P09)"
chkre "insufficient_scope|re-pair to widen" "scope-gap recovery (P05)"

# Rollback — control plane.
chk "wrangler rollback" "Worker rollback"
chkre "time.travel|Time Travel" "D1 Time Travel recovery"

# Decommission — the live revoke path.
chkre "/revoke|devices/.*revoke|revoke" "device decommission via revoke (S27)"
chkre "401|rejected|immediately" "revoked token is rejected (live S27/W08)"
chkre "device-token|~/.config/aid|local cleanup" "local token cleanup on the host"

# HONESTY — what is NOT built.
chkre "not built|not yet|⬜|J ⬜|designed" "honest not-built markers (backup restore / J)"
grep -qiE "backup restore (works|is available)|replacement.host (restore )?drill(s)? (work|pass)|fully recoverable today" "$DOC" && fail "fabricated 'backup restore works today' claim" || pass "no fabricated backup-restore-works-today claim (X14 honest)"

say "operations: $P passed, $F failed"
[ "$F" -eq 0 ]
