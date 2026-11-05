#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-firewall.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

bash -n "$HOOK" && pass 'firewall hook parses' || fail 'firewall hook syntax'
grep -q "ENABLED=yes" "$HOOK" && grep -q 'ufw --force enable' "$HOOK" && pass 'UFW is explicitly enabled' || fail 'UFW enablement missing'
grep -q 'DEFAULT_INPUT_POLICY.*DROP' "$HOOK" && grep -q 'DEFAULT_FORWARD_POLICY.*DROP' "$HOOK" && pass 'post-apply enforcement verification' || fail 'enabled/default-policy verification missing'
grep -q 'INSTALL_DOCTOR_FIREWALL_ADMIN_CIDR' "$HOOK" && pass 'host-specific admin exception is parameterized' || fail 'admin exception parameter missing'
if grep -qE '10\.0\.0\.155|10\.0\.0\.143|legion-firewall|LEGION-INBOUND' "$HOOK"; then fail 'host-specific Legion firewall logic remains'; else pass 'universal firewall logic is host-neutral'; fi
grep -q 'Root/sudo unavailable' "$HOOK" && grep -A2 'Root/sudo unavailable' "$HOOK" | grep -q 'return 1' && pass 'missing privilege fails visibly' || fail 'missing privilege is silently accepted'

printf 'firewall-enforcement: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
