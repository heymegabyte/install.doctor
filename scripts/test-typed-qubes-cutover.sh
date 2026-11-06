#!/usr/bin/env bash
# Focused B03/B04 coverage for Qubes delegation authority.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if bash -n "$PROVISION"; then pass 'provisioner remains valid Bash'; else fail 'provisioner has invalid Bash syntax'; fi

section="$(grep -F -A 14 "id: 'bootstrap.qubes-dom0-delegation'" "$PROVISION")"
if [ -n "$section" ]; then pass 'Qubes dom0 delegation is a typed task'; else fail 'Qubes dom0 delegation is missing from the typed graph'; fi
for field in inputDigest operations timeoutMs retry resources privilege network consent lockDomains failurePolicy; do
  if printf '%s\n' "$section" | grep -q "$field"; then pass "Qubes task declares $field"; else fail "Qubes task is missing $field"; fi
done

logic="$(sed -n '/^provisionLogic() {/,/^}/p' "$PROVISION")"
if printf '%s\n' "$logic" | grep -Fq 'handleQubesDom0'; then fail 'Qubes still mutates before the canonical engine'; else pass 'Qubes no longer mutates before the canonical engine'; fi
if printf '%s\n' "$logic" | grep -Fq 'ensureInstallUser' \
  && printf '%s\n' "$logic" | grep -Fq 'setupPasswordlessSudo'; then
  pass 'unmigrated handoff and credential bootstrap remain explicit'
else
  fail 'handoff or credential bootstrap was silently removed'
fi

if bash -c 'source "$1"; idRunEngineOperation qubes-dom0-check; [ "$?" -eq 78 ]' _ "$PROVISION"; then
  pass 'Qubes host check reports explicit unsupported status'
else
  fail 'Qubes host check does not report explicit unsupported status'
fi

if bash -c 'source "$1"; handleQubesDom0() { return 42; }; idRunEngineOperation qubes-dom0-apply; [ "$?" -eq 78 ]' _ "$PROVISION"; then
  pass 'direct Qubes apply cannot reach the legacy mutator'
else
  fail 'direct Qubes apply still reaches the legacy mutator'
fi

if bash -c 'source "$1"; idRunEngineOperation qubes-dom0-verify; [ "$?" -eq 78 ]' _ "$PROVISION"; then
  pass 'Qubes verification cannot claim pending or success while unsupported'
else
  fail 'Qubes verification does not report explicit unsupported status'
fi

printf 'typed-qubes-cutover: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
