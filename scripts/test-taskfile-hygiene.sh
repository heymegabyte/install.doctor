#!/usr/bin/env bash
# Taskfile hygiene gate (fire #357). The 1196-line Taskfile is Megabyte-Labs-template-derived + carries legacy
# template machinery. One concrete footgun: a `curl … gitlab.com/…/-/blob/<path> > <file>` downloads the GitLab
# HTML *blob VIEW*, not the raw file (the raw form is `/-/raw/`) — so the redirect writes an HTML page into the
# target file. The vestigial `fresh` template-init task had 4 of these (overwriting the repo's own live
# package.json/.gitignore/… with HTML from the STALE megabyte-labs org); #357 removed `fresh`. This gate locks
# the bug CLASS: ZERO `curl … /-/blob/… > file` raw-fetch-via-blob redirects in the Taskfile. Non-vacuous
# (asserts the Taskfile actually has curl commands to check). No `\b` (BSD-grep-unsafe). Pure file assertions.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF="${TASKFILE:-$ROOT/Taskfile.yml}"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "Taskfile hygiene (no blob-as-raw curl footguns)"

if [ ! -f "$TF" ]; then
  fail "Taskfile.yml MISSING ($TF)"
  say "taskfile-hygiene: $P passed, $F failed"
  exit 1
fi

# 1. Non-vacuity: the Taskfile actually contains curl commands (else the blob check below is vacuous).
curls="$(grep -cE 'curl ' "$TF" 2> /dev/null || echo 0)"
if [ "${curls:-0}" -ge 1 ]; then
  pass "Taskfile has $curls curl command(s) to check (gate is non-vacuous)"
else
  fail "no curl commands found in the Taskfile — grep/path wrong, the blob check would be vacuous"
fi

# 2. ZERO `curl … /-/blob/… > file` — a /-/blob/ URL serves HTML, not the raw file, so the redirect corrupts
#    the target. The correct raw form is /-/raw/. (Catches the removed `fresh`-task class + any re-introduction.)
blob="$(grep -nE 'curl[^|]*/-/blob/[^|]*>' "$TF" 2> /dev/null || true)"
if [ -z "$blob" ]; then
  pass "no blob-as-raw curl redirects — every raw fetch uses /-/raw/ (not the HTML /-/blob/ view)"
else
  fail "curl fetches a GitLab /-/blob/ (HTML) URL into a file — use /-/raw/ instead: $(printf '%s' "$blob" | tr '\n' ';')"
fi

say "taskfile-hygiene: $P passed, $F failed"
[ "$F" -eq 0 ]
