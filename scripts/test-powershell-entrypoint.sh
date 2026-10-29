#!/usr/bin/env bash
# B02 — native Windows PowerShell bootstrap entrypoint gate.
#
# `scripts/provision.ps1` is the Windows counterpart of `scripts/provision.sh` (the bash bootstrap that
# `https://install.doctor/start` 301s to). The Firebase redirect `https://install.doctor/windows` already
# points at `.../scripts/provision.ps1` — before this file existed it 301'd to a 404 (a live dangling
# redirect). Windows / pwsh are routinely ABSENT on this runner, so — exactly like the pwsh cnf adapter
# gate (test-pwsh-cnf.sh) — we (a) STRUCTURALLY assert the bootstrap CONTRACT so its semantics are gated
# with no Windows runtime, and (b) parse-check with pwsh when it IS present. Honest: the LIVE native-Windows
# run is GATED (skipped) when pwsh is absent — never claimed as verified (the master prompt forbids claiming
# Windows verification from a non-Windows host).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PS1="$ROOT/scripts/provision.ps1"
FIREBASE="$ROOT/site/firebase.json"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0; F=0

say "Windows PowerShell bootstrap entrypoint (B02)"

if [ -s "$PS1" ]; then
  pass "scripts/provision.ps1 exists + non-empty"
else
  fail "scripts/provision.ps1 missing/empty ($PS1)"
  say "powershell-entrypoint: $P passed, $F failed"
  exit 1
fi

has(){ grep -q "$1" "$PS1" && pass "$2" || fail "$2 — missing '$1'"; }
hasre(){ grep -qE "$1" "$PS1" && pass "$2" || fail "$2 — pattern '$1' absent"; }

# --- Identity + safety preamble -------------------------------------------------------------------
hasre '#Requires -Version'                 "declares a PowerShell version floor (#Requires)"
grep -qiF 'install.doctor' "$PS1" && pass "self-identifies as the install.doctor bootstrap" || fail "no install.doctor identity"
grep -qiF '/windows' "$PS1" && pass "documents that https://install.doctor/windows points here" || fail "does not reference the /windows redirect it serves"
hasre "ErrorActionPreference\s*=\s*'Stop'" "sets \$ErrorActionPreference = 'Stop' (fail-fast)"

# --- Env-var contract parity with provision.sh ----------------------------------------------------
has 'START_REPO'        "honors START_REPO (fork URL) — contract parity with provision.sh"
has 'REPO'              "honors REPO (START_REPO alternate)"
has 'HEADLESS_INSTALL'  "honors HEADLESS_INSTALL (skip prompts)"
hasre 'env:CI|TEST_INSTALL' "honors CI / TEST_INSTALL (non-interactive CI mode)"

# --- Canonical provenance: ship clean (heymegabyte), never the legacy org -------------------------
grep -qiF 'heymegabyte/install.doctor' "$PS1" && pass "default repo = canonical heymegabyte/install.doctor" || fail "default repo is not the canonical heymegabyte org"
grep -qiF 'megabyte-labs' "$PS1" && fail "ships the LEGACY megabyte-labs org (stale provenance)" || pass "no legacy megabyte-labs reference (clean provenance)"

# --- Native detection (OS/arch/privilege) ---------------------------------------------------------
hasre 'PROCESSOR_ARCHITECTURE|RuntimeInformation|OSArchitecture' "detects architecture natively"
hasre 'WindowsPrincipal|IsInRole|Administrator'                  "detects elevation (Administrator) natively"

# --- Non-interactive discipline (mirror provision.sh's -y everywhere) ------------------------------
hasre 'NonInteractive|\$Headless'                                 "computes a non-interactive gate"
hasre '\-\-silent|accept-package-agreements|accept-source-agreements' "uses SILENT package-manager flags (never blocks on a prompt)"

# --- Native dependency path: package manager -> git + chezmoi -> handoff ---------------------------
has 'winget'   "ensures a Windows package manager (winget)"
hasre 'scoop|choco' "has a package-manager fallback (scoop/choco)"
has 'chezmoi'  "hands off provisioning to chezmoi (parity with provision.sh)"
grep -qiF 'app.install.doctor' "$PS1" && pass "points the operator at app.install.doctor (pairing)" || fail "no app.install.doctor next-step"

# --- Secret hygiene: never echo a password/token (invariant: secret VALUES stay out of logs) -------
if grep -qiE 'Write-(Host|Output|Information).*(PASSWORD|TOKEN|SECRET|KEY)' "$PS1"; then
  fail "echoes a secret-bearing value (Write-* of PASSWORD/TOKEN/SECRET/KEY)"
else
  pass "no secret-echo antipattern (no Write-* of PASSWORD/TOKEN/SECRET/KEY)"
fi

# --- Gross-syntax sanity without a parser: balanced delimiters -------------------------------------
ob=$(tr -cd '{' < "$PS1" | wc -c | tr -d ' '); cb=$(tr -cd '}' < "$PS1" | wc -c | tr -d ' ')
op=$(tr -cd '(' < "$PS1" | wc -c | tr -d ' '); cp=$(tr -cd ')' < "$PS1" | wc -c | tr -d ' ')
[ "$ob" = "$cb" ] && pass "braces balanced ({ $ob == } $cb)" || fail "brace imbalance ({ $ob != } $cb)"
[ "$op" = "$cp" ] && pass "parens balanced (( $op == ) $cp)" || fail "paren imbalance (( $op != ) $cp)"

# --- Serving wiring: the /windows redirect must target scripts/provision.ps1 -----------------------
if [ -f "$FIREBASE" ]; then
  if grep -A2 '"/windows"' "$FIREBASE" | grep -q 'scripts/provision.ps1'; then
    pass "firebase /windows redirect targets scripts/provision.ps1"
  else
    fail "firebase /windows redirect does not target scripts/provision.ps1"
  fi
  # The /windows redirect should serve from the canonical owned org (so the file we push is the file served).
  if grep -A2 '"/windows"' "$FIREBASE" | grep -q 'heymegabyte/install.doctor'; then
    pass "/windows redirect serves from the canonical heymegabyte org"
  else
    fail "/windows redirect still points at a non-canonical org (serves a file we don't push)"
  fi
else
  skip "site/firebase.json absent — cannot verify /windows wiring"
fi

# --- pwsh parse-check (gated — never claim Windows verification from a non-Windows host) -----------
if command -v pwsh >/dev/null 2>&1; then
  if pwsh -NoProfile -Command "\$e=\$null; [System.Management.Automation.Language.Parser]::ParseFile('$PS1',[ref]\$null,[ref]\$e) > \$null; if (\$e.Count -gt 0) { exit 1 }" >/dev/null 2>&1; then
    pass "pwsh parse-check OK ($(pwsh --version 2>/dev/null))"
  else
    fail "pwsh parse-check reported a syntax error"
  fi
else
  skip "pwsh not installed on runner — LIVE native-Windows bootstrap run GATED (not claimed verified); structural contract above holds"
fi

say "powershell-entrypoint: $P passed, $F failed"
[ "$F" -eq 0 ]
