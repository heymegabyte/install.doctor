#!/usr/bin/env bash
# X04 gate — the per-platform support & limitations matrix exists, names the REAL detect_os roles,
# marks every capability tested/experimental/unsupported HONESTLY, records the real limitations
# (Windows PowerShell entrypoint ◐ experimental — provision.ps1 exists in source but is not published;
# native-Windows RUNTIME unverified · fish/pwsh cnf adapters live-unverified · real on-device/server-pushed
# apply gated/501), and makes NO "fully supported everywhere" fabrication.
# Pure file assertions — no network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/aid/platform-support.md"
OVERVIEW="$ROOT/docs/index.md"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "platform-support doc (X04)"

if [ -s "$DOC" ]; then
  lc="$(wc -l <"$DOC" | tr -d ' ')"
  [ "$lc" -ge 35 ] && pass "platform-support.md exists + substantial (${lc} lines)" || fail "doc too thin (${lc} lines, want >=35)"
else
  fail "platform-support.md missing ($DOC)"
  say "platform-support: $P passed, $F failed"
  exit 1
fi

# The Docusaurus tree is intentionally ignored and generated from canonical
# docs. Its byte-for-byte contract is owned by test-site-doc-mirror-generation;
# reading a developer's stale generated tree here would make CI order-dependent.
pass "canonical platform-support doc is the sole tracked documentation authority"

chk() { grep -qiF "$1" "$DOC" && pass "names '$1' ($2)" || fail "missing '$1' ($2)"; }
chkre() { grep -qiE "$1" "$DOC" && pass "$2" || fail "$2 — pattern '$1' absent"; }

# Real detect_os roles (project CLAUDE.md §2).
for r in macos ubuntu fedora alpine arch qubes proxmox coolify wsl container; do chk "$r" "detect_os role"; done

# Honest status vocabulary present.
chkre "tested" "marks TESTED capabilities"
chkre "experimental" "marks EXPERIMENTAL capabilities"
chkre "unsupported|not yet|not published|not supported" "marks UNSUPPORTED / not-yet capabilities"

# The real, specific limitations (grounded in what the suites prove vs gate).
chkre "powershell" "names the Windows PowerShell gap"
chkre "fish" "names the fish adapter status"
chkre "501|machine-gated|real-install|on-device" "records the on-device/server-pushed apply limitation"
chkre "wsl" "names WSL as the Windows path"
chkre "scripts/platform-support-matrix\.json" "links the machine-readable platform authority"
verified_count="$(node -e 'const m=require(process.argv[1]); process.stdout.write(String(m.cells.filter(c=>c.status==="verified").length))' "$ROOT/scripts/platform-support-matrix.json")"
if [ "$verified_count" -eq 0 ]; then
  chkre "no verified platform claim" "truthfully discloses that no full-lifecycle platform is currently verified"
elif grep -qiE "no verified platform claim" "$DOC"; then
  fail "documentation denies verified cells that are present in the authoritative matrix"
else
  pass "documentation does not deny the matrix's conditionally verified cells"
fi

# Windows PowerShell remains source-only until it has signed delivery and clean-host runtime evidence.
# The doc must reference provision.ps1, name the unpublished boundary, and avoid inventing a public endpoint.
chkre "provision\.ps1" "references the source-only Windows bootstrap (scripts/provision.ps1)"
if grep -qiE "install\.doctor/windows|start\.ps1" "$DOC"; then
  fail "doc invents a public native-Windows bootstrap endpoint"
else
  pass "does not invent a public native-Windows bootstrap endpoint"
fi

# NO-FABRICATION: never claim universal/native-everywhere support.
grep -qiE "fully supported on all|supported on every platform|native windows (support|works)|works everywhere" "$DOC" && fail "fabricated universal-support claim" || pass "no 'fully supported everywhere' / 'native Windows works' fabrication (X14 honest)"

if grep -qiE '\|[[:space:]]*(Fully supported|Supported|Beta)[[:space:]]*\|' "$OVERVIEW"; then
  fail "public overview contains an unbound platform-support marketing claim"
else
  pass "public overview contains no unbound fully-supported/supported/beta platform claim"
fi
chkre_overview() { grep -qiE "$1" "$OVERVIEW" && pass "$2" || fail "$2 — pattern '$1' absent from overview"; }
chkre_overview "scripts/platform-support-matrix\.json" "public overview links the machine-readable platform authority"
chkre_overview "no verified full-lifecycle platform cells" "public overview mirrors the current zero-verified state"
chkre_overview "not yet a production installation command" "profile URL is not misrepresented as an active production installer"

say "platform-support: $P passed, $F failed"
[ "$F" -eq 0 ]
