#!/usr/bin/env bash
# @file post-installx/executable_post-firewall.sh
# @brief Configure OS-native firewall (UFW on Ubuntu/Debian, pf/Application Firewall on macOS) and Fail2ban
# @description
#   Configures the operating system's native firewall with default-deny incoming/routed policy,
#   preserves active SSH/LAN administrative access, integrates Docker DOCKER-USER ingress protection
#   natively into /etc/ufw/after.rules and /etc/ufw/after6.rules, and configures fail2ban for active
#   authentication services across all fleet nodes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../../scripts/lib/detect_os.sh" ]; then
  # shellcheck disable=SC1090
  source "$SCRIPT_DIR/../../../scripts/lib/detect_os.sh"
  OS="$(detect_os)"
else
  if [[ "${OSTYPE:-}" == darwin* ]]; then OS="macos"
  elif [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS="${ID:-linux}"
  else OS="unknown"
  fi
fi

if command -v gum &>/dev/null; then
  log() { gum log -sl info "$1"; }
  warn() { gum log -sl warn "$1"; }
else
  log() { echo "[INFO] $1"; }
  warn() { echo "[WARN] $1" >&2; }
fi

if [ "${INSTALL_DOCTOR_FIREWALL:-1}" = "0" ]; then
  log "Native firewall configuration opted out (INSTALL_DOCTOR_FIREWALL=0) — skipping"
  exit 0
fi

configure_macos_firewall() {
  log "Configuring macOS native Application Firewall (socketfilterfw)..."
  local fw="/usr/libexec/ApplicationFirewall/socketfilterfw"
  if [ ! -x "$fw" ]; then
    warn "socketfilterfw not found on macOS — skipping"
    return 0
  fi
  if sudo -n true 2>/dev/null; then
    sudo "$fw" --setglobalstate on >/dev/null
    sudo "$fw" --setstealthmode on >/dev/null
    sudo "$fw" --setallowsigned on >/dev/null
    sudo "$fw" --setallowsignedapp on >/dev/null
    log "macOS Application Firewall enabled (globalstate=on, stealth=on)"
  else
    warn "Non-interactive sudo unavailable on macOS — skipping socketfilterfw mutation"
  fi
}

inject_ufw_docker_user_rules() {
  local file="$1"
  local family="$2"
  [ -f "$file" ] || return 0
  if grep -q "BEGIN INSTALL-DOCTOR DOCKER-USER" "$file"; then
    return 0
  fi
  cp -a "$file" "${file}.bak.install-doctor"
  if [ "$family" = "ipv4" ]; then
    cat >>"$file" <<'EOF'

# BEGIN INSTALL-DOCTOR DOCKER-USER
*filter
:DOCKER-USER - [0:0]
-F DOCKER-USER
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
-A DOCKER-USER -i lo -j RETURN
-A DOCKER-USER -s 127.0.0.0/8 -j RETURN
-A DOCKER-USER -i docker+ -j RETURN
-A DOCKER-USER -i br-+ -j RETURN
-A DOCKER-USER -j DROP
COMMIT
# END INSTALL-DOCTOR DOCKER-USER
EOF
  else
    cat >>"$file" <<'EOF'

# BEGIN INSTALL-DOCTOR DOCKER-USER
*filter
:DOCKER-USER - [0:0]
-F DOCKER-USER
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
-A DOCKER-USER -i lo -j RETURN
-A DOCKER-USER -s ::1/128 -j RETURN
-A DOCKER-USER -i docker+ -j RETURN
-A DOCKER-USER -i br-+ -j RETURN
-A DOCKER-USER -j DROP
COMMIT
# END INSTALL-DOCTOR DOCKER-USER
EOF
  fi
}

configure_linux_ufw_and_fail2ban() {
  if ! sudo -n true 2>/dev/null && [ "$(id -u)" -ne 0 ]; then
    warn "Root/sudo unavailable — cannot enforce UFW/fail2ban configuration"
    return 1
  fi
  local SUDO=""
  [ "$(id -u)" -ne 0 ] && SUDO="sudo"

  if ! command -v ufw >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw fail2ban
    else
      warn "ufw not installed and apt-get unavailable — skipping"
      return 0
    fi
  fi

  # Ensure IPv6 and default DROP policies in /etc/default/ufw
  if [ -f /etc/default/ufw ]; then
    $SUDO sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
    $SUDO sed -i 's/^DEFAULT_INPUT_POLICY=.*/DEFAULT_INPUT_POLICY="DROP"/' /etc/default/ufw
    $SUDO sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="DROP"/' /etc/default/ufw
  fi

  # Dynamically detect primary RFC1918 LAN subnet and IP (works on Zen, Omen, Legion, Ubuntu, or any LAN host)
  local lan_cidr="" lan_ip="" admin_cidr=""
  if command -v ip >/dev/null 2>&1; then
    lan_cidr="$(ip -4 route show proto kernel scope link 2>/dev/null | awk '/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/ {print $1; exit}')"
    lan_ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/"); if (a[1] ~ /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/) {print a[1]; exit}}')"
  fi
  admin_cidr="${INSTALL_DOCTOR_FIREWALL_ADMIN_CIDR:-$lan_cidr}"

  # Preserve active SSH session, loopback, and parameterized/detected LAN admin & Coolify controller SSH access
  if [ -n "${SSH_CONNECTION:-}" ]; then
    read -r client_ip _ _ server_port <<<"$SSH_CONNECTION"
    if [ -n "$client_ip" ] && [ -n "$server_port" ]; then
      $SUDO ufw allow proto tcp from "$client_ip" to any port "$server_port" comment 'Active admin SSH' >/dev/null || true
    fi
  fi
  $SUDO ufw allow in on lo >/dev/null || true
  $SUDO ufw allow from 127.0.0.1 to any port 22 proto tcp >/dev/null || true
  $SUDO ufw allow from ::1 to any port 22 proto tcp >/dev/null || true
  if [ -n "$admin_cidr" ]; then
    if [ -n "$lan_ip" ]; then
      $SUDO ufw allow from "$admin_cidr" to "$lan_ip" port 22 proto tcp comment 'LAN and Coolify controller SSH' >/dev/null || true
    else
      $SUDO ufw allow from "$admin_cidr" to any port 22 proto tcp comment 'LAN and Coolify controller SSH' >/dev/null || true
    fi
  fi

  # When host is enrolled as a Coolify node running coolify-proxy (Traefik), allow LAN HTTP/HTTPS ingress
  if [ -n "$admin_cidr" ] && { [ -d /data/coolify/proxy ] || (command -v docker >/dev/null 2>&1 && $SUDO docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'coolify-proxy'); }; then
    if [ -n "$lan_ip" ]; then
      $SUDO ufw allow from "$admin_cidr" to "$lan_ip" port 80 proto tcp comment 'Coolify proxy HTTP' >/dev/null || true
      $SUDO ufw allow from "$admin_cidr" to "$lan_ip" port 443 proto tcp comment 'Coolify proxy HTTPS' >/dev/null || true
    else
      $SUDO ufw allow from "$admin_cidr" to any port 80 proto tcp comment 'Coolify proxy HTTP' >/dev/null || true
      $SUDO ufw allow from "$admin_cidr" to any port 443 proto tcp comment 'Coolify proxy HTTPS' >/dev/null || true
    fi
  fi

  $SUDO ufw default deny incoming >/dev/null
  $SUDO ufw default deny routed >/dev/null
  $SUDO ufw default allow outgoing >/dev/null
  $SUDO ufw logging low >/dev/null

  # Native UFW Docker forwarding guard in /etc/ufw/after.rules and after6.rules
  if [ -f /etc/ufw/after.rules ]; then
    $SUDO bash -c "$(declare -f inject_ufw_docker_user_rules); inject_ufw_docker_user_rules /etc/ufw/after.rules ipv4"
  fi
  if [ -f /etc/ufw/after6.rules ]; then
    $SUDO bash -c "$(declare -f inject_ufw_docker_user_rules); inject_ufw_docker_user_rules /etc/ufw/after6.rules ipv6"
  fi

  if [ -f /etc/ufw/ufw.conf ]; then
    $SUDO sed -i 's/^ENABLED=.*/ENABLED=yes/' /etc/ufw/ufw.conf
  fi
  $SUDO systemctl enable ufw.service >/dev/null 2>&1 || true
  $SUDO ufw --force enable >/dev/null
  $SUDO ufw reload >/dev/null

  # Verify post-apply enforcement state
  if [ -f /etc/ufw/ufw.conf ] && ! grep -q '^ENABLED=yes' /etc/ufw/ufw.conf; then
    warn "UFW failed post-apply ENABLED=yes verification"
    return 1
  fi
  if [ -f /etc/default/ufw ] && { ! grep -q '^DEFAULT_INPUT_POLICY="DROP"' /etc/default/ufw || ! grep -q '^DEFAULT_FORWARD_POLICY="DROP"' /etc/default/ufw; }; then
    warn "UFW failed post-apply DEFAULT_INPUT_POLICY/DEFAULT_FORWARD_POLICY DROP verification"
    return 1
  fi

  # Configure fail2ban for installed authentication services
  if command -v fail2ban-client >/dev/null 2>&1; then
    local ssh_enabled="false"
    [ -x /usr/sbin/sshd ] && ssh_enabled="true"
    $SUDO install -d -m 0755 /etc/fail2ban/jail.d
    $SUDO tee /etc/fail2ban/jail.local >/dev/null <<EOF
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd
banaction = ufw
ignoreip = 127.0.0.1/8 ::1 ${admin_cidr}

[sshd]
enabled = ${ssh_enabled}
port = ssh
logpath = %(sshd_log)s
backend = systemd
EOF
    $SUDO systemctl enable --now fail2ban.service >/dev/null 2>&1 || true
    $SUDO systemctl restart fail2ban.service
    log "Native UFW + DOCKER-USER + Fail2ban (sshd=${ssh_enabled}) active"
  fi
}

case "$OS" in
  macos)
    configure_macos_firewall
    ;;
  ubuntu|debian|proxmox|coolify|linux)
    configure_linux_ufw_and_fail2ban
    ;;
  *)
    log "Skipping native firewall hook on unsupported OS=$OS"
    ;;
esac
