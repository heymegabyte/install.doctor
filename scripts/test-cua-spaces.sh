#!/usr/bin/env bash
# Cua Spaces provisioning gate (Brian directive 2026-10-28: "ensure Cua Spaces is installed on any
# desktop with 16GB+ RAM"). A chezmoi run_after script installs Cua Spaces during provisioning, GATED
# on: a GUI desktop (not headless/server), >= 16 GiB RAM, a supported OS (macOS/Linux), idempotent
# (skip if `cua` present), opt-out via INSTALL_DOCTOR_CUA=0. Per the cua-spaces rule it dry-runs first,
# NEVER auto-pairs / signs in / unlocks the Keyvault / copies host creds, and excludes the Linux AppImage.
#
# This suite verifies the GATING + GUARDRAILS without installing (the real install path only runs on a
# real qualifying desktop at `chezmoi apply` time — machine-gated, like aid apply / the cnf live-run).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/home/.chezmoiscripts/universal/run_after_21-cua-spaces.sh.tmpl"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "cua-spaces provisioning gate"

[ -f "$SCRIPT" ] || { fail "run_after_21-cua-spaces.sh.tmpl missing ($SCRIPT)"; say "cua-spaces: $P passed, $F failed"; exit 1; }

# 1. valid bash (the .tmpl is plain bash — no template directives, so it parses + runs directly)
bash -n "$SCRIPT" 2>/dev/null && pass "script is valid bash (bash -n)" || fail "bash -n failed"
grep -q '{{' "$SCRIPT" && fail "contains chezmoi template directives ({{) — keep it plain bash for portability" || pass "plain bash (no {{ }} directives)"

# 2. GATING present: GUI/headless, 16 GiB RAM, supported-OS, idempotency, opt-out
grep -qE 'HEADLESS_INSTALL' "$SCRIPT" && pass "headless gate present (HEADLESS_INSTALL)" || fail "no HEADLESS_INSTALL gate"
grep -qE '\b16\b' "$SCRIPT" && pass "16 GiB RAM gate present" || fail "no 16 GiB RAM gate"
{ grep -q 'hw.memsize' "$SCRIPT" && grep -q 'MemTotal' "$SCRIPT"; } && pass "RAM detection for BOTH macOS (hw.memsize) + Linux (/proc/meminfo MemTotal)" || fail "RAM detection missing a platform"
{ grep -qE 'DISPLAY|WAYLAND_DISPLAY' "$SCRIPT"; } && pass "graphical-session gate present (DISPLAY/WAYLAND on Linux — desktop app)" || fail "no graphical-session gate"
grep -qE 'command -v cua' "$SCRIPT" && pass "idempotency: skips if cua already installed (command -v cua)" || fail "no idempotency guard"
grep -qE 'INSTALL_DOCTOR_CUA' "$SCRIPT" && pass "opt-out present (INSTALL_DOCTOR_CUA=0)" || fail "no opt-out"

# 3. INSTALL discipline per the cua-spaces rule: dry-run BEFORE the real install; verify with runtime doctor
grep -q -- '--dry-run' "$SCRIPT" && pass "dry-run before install (cua-spaces rule step 2)" || fail "no --dry-run"
grep -q 'cua runtime doctor' "$SCRIPT" && pass "verifies with 'cua runtime doctor' (rule step 4)" || fail "no runtime-doctor verification"
grep -qE 'cua\.ai/install\.sh' "$SCRIPT" && pass "uses the official installer (cua.ai/install.sh)" || fail "not using the official installer"

# 4. GUARDRAILS (rule steps 5-6): NEVER auto-pair / sign-in / unlock Keyvault / copy host creds; no AppImage.
#    Check EXECUTABLE lines only (strip comments) — the script legitimately NAMES these in "does NOT …"
#    comments documenting the consent-safety guarantees (validator-precision: check behavior, not mentions).
CODE="$(grep -vE '^[[:space:]]*#' "$SCRIPT")"
printf '%s' "$CODE" | grep -q -- '--pair' && fail "auto-pairs the machine (--pair) — must require explicit consent" || pass "does NOT auto-pair the machine (no --pair in executable code)"
printf '%s' "$CODE" | grep -qiE 'keyvault' && fail "touches the Keyvault in code — forbidden (rule step 6)" || pass "does NOT touch the Keyvault in executable code"
printf '%s' "$CODE" | grep -qE 'cua connect setup' && fail "auto-runs 'cua connect setup' (connects agents) — needs per-task consent" || pass "does NOT auto-connect agents (no 'cua connect setup' in code)"
printf '%s' "$CODE" | grep -qiE 'appimage' && fail "installs the AppImage in code — exclude it in production" || pass "no AppImage install in executable code (installer picks native package)"

# 5. RUNNABLE skip paths — must exit 0 WITHOUT invoking the installer when a gate trips.
STUB="$(mktemp -d)"
cat > "$STUB/curl" <<EOF
#!/usr/bin/env bash
echo "CURL_INVOKED \$*" >> "$STUB/calls.log"
EOF
chmod +x "$STUB/curl"
: > "$STUB/calls.log"

# 5a. HEADLESS_INSTALL=1 → skip before install
HEADLESS_INSTALL=1 PATH="$STUB:$PATH" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ] && ! grep -q CURL_INVOKED "$STUB/calls.log"; then
  pass "HEADLESS_INSTALL=1 -> exits 0 WITHOUT invoking the installer"
else
  fail "HEADLESS skip broken (rc=$rc, installer invoked=$(grep -c CURL_INVOKED "$STUB/calls.log"))"
fi

# 5b. INSTALL_DOCTOR_CUA=0 → opt-out skip before install
: > "$STUB/calls.log"
INSTALL_DOCTOR_CUA=0 PATH="$STUB:$PATH" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ] && ! grep -q CURL_INVOKED "$STUB/calls.log"; then
  pass "INSTALL_DOCTOR_CUA=0 -> opt-out exits 0 WITHOUT invoking the installer"
else
  fail "opt-out skip broken (rc=$rc, installer invoked=$(grep -c CURL_INVOKED "$STUB/calls.log"))"
fi
rm -rf "$STUB" 2>/dev/null || true

say "cua-spaces: $P passed, $F failed"
[ "$F" -eq 0 ]
