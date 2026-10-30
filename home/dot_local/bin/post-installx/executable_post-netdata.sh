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

### Ensure secrets are available
get-secret --exists NETDATA_ROOM NETDATA_TOKEN

### Claim the instance with Netdata Cloud
if command -v netdata-claim.sh > /dev/null; then
  ### Add user / group with script in ~/.local/bin/add-usergroup, if it is available
  if command -v add-usergroup > /dev/null; then
    sudo add-usergroup netdata netdata
    sudo add-usergroup "$USER" netdata
  fi

  ### Ensure ownership
  ensureNetdataOwnership

  ### cd /tmp attempts to resolve - job-working-directory: error retrieving current directory: getcwd: cannot access parent directories: Permission denied
  cd /tmp

  ### netdata-claim.sh must be run as netdata user
  if sudo -H -u netdata bash -c "yes | netdata-claim.sh -token=$(get-secret NETDATA_TOKEN) -rooms=$(get-secret NETDATA_ROOM) -url=https://app.netdata.cloud"; then
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

  ### Ensure the apt command is available before running `debsecan` logic
  if command -v apt-get > /dev/null; then
    ### Configure Netdata to gather information about CVEs in the installed packages
    if command -v debsecan > /dev/null; then
      DEBSECAN_GIT="${XDG_DATA_HOME:-$HOME/.local/share}/netdata-debsecan"
      ### Installing the script to generate report on CVEs in installed packages
      gum log -sl info 'Installing script to generate report on CVEs in installed packages'
      sudo cp -f "$DEBSECAN_GIT/usr_local_bin_debsecan-by-type" "/usr/local/bin/debsecan-by-type"

      ### Generate initial debsecan reports in /var/log/debsecan/
      gum log -sl info 'Generating initial debsecan reports in /var/log/debsecan/'
      debsecan-by-type

      ### Configure dpkg to refresh the file after each run
      gum log -sl info 'Configuring dpkg to refresh the file after each run'
      sudo cp -f "$DEBSECAN_GIT/etc_apt_apt.conf.d_99debsecan"  /etc/apt/apt.conf.d/99-debsecan

      ### Add a cron job to refresh the file every hour
      gum log -sl info 'Adding a cron job to refresh the file every hour'
      sudo cp -f "$DEBSECAN_GIT/etc_cron.d_debsecan" /etc/cron.d/debsecan

      ### Install the module/configuration file
      gum log -sl info 'Installing the module and configuration file'
      sudo "$DEBSECAN_GIT/debsecan.chart.py" /usr/libexec/netdata/python.d/debsecan.chart.py
      sudo "$DEBSECAN_GIT/debsecan.conf" /etc/netdata/python.d/debsecan.conf
    else
      gum log -sl warn 'apt-get is available but debsecan is not available in the PATH or is not installed'
    fi
  fi

  ### Ensure / report whether speedtest-cli is installed
  if ! command -v speedtest-cli > /dev/null; then
    if command -v pipx > /dev/null; then
      pipx install speedtest-cli
    else
      gum log -sl warn 'speedtest-cli not installed and pipx is not available'
    fi
  fi

  ### Configure Netdata to gather information about Internet connection speed
  if command -v speedtest-cli > /dev/null; then
    ### Installing the script to generate report on Internet connection speed
    gum log -sl info 'Installing script to generate report on Internet connection speed'
    LIBEXEC_PATH="$(netdata -W buildinfo | grep 'Configure' | sed "s/.*--libexecdir=\([^ \']*\).*/\1/")"
    if [ -d /usr/libexec/netdata/charts.d ]; then
      sudo cp -f "${XDG_DATA_HOME:-$HOME/.local/share}/netdata-speedtest/speedtest.chart.sh" "/usr/libexec/netdata/charts.d/speedtest.chart.sh"
    elif [ -d "$LIBEXEC_PATH/netdata/charts.d" ]; then
      gum log -sl info "$LIBEXEC_PATH/netdata/charts.d present on system"
      cp -f "${XDG_DATA_HOME:-$HOME/.local/share}/netdata-speedtest/speedtest.chart.sh" "$LIBEXEC_PATH/netdata/charts.d/speedtest.chart.sh"
    else
      gum log -sl warn "Failed to find appropriate directory to add Netdata speedtest chart script"
    fi
  else
    gum log -sl warn 'speedtest-cli is not available in the PATH or is not installed'
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
