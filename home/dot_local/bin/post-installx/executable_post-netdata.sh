#!/usr/bin/env bash
set -euo pipefail
# @file Netdata
# @brief Connects Netdata with Netdata's free cloud dashboard and applies some system optimizations, if necessary
# @description
#     This script connects Netdata with Netdata Cloud if Netdata is installed, the `NETDATA_TOKEN` is provided, and the
#     `NETDATA_ROOM` is defined. This allows you to graphically browse through system metrics on all your connected devices
#     from a single free web application.
#
#     This script installs additional alerts and enables notifications if Netdata is installed. Email notifications are configured
#     using the provided primary email address. If the OS is Debian based, Netdata shows the number of CVEs in currently installed packages.

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

ensureNetdataOwnership() {
  ### Ensure /usr/local/var/lib/netdata/cloud.d is owned by user
  if [ -d /var/lib/netdata ]; then
    gum log -sl info 'Ensuring permissions are correct on /var/lib/netdata' && sudo chown -Rf netdata:netdata /var/lib/netdata 2> /dev/null || sudo chown -Rf "netdata:$(id -g -n)" /var/lib/netdata
  elif [ -d /usr/local/var/lib/netdata ]; then
    gum log -sl info 'Ensuring permissions are correct on /usr/local/var/lib/netdata' && sudo chown -Rf netdata:netdata /usr/local/var/lib/netdata 2> /dev/null || sudo chown -Rf "netdata:$(id -g -n)" /usr/local/var/lib/netdata
    if [ ! -d /var/lib/netdata ]; then
      sudo mkdir -p /var/lib
      sudo ln -s /usr/local/var/lib/netdata /var/lib/netdata
    fi
  elif [ -d "${HOMEBREW_PREFIX:-/opt/homebrew}/var/lib/netdata" ]; then
    gum log -sl info "Ensuring permissions are correct on ${HOMEBREW_PREFIX:-/opt/homebrew}/var/lib/netdata" && sudo chown -Rf netdata:netdata "${HOMEBREW_PREFIX:-/opt/homebrew}/var/lib/netdata" 2> /dev/null || sudo chown -Rf "netdata:$(id -g -n)" "${HOMEBREW_PREFIX:-/opt/homebrew}/var/lib/netdata"
    if [ ! -d /var/lib/netdata ]; then
      sudo mkdir -p /var/lib
      sudo ln -s "${HOMEBREW_PREFIX:-/opt/homebrew}/var/lib/netdata" /var/lib/netdata
    fi
  else
    gum log -sl warn 'No /var/lib/netdata folder found'
  fi
}

### Ensure Netdata is installed and bound to loopback (127.0.0.1 ::1) on Debian/Ubuntu Linux
if [ "$(uname -s)" = "Linux" ] && command -v apt-get > /dev/null && { [ "$(id -u)" -eq 0 ] || sudo -n true 2>/dev/null; }; then
  if ! command -v netdata > /dev/null; then
    gum log -sl warn 'Netdata is absent; select it through Install Doctor desired state'
    exit 20
  elif [ -f /etc/apt/preferences.d/80netdata ]; then
    sudo sed -i 's/^Priority:/Pin-Priority:/' /etc/apt/preferences.d/80netdata || true
  fi

  if [ -d /etc/netdata ]; then
    sudo tee /etc/netdata/netdata.conf >/dev/null <<'EOF'
[global]
    run as user = netdata
    bind to = 127.0.0.1 ::1
    default port = 19999
EOF
    if command -v systemctl > /dev/null; then
      sudo systemctl enable --now netdata >/dev/null 2>&1 || true
      sudo systemctl restart netdata >/dev/null 2>&1 || true
    fi
  fi
fi

### Ensure secrets are available (non-fatal if Netdata Cloud claiming is not configured)
get-secret --exists NETDATA_ROOM NETDATA_TOKEN || exit 0

