#!/usr/bin/env bash
# @file ~/.local/bin/ensure-cloudflare-zt-ca.sh
# @brief Install Cloudflare WARP Zero Trust root CA into system CA store and browser NSS databases.
set -euo pipefail

CA_PEM=""
for candidate in \
  "$HOME/.config/agent-fleet/ca/cloudflare-warp-zt.pem" \
  "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt" \
  "/usr/local/share/ca-certificates/managed-warp.pem" \
  "/usr/local/share/ca-certificates/managed-warp.crt" \
  "/etc/ssl/certs/Cloudflare_CA.pem"; do
  if [ -s "$candidate" ]; then
    CA_PEM="$candidate"
    break
  fi
done

[ -n "$CA_PEM" ] || exit 0

mkdir -p "$HOME/.config/agent-fleet/ca" "$HOME/.local/etc/ssl/cloudflare"
if [ "$CA_PEM" != "$HOME/.config/agent-fleet/ca/cloudflare-warp-zt.pem" ]; then
  cp -f "$CA_PEM" "$HOME/.config/agent-fleet/ca/cloudflare-warp-zt.pem" 2>/dev/null || true
fi
if [ "$CA_PEM" != "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt" ]; then
  cp -f "$CA_PEM" "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt" 2>/dev/null || true
fi

if [ "$(uname -s)" = "Linux" ]; then
  if [ ! -s /usr/local/share/ca-certificates/managed-warp.crt ] && sudo -n true 2>/dev/null; then
    sudo -n cp -f "$CA_PEM" /usr/local/share/ca-certificates/managed-warp.crt 2>/dev/null || true
    sudo -n update-ca-certificates >/dev/null 2>&1 || true
  fi
  if command -v certutil >/dev/null 2>&1; then
    for d in "$HOME/.pki/nssdb" "$HOME/snap/chromium/current/.pki/nssdb"; do
      mkdir -p "$d"
      certutil -d "sql:$d" -A -t "C,," -n "Cloudflare Zero Trust Root CA" -i "$CA_PEM" 2>/dev/null || true
    done
    for ff in "$HOME"/.mozilla/firefox/*.default* "$HOME"/snap/firefox/common/.mozilla/firefox/*.default*; do
      [ -d "$ff" ] && certutil -d "sql:$ff" -A -t "C,," -n "Cloudflare Zero Trust Root CA" -i "$CA_PEM" 2>/dev/null || true
    done
  fi
fi
