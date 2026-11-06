#!/usr/bin/env bash
# Cua Spaces provisioning gate. A chezmoi run_after script verifies existing Cua Spaces or fails closed, GATED
# on: a GUI desktop (not headless/server), >= 16 GiB RAM, a supported OS (macOS/Linux), idempotent
# (skip if `cua` present), explicit selection via INSTALL_DOCTOR_CUA=1. It never executes an unverified
# remote installer, auto-pairs, signs in, unlocks the Keyvault, or copies host credentials.
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

# 3. INSTALL discipline: verify existing runtime and refuse mutable remote code.
grep -q 'cua runtime doctor' "$SCRIPT" && pass "verifies with 'cua runtime doctor' (rule step 4)" || fail "no runtime-doctor verification"
CODE="$(grep -vE '^[[:space:]]*#' "$SCRIPT")"
printf '%s' "$CODE" | grep -qE '(curl|wget).*(cua\.ai/install\.sh)' && fail "executes mutable cua.ai installer code" || pass "mutable cua.ai installer execution is absent"
grep -q 'immutable signed artifact' "$SCRIPT" && pass "missing artifact has exact signed desired-state remediation" || fail "missing signed-artifact remediation"

# 4. GUARDRAILS (rule steps 5-6): NEVER auto-pair / sign-in / unlock Keyvault / copy host creds; no AppImage.
#    Check EXECUTABLE lines only (strip comments) — the script legitimately NAMES these in "does NOT …"
#    comments documenting the consent-safety guarantees (validator-precision: check behavior, not mentions).
printf '%s' "$CODE" | grep -q -- '--pair' && fail "auto-pairs the machine (--pair) — must require explicit consent" || pass "does NOT auto-pair the machine (no --pair in executable code)"
printf '%s' "$CODE" | grep -qiE 'keyvault' && fail "touches the Keyvault in code — forbidden (rule step 6)" || pass "does NOT touch the Keyvault in executable code"
printf '%s' "$CODE" | grep -qE 'cua connect setup' && fail "auto-runs 'cua connect setup' (connects agents) — needs per-task consent" || pass "does NOT auto-connect agents (no 'cua connect setup' in code)"
printf '%s' "$CODE" | grep -qiE 'appimage' && fail "installs the AppImage in code — exclude it in production" || pass "no AppImage install in executable code (installer picks native package)"

# 5. RUNNABLE skip paths — must exit 0 without remote execution when a gate trips.
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

# 5b. INSTALL_DOCTOR_CUA=0 → unselected skip before install
: > "$STUB/calls.log"
INSTALL_DOCTOR_CUA=0 PATH="$STUB:$PATH" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ] && ! grep -q CURL_INVOKED "$STUB/calls.log"; then
  pass "INSTALL_DOCTOR_CUA=0 -> opt-out exits 0 WITHOUT invoking the installer"
else
  fail "opt-out skip broken (rc=$rc, installer invoked=$(grep -c CURL_INVOKED "$STUB/calls.log"))"
fi

# 5c. A selected qualifying host with no installed binary fails closed before curl.
: > "$STUB/calls.log"
cat > "$STUB/awk" <<'EOF'
#!/usr/bin/env bash
printf '33554432\n'
EOF
chmod +x "$STUB/awk"
INSTALL_DOCTOR_CUA=1 DISPLAY=:1 OSTYPE=linux-gnu PATH="$STUB:/usr/bin:/bin" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 69 ] && ! grep -q CURL_INVOKED "$STUB/calls.log"; then
  pass "selected host without signed Cua artifact fails closed before remote execution"
else
  fail "selected missing-artifact path rc=$rc curl=$(grep -c CURL_INVOKED "$STUB/calls.log")"
fi
rm -rf "$STUB" 2>/dev/null || true

say "cua-spaces: $P passed, $F failed"
[ "$F" -eq 0 ]
