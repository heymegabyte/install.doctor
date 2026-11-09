#!/usr/bin/env bash
# Focused B03/B04 coverage for Qubes delegation authority.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if bash -n "$PROVISION"; then pass 'provisioner remains valid Bash'; else fail 'provisioner has invalid Bash syntax'; fi

MATRIX="$ROOT/scripts/platform-support-matrix.json"
if jq -e '[.cells[] | select(.role == "qubes-dom0" or .role == "qubes-appvm")] | length == 2 and all(.[]; .status == "unsupported" and (.limitation | length > 0) and (.remediation | length > 0))' "$MATRIX" >/dev/null; then
  pass 'Qubes tuples are explicitly unsupported with limitations and remediation'
else
  fail 'Qubes platform policy does not fail closed explicitly'
fi

if ! grep -Fq "id: 'bootstrap.qubes-dom0-delegation'" "$PROVISION" \
  && ! grep -Eq "qubes-dom0-(check|apply|verify)|legacyAdminBridge: 'qubes-dom0'" "$PROVISION"; then
  pass 'unsupported Qubes has no executable task, operation, or legacy admin bridge'
else
  fail 'unsupported Qubes retains dead executable mutation wiring'
fi

logic="$(sed -n '/^provisionLogic() {/,/^}/p' "$PROVISION")"
if printf '%s\n' "$logic" | grep -Fq 'handleQubesDom0'; then fail 'Qubes still mutates before the canonical engine'; else pass 'Qubes no longer mutates before the canonical engine'; fi
if printf '%s\n' "$logic" | grep -Fq 'ensureInstallUser' \
  && grep -Fq 'setupPasswordlessSudo || return $?' "$PROVISION" \
  && grep -Fq "id: 'stage-zero.install-user-transition'" "$PROVISION" \
  && grep -Fq "id: 'stage-zero.sudo-credential'" "$PROVISION"; then
  pass 'sealed user handoff and canonical credential bootstrap remain explicit'
else
  fail 'handoff or credential bootstrap was silently removed'
fi

if grep -Fq 'unsupported) logg error "Platform $CELL is unsupported: $LIMITATION"; return 2' "$PROVISION"; then
  pass 'unsupported tuples are rejected before plan approval'
else
  fail 'unsupported tuple admission is not fail closed'
fi

printf 'typed-qubes-cutover: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