### Claim the instance with Netdata Cloud
if command -v netdata-claim.sh > /dev/null; then
  ### Add user / group with script in ~/.local/bin/add-usergroup, if it is available
  if command -v add-usergroup > /dev/null; then
    sudo add-usergroup netdata netdata
    sudo add-usergroup "${USER:-$(id -un)}" netdata
  fi

  ### Ensure ownership
  ensureNetdataOwnership

  ### cd /tmp attempts to resolve - job-working-directory: error retrieving current directory: getcwd: cannot access parent directories: Permission denied
  cd /tmp

  ### netdata-claim.sh must be run as netdata user
  if sudo -H -u netdata bash -c "(yes || true) | netdata-claim.sh -token=$(get-secret NETDATA_TOKEN) -rooms=$(get-secret NETDATA_ROOM) -url=https://app.netdata.cloud"; then
    gum log -sl info 'Successfully added device to Netdata Cloud account'
  fi

  ### Kernel optimizations
  # These are mentioned while installing via the kickstart.sh script method. We are using Homebrew for the installation though.
  # Assuming these optimizations do not cause any harm.
  if [ -d /Applications ] && [ -d /System ]; then
    ### macOS
    gum log -sl info 'System is macOS so Netdata kernel optimizations are not required'
  else
    ### Linux
    if [ -d /sys/kernel/mm/ksm ]; then
      gum log -sl info 'Adding Netdata kernel optimization for /sys/kernel/mm/ksm/run'
      echo 1 | sudo tee /sys/kernel/mm/ksm/run
      gum log -sl info 'Adding Netdata kernel optimization for /sys/kernel/mm/ksm/sleep_millisecs'
      echo 1000 | sudo tee /sys/kernel/mm/ksm/sleep_millisecs
    else
      gum log -sl info 'The /sys/kernel/mm/ksm directory does not exist so Netdata kernel optimizations are not being applied'
    fi
  fi

  ### Install additional alerts and enable notifications
  if command -v netdata > /dev/null; then
    ### Copy the additional alert definitions
    if [ -d /usr/local/etc/netdata ]; then
      NETDATA_ETC='/usr/local/etc/netdata/'
    elif [ -d /etc/netdata ]; then
      NETDATA_ETC='/etc/netdata'
    elif [ -d "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/netdata" ]; then
      NETDATA_ETC="${HOMEBREW_PREFIX:-/opt/homebrew}/etc/netdata"
    else
      gum log -sl error 'No etc location found for netdata' && exit 1
    fi
    gum log -sl info "Copying ${XDG_CONFIG_HOME:-$HOME/.config}/netdata/health.d/ to $NETDATA_ETC"
    sudo cp -rf "${XDG_CONFIG_HOME:-$HOME/.config}/netdata/health.d/" "$NETDATA_ETC"
    # SED_UTIL is consumed by the commented-out blocky/sftpgo prometheus sed config below (a disabled feature).
    # shellcheck disable=SC2034
    if command -v gsed > /dev/null; then
      SED_UTIL="gsed"
    else
      SED_UTIL="sed"
    fi

    ### Blocky
    # TODO - Add this configuration to appropriate configuration file
    # gum log -sl info "Adding Blocky metrics collection to $NETDATA_ETC/go.d/prometheus.conf"
    # sudo "$SED_UTIL" -i "/jobs:/a\  - name: blocky_local \n    url: 'http://127.0.0.1:4000/metrics'" "$NETDATA_ETC/go.d/prometheus.conf"
    
    ### SFTPGo
    # TODO - Add this configuration to appropriate configuration file
    # gum log -sl info "Adding SFTPGo metrics collection to $NETDATA_ETC/go.d/prometheus.conf"
    # sudo "$SED_UTIL" -i "/jobs:/a\  - name: sftpgo_local \n    url: 'http://127.0.0.1:57500/metrics'" "$NETDATA_ETC/go.d/prometheus.conf"
    
    # Backup current health alarm configuration and apply new one
    if [ -d /usr/local/lib/netdata ]; then
      NETDATA_LIB='/usr/local/lib/netdata'
    elif [ -d /usr/lib/netdata ]; then
      NETDATA_LIB='/usr/lib/netdata'
    elif [ -d "${HOMEBREW_PREFIX:-/opt/homebrew}/lib/netdata" ]; then
      NETDATA_LIB="${HOMEBREW_PREFIX:-/opt/homebrew}/lib/netdata"
    else
      gum log -sl error 'No lib location found for netdata' && exit 1
    fi
    gum log -sl info "Copying ${XDG_CONFIG_HOME:-$HOME/.config}/netdata/health_alarm_notify.conf to $NETDATA_LIB/conf.d/health_alarm_notify.conf"
    sudo cp -f "${XDG_CONFIG_HOME:-$HOME/.config}/netdata/health_alarm_notify.conf" "$NETDATA_LIB/conf.d/health_alarm_notify.conf"
  else
    gum log -sl warn 'netdata is not available in the PATH or is not installed'
  fi

  ### Ensure ownership again
  ensureNetdataOwnership

  ### Restart Netdata service
  if command -v systemctl > /dev/null; then
    gum log -sl info 'Enabling netdata service' && sudo systemctl enable netdata
    gum log -sl info 'Restarting netdata service' && sudo systemctl restart netdata
  elif [ -d /Applications ] && [ -d /System ]; then
    gum log -sl info 'Starting / enabling netdata service' && brew services restart netdata
  else
    gum log -sl warn 'systemctl is not available'
  fi
else
  gum log -sl info 'netdata-claim.sh is not available in the PATH'
fi
