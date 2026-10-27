#!/usr/bin/env bash
# X06 gate — the private-repo + encrypted-backup RESPONSIBILITY doc exists, names the real I/J concepts
# (per-host private repo, immutable host UUID, what Git stores vs what encrypted backups hold, the
# no-secrets / no-forbidden-data rule, restic, Infisical/Bitwarden references-not-values), AND carries a
# prominent DESIGNED-not-yet-built honesty banner so no one mistakes it for shipping behavior. No network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/aid/repos-and-backups.md"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "repos-and-backups doc (X06)"

if [ -s "$DOC" ]; then
  lc="$(wc -l <"$DOC" | tr -d ' ')"
  [ "$lc" -ge 40 ] && pass "repos-and-backups.md exists + substantial (${lc} lines)" || fail "doc too thin (${lc} lines, want >=40)"
else
  fail "repos-and-backups.md missing ($DOC)"
  say "repos-and-backups: $P passed, $F failed"
  exit 1
fi

chk() { grep -qiF "$1" "$DOC" && pass "names '$1' ($2)" || fail "missing '$1' ($2)"; }
chkre() { grep -qiE "$1" "$DOC" && pass "$3 ($2)" || fail "$3 — pattern '$1' absent ($2)"; }

# Real concepts (I/J matrix + §3 invariants).
chk "private" "I02 one private repo per host"
chk "host UUID" "I01 immutable opaque host id"
chk "restic" "J02 encrypted backup tooling"
chk "Infisical" "Q01 secret authority"
chk "Bitwarden" "interactive creds"
chkre "sanitiz(e|ed)" "I06/I09 sanitized snapshots" "mentions sanitized state"
chkre "encrypted backup" "J backup storage" "distinguishes encrypted backup storage"
chkre "last verified restore|backup age" "J15 freshness" "separates backup age / last verified restore"

# The security contract: what Git stores vs what it must NOT (no secret VALUES / forbidden data).
chkre "secret (value|values)" "Q08 / §3 no secret values in Git" "states secret VALUES never enter Git"
chkre "git stores|stored in git|what git holds|git repository stores" "I06 curated-config scope" "describes what Git stores"

# HONESTY: a prominent DESIGNED / not-yet-built banner (X14) — this must NOT read as shipping.
chkre "designed|not yet built|not built|not yet implemented" "X14 honest status" "carries a DESIGNED-not-built honesty banner"
# NO-FABRICATION: must not claim the repo/backup feature currently works end-to-end.
grep -qiE "fully (built|implemented|working)|ships today|available today|already (creates|backs up)" "$DOC" && fail "claims the (unbuilt) repo/backup feature works today" || pass "no fabricated 'works today' claim for the unbuilt I/J feature (X14 honest)"

say "repos-and-backups: $P passed, $F failed"
[ "$F" -eq 0 ]
