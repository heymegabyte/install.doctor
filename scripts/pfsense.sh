#!/bin/sh
# @file pfSense Setup
# @brief Configures pfSense
# @description
#     This script sets up pfSense with features like:
#
#     1. [Netdata Cloud](https://learn.netdata.cloud/docs/installing/pfsense)
#
#     ## Considerations
#
#     The following items are not included in this script but may be added in the future:
#
#     * https://github.com/pfelk/pfelk
#
#     ## Useful Links
#
#     * [pfSense to OPNSense configuration converter](https://www.pf2opn.com/)
#     * [pfSense Ansible collection](https://github.com/pfsensible/core)
#     * [pfSense API](https://github.com/jaredhendrickson13/pfsense-api) (Note: Need CLI or easy way of accessing it)

# @description This function logs with style using Gum if it is installed, otherwise it uses `echo`. It is also capable of leveraging Glow to render markdown.
#     When Glow is not installed, it uses `cat`. The following sub-commands are available:
#
#     | Sub-Command | Description                                                                                         |
#     |-------------|-----------------------------------------------------------------------------------------------------|
#     | `error`     | Logs a bright red error message                                                                     |
#     | `info`      | Logs a regular informational message                                                                |
#     | `md`        | Tries to render the specified file using `glow` if it is installed and uses `cat` as a fallback     |
#     | `prompt`    | Alternative that logs a message intended to describe an upcoming user input prompt                  |
#     | `star`      | Alternative that logs a message that starts with a star icon                                        |
#     | `start`     | Same as `success`                                                                                   |
#     | `success`   | Logs a success message that starts with green checkmark                                             |
#     | `warn`      | Logs a bright yellow warning message                                                                |
logg() {
  TYPE="$1"
  MSG="$2"
  if [ "$TYPE" == 'error' ]; then
    if command -v gum > /dev/null; then
        gum style --border="thick" "$(gum style --foreground="#ff0000" "✖") $(gum style --bold --background="#ff0000" --foreground="#ffffff"  " ERROR ") $(gum style --bold "$MSG")"
    else
        echo "ERROR: $MSG"
    fi
  elif [ "$TYPE" == 'info' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ffff" "○") $(gum style --faint "$MSG")"
    else
        echo "INFO: $MSG"
    fi
  elif [ "$TYPE" == 'md' ]; then
    if command -v glow > /dev/null; then
        glow "$MSG"
    else
        cat "$MSG"
    fi
  elif [ "$TYPE" == 'prompt' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00008b" "▶") $(gum style --bold "$MSG")"
    else
        echo "PROMPT: $MSG"
    fi
  elif [ "$TYPE" == 'star' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#d1d100" "◆") $(gum style --bold "$MSG")"
    else
        echo "STAR: $MSG"
    fi
  elif [ "$TYPE" == 'start' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ff00" "▶") $(gum style --bold "$MSG")"
    else
        echo "START: $MSG"
    fi
  elif [ "$TYPE" == 'success' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ff00" "✔") $(gum style --bold "$MSG")"
    else
        echo "SUCCESS: $MSG"
    fi
  elif [ "$TYPE" == 'warn' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#d1d100" "◆") $(gum style --bold --background="#ffff00" --foreground="#000000"  " WARNING ") $(gum style --bold "$MSG")"
    else
        echo "WARNING: $MSG"
    fi
  else
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ff00" "▶") $(gum style --bold "$TYPE")"
    else
        echo "$MSG"
    fi
  fi
}

# @description This function adds Netdata to a pfSense environment. More specifically, it:
#
#     1. Enables the FreeBSD package repo
#     2. Installs Netdata system package dependencies
#     3. Configures Netdata to work with Netdata Cloud (if the `NETDATA_TOKEN` environment variable is appropriately assigned)
#     4. Starts the Netdata service
#
#     **Note:** In order for Netdata to start on reboot, the shell command feature of pfSense should be configured to
#     run `service netdata onestart` after reboots.
enableNetdata() {
    ### Enable FreeBSD package repo
    logg info 'Enabling FreeBSD package repo'
    FILE_PATH="/usr/local/etc/pkg/repos/pfSense.conf"
    TMP_FILE=$(mktemp)
    REPLACEMENT="FreeBSD: { enabled: yes }"
    echo "$REPLACEMENT" > "$TMP_FILE"
    tail -n +2 "$FILE_PATH" >> "$TMP_FILE"
    mv -f "$TMP_FILE" "$FILE_PATH"
    rm -f "$TMP_FILE"

    ### Install Netdata / dependencies
    logg info 'Installing Netdata system package dependencies'
    pkg update
    pkg install -y curl pkgconf bash e2fsprogs-libuuid libuv nano
    pkg install -y json-c-0.15_1
    pkg install -y py39-certifi-2023.5.7
    pkg install -y py39-asn1crypto
    pkg install -y py39-pycparser
    pkg install -y py39-cffi
    pkg install -y py39-six
    pkg install -y py39-cryptography
    pkg install -y py39-idna
    pkg install -y py39-openssl
    pkg install -y py39-pysocks
    pkg install -y py39-urllib3
    pkg install -y py39-yaml
    pkg install -y netdata

    ### Modify Netdata configuration
    if [ -n "$NETDATA_TOKEN" ]; then
        logg info 'Configuring Netdata to work with Netdata Cloud'
        # TODO: Add below to netdata.conf
        # bind to = 127.0.0.1 to bind to = 0.0.0.0
        cat <<EOF > /usr/local/etc/netdata/netdata.conf
[backend]
    enabled = yes
    data source = netdata
    destination = https://app.netdata.cloud
    api key = ${NETDATA_TOKEN}
EOF
    fi

    ### Start Netdata
    logg info 'Starting Netdata service'
    service netdata onestart
}
enableNetdata

# @description This function installs UniFi onto a pfSense / OPNSense FreeBSD environment. It leverages scripts provided by
#     the [unofficial pfSense UniFi project on GitHub](https://github.com/unofficial-unifi/unifi-pfsense). The script runs
#     the script provided by the project and then enables the UniFi service.
#
#     If you run into issues, please see the project's GitHub link (referenced above). It may take a couple minutes for the
#     UniFi service to start up after `service unifi.sh start` is run because the start service exits fast while booting up
#     the UniFi service in the background.
enableUniFi() {
  logg error 'UniFi installation is unsupported until an immutable verified pfSense artifact is declared'
  return 78
}
enableUniFi

# @description This function adds an unofficial package that adds SAML2 support to pfSense for SSO logins over
#     the web portal. For more information, see the project's [GitHub page](https://github.com/jaredhendrickson13/pfsense-saml2-auth).
enablePFsenseSAML() {
  logg error 'pfSense SAML installation is unsupported until an exact package digest is declared'
  return 78
}
enablePFsenseSAML
