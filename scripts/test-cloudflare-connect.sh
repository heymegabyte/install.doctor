#!/usr/bin/env bash
# Cloudflare connect + cert guard (new-arc "ensure cloudflared has the machine connected, WARP incl. the
# right certificate" ask, fire #203). The post-installx hooks post-cloudflared.sh + post-warp.sh were the
# ONLY cloudflared/WARP surface with NO test coverage — a future "cleanup" fire could silently break the
# connect/cert path. This is a STRUCTURAL guard (the hooks CONTAIN the connect/cert logic); the LIVE connect
# (a real tunnel coming up, WARP registering, the cert landing in the trust store) is HOST-gated (needs real
# CF creds + a real machine) and honestly out of scope here. Pure file assertions, no network.
# Plain-substring greps (no `\b` — macOS grep's `\b` is unreliable, per #201), so each assertion is
# non-vacuous by construction: it greps a REQUIRED string; absence fails.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CF="$ROOT/home/dot_local/bin/post-installx/executable_post-cloudflared.sh"
WARP="$ROOT/home/dot_local/bin/post-installx/executable_post-warp.sh"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0
has() { grep -qF "$2" "$1" 2>/dev/null; }

say "cloudflared connect + WARP cert (structural; live-connect host-gated)"

# ── cloudflared: CONNECT the machine via a managed tunnel, PERSIST it as a boot service ──
if [ -f "$CF" ]; then
  pass "post-cloudflared.sh present"
  bash -n "$CF" 2>/dev/null && pass "post-cloudflared bash -n clean" || fail "post-cloudflared bash -n failed"
  has "$CF" 'command -v cloudflared' && pass "cloudflared hook is gated on the binary being installed (no blind run)" || fail "cloudflared hook not gated on 'command -v cloudflared'"
  has "$CF" 'cloudflared service install' && pass "cloudflared CONNECTS — installs the connector service ('cloudflared service install')" || fail "cloudflared hook never installs the connector service"
  has "$CF" 'systemctl enable cloudflared' && pass "cloudflared PERSISTS — enabled as a boot service on Linux (survives reboot)" || fail "cloudflared service not enabled on boot (systemctl enable)"
else
  fail "post-cloudflared.sh missing ($CF)"
fi

# ── WARP: install the right CERT into the trust store, then register + connect warp-cli ──
if [ -f "$WARP" ]; then
  pass "post-warp.sh present"
  bash -n "$WARP" 2>/dev/null && pass "post-warp bash -n clean" || fail "post-warp bash -n failed"
  has "$WARP" 'command -v warp-cli' && pass "WARP hook is gated on warp-cli being installed" || fail "WARP hook not gated on 'command -v warp-cli'"
  # the right certificate — the Cloudflare cert appended into an OpenSSL trust store
  if has "$WARP" 'cloudflare.pem' && { has "$WARP" '/etc/ssl/cert.pem' || has "$WARP" 'c_rehash'; }; then
    pass "WARP installs the RIGHT CERTIFICATE — Cloudflare cert → OpenSSL trust store (cloudflare.pem + /etc/ssl or c_rehash)"
  else
    fail "WARP hook does not install the Cloudflare cert into a trust store"
  fi
  # register + connect (idempotent — gated on 'Registration Missing' / 'Disconnected')
  has "$WARP" 'registration new' && pass "WARP REGISTERS the device (warp-cli registration new)" || fail "WARP hook never registers the device"
  has "$WARP" 'warp-cli --accept-tos connect' && pass "WARP CONNECTS the device (warp-cli --accept-tos connect)" || fail "WARP hook never connects"
  # headless-safe: the interactive macOS Touch-ID cert path (security add-trusted-cert) must stay OFF the
  # active path (commented) — a bare provision must never block on a GUI prompt (§3 headless-safe).
  # single-file `grep -n` emits `lineno:content`, so anchor the comment-exclusion at `^lineno:` (one colon),
  # NOT the two-colon `grep -r` form — else a commented line is miscounted as active (false positive).
  act="$(grep -nE 'security add-trusted-cert' "$WARP" 2>/dev/null | grep -vcE '^[0-9]+:[[:space:]]*#' || true)"
  [ "${act:-0}" = 0 ] && pass "headless-safe — the Touch-ID 'security add-trusted-cert' path is commented, not active" || fail "$act active 'security add-trusted-cert' call(s) — would block a headless provision on Touch ID"
else
  fail "post-warp.sh missing ($WARP)"
fi

say "cloudflare-connect: $P passed, $F failed"
[ "$F" -eq 0 ]
