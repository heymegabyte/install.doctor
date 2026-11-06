#!/usr/bin/env bash
# Hermetic regression gate: optional runtimes/integrations must remain inert
# until desired state explicitly selects them.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

assert_opt_in() {
  local path="$1" variable="$2"
  local disabled_default
  disabled_default="$(printf '%s%s%s' '$' "{$variable" ':-0}')"
  if grep -Fq "$disabled_default" "$path" \
    && grep -Eq "INSTALL_DOCTOR_[A-Z_]+:-0.*(=|!=).*1" "$path"; then
    pass "$(basename "$path") defaults $variable to disabled"
  else
    fail "$(basename "$path") does not fail closed behind $variable"
  fi
}

assert_opt_in "$ROOT/home/dot_local/bin/post-installx/executable_post-ollama.sh" INSTALL_DOCTOR_OLLAMA
assert_opt_in "$ROOT/home/dot_local/bin/post-installx/executable_post-litellm-enroll.sh" INSTALL_DOCTOR_LITELLM_ENROLL
assert_opt_in "$ROOT/home/dot_local/bin/post-installx/executable_post-kasmvnc.sh" INSTALL_DOCTOR_KASMVNC
assert_opt_in "$ROOT/home/dot_local/bin/post-installx/executable_post-cua-driver.sh" INSTALL_DOCTOR_CUA_DRIVER
assert_opt_in "$ROOT/home/dot_local/bin/post-installx/executable_post-nexus-cache.sh" INSTALL_DOCTOR_NEXUS_CACHE
assert_opt_in "$ROOT/home/dot_local/bin/post-installx/executable_post-gitomatic.sh" INSTALL_DOCTOR_GITOMATIC
assert_opt_in "$ROOT/home/dot_local/bin/post-installx/executable_post-cloudflared.sh" INSTALL_DOCTOR_CLOUDFLARED_ENROLL

PRE_INSTALL="$ROOT/home/.chezmoiscripts/universal/run_after_01-pre-install.sh.tmpl"
if grep -Eq 'INSTALL_DOCTOR_NEXUS_CACHE:-0.*1' "$PRE_INSTALL"; then
  pass "pre-install cache bootstrap requires explicit selection"
else
  fail "pre-install cache bootstrap is eager"
fi

# The four heavyweight hooks below gate before host probing, downloads, file
# creation, or service management, so their default path is safe on any host.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for hook in ollama litellm-enroll kasmvnc cua-driver nexus-cache gitomatic cloudflared; do
  if HOME="$TMP/home" PATH="/usr/bin:/bin" bash "$ROOT/home/dot_local/bin/post-installx/executable_post-$hook.sh" >"$TMP/$hook.out" 2>"$TMP/$hook.err"; then
    pass "$hook default execution exits cleanly without activation"
  else
    fail "$hook default execution did not skip cleanly"
  fi
done

if find "$TMP/home" -mindepth 1 -print -quit 2>/dev/null | grep -q .; then
  fail "default-disabled hooks created local state"
else
  pass "default-disabled hooks create no local state"
fi

printf 'lazy-runtime-policy: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
