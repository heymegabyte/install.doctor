#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/home/dot_local/bin/post-installx/executable_post-firewall.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

bash -n "$HOOK" && pass 'firewall hook parses' || fail 'firewall hook syntax'
if grep -Eq 'ufw[[:space:]].*(enable|default|allow|deny)|systemctl[[:space:]].*(enable|restart|start)|fail2ban-client' "$HOOK"; then
  fail 'legacy firewall hook retains unjournaled host mutation'
else
  pass 'legacy firewall hook has no unjournaled host mutation'
fi
grep -Fq 'native firewall convergence is unsupported' "$HOOK" \
  && pass 'unsupported firewall convergence fails with an explicit migration boundary' \
  || fail 'firewall migration boundary is not explicit'
grep -Fq 'exit 20' "$HOOK" \
  && pass 'selected firewall convergence fails visibly instead of fabricating success' \
  || fail 'selected firewall convergence does not fail closed'
if grep -qE '10\.0\.0\.155|10\.0\.0\.143|legion-firewall|LEGION-INBOUND' "$HOOK"; then fail 'host-specific Legion firewall logic remains'; else pass 'firewall boundary is host-neutral'; fi
if sed '/^[[:space:]]*#/d' "$HOOK" | grep -Eq 'SUDO_PASSWORD|get-secret|askpass|SUDO_ASKPASS'; then fail 'firewall boundary retrieves ambient privilege secrets'; else pass 'firewall boundary retrieves no privilege secret'; fi

printf 'firewall-enforcement: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
