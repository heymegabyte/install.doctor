#!/usr/bin/env bash
set -euo pipefail
# @file Wazuh Client Install
# @brief Installs the Wazuh client and connects to the manager if configured to do so through secrets / environment variables

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Ensure secrets
get-secret --exists WAZUH_MANAGER WAZUH_REGISTRATION_PASSWORD

if [ -d /Applications ] && [ -d /System ]; then
    ### macOS
    gum log -sl info 'Downloading the macOS Wazuh agent pkg'
    if [[ $(uname -m) == 'arm64' ]]; then
        PKG_URL="https://packages.wazuh.com/4.x/macos/wazuh-agent-4.7.4-1.arm64.pkg"
    else
        PKG_URL="https://packages.wazuh.com/4.x/macos/wazuh-agent-4.7.4-1.intel64.pkg"
    fi
    wget -q "$PKG_URL" -O /tmp/wazuh-agent.pkg &> /dev/null
    gum log -sl info 'Setting Wazuh launch parameters in /tmp/wazuh_envs'
    # https://documentation.wazuh.com/current/user-manual/agent/deployment-variables/deployment-variables-macos.html
    echo "WAZUH_MANAGER=$(get-secret WAZUH_MANAGER) && WAZUH_REGISTRATION_PASSWORD=$(get-secret WAZUH_REGISTRATION_PASSWORD)" > /tmp/wazuh_envs
    gum log -sl info 'Installing the Wazuh agent pkg'
    sudo installer -pkg /tmp/wazuh-agent.pkg -target /
    sudo chmod 755 /Library/Ossec
    sudo chmod 755 /Library/Ossec/bin
    find "/Library/Ossec/bin" -mindepth 1 -maxdepth 1 -type f | while read BIN_FILE; do
        sudo chmod +x "$BIN_FILE"
    done
    rm -f /tmp/wazuh-agent.pkg
    gum log -sl info 'Running sudo wazuh-control start'
    sudo wazuh-control start
else
    if command -v apt-get > /dev/null; then
        gum log -sl info 'Importing GPG-KEY-WAZUH'
        curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | sudo gpg --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import
        sudo chmod 644 /usr/share/keyrings/wazuh.gpg
        echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" | sudo tee -a /etc/apt/sources.list.d/wazuh.list
        sudo apt-get update
        gum log -sl info 'Installing the Wazuh agent'
        sudo apt-get install -y wazuh-agent
    elif command -v dnf > /dev/null; then
        gum log -sl info 'Configuring /etc/yum.repos.d/wazuh.repo'
        echo "[wazuh]" | sudo tee -a /etc/yum.repos.d/wazuh.repo && echo "gpgcheck=1" | sudo tee -a /etc/yum.repos.d/wazuh.repo
        echo "gpgkey=https://packages.wazuh.com/key/GPG-KEY-WAZUH" | sudo tee -a /etc/yum.repos.d/wazuh.repo
        echo "enabled=1" | sudo tee -a /etc/yum.repos.d/wazuh.repo
        echo "name=EL-\$releasever - Wazuh" | sudo tee -a /etc/yum.repos.d/wazuh.repo
        echo "baseurl=https://packages.wazuh.com/4.x/yum/" | sudo tee -a /etc/yum.repos.d/wazuh.repo
        echo "protect=1" | sudo tee -a /etc/yum.repos.d/wazuh.repo
        gum log -sl info 'Importing GPG-KEY-WAZUH'
        sudo rpm --import https://packages.wazuh.com/key/GPG-KEY-WAZUH
        gum log -sl info 'Installing Wazuh agent'
        sudo dnf install -y wazuh-agent
    elif command -v zypper > /dev/null; then
        gum log -sl info 'Configuring /etc/zypp/repos.d/wazuh.repo'
        echo "[wazuh]" | sudo tee -a /etc/zypp/repos.d/wazuh.repo
        echo "gpgcheck=1" | sudo tee -a /etc/zypp/repos.d/wazuh.repo
        echo "gpgkey=https://packages.wazuh.com/key/GPG-KEY-WAZUH" | sudo tee -a /etc/zypp/repos.d/wazuh.repo
        echo "enabled=1" | sudo tee -a /etc/zypp/repos.d/wazuh.repo
        echo "name=EL-\$releasever - Wazuh" | sudo tee -a /etc/zypp/repos.d/wazuh.repo
        echo "baseurl=https://packages.wazuh.com/4.x/yum/" | sudo tee -a /etc/zypp/repos.d/wazuh.repo
        echo "protect=1" | sudo tee -a /etc/zypp/repos.d/wazuh.repo
        gum log -sl info 'Importing GPG-KEY-WAZUH'
        sudo rpm --import https://packages.wazuh.com/key/GPG-KEY-WAZUH
        gum log -sl info 'Installing Wazuh agent'
        sudo zypper install -y wazuh-agent
    elif command -v apk > /dev/null; then
        gum log -sl info 'Importing Wazuh repository'
        sudo wget -O /etc/apk/keys/alpine-devel@wazuh.com-633d7457.rsa.pub https://packages.wazuh.com/key/alpine-devel%40wazuh.com-633d7457.rsa.pub
        echo "https://packages.wazuh.com/4.x/alpine/v3.12/main" | sudo tee -a /etc/apk/repositories
        gum log -sl info 'Running sudo apk update'
        sudo apk update
        gum log -sl info 'Installing Wazuh agent'
        sudo apk add wazuh-agent
    fi
fi
