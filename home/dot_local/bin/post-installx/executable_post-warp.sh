#!/usr/bin/env bash
set -euo pipefail
# @file CloudFlare WARP
# @brief Installs CloudFlare WARP, ensures proper security certificates are in place, and connects the device to CloudFlare WARP.
# @description
#     This script is intended to connect the device to CloudFlare's Zero Trust network with nearly all of its features unlocked.
#     Homebrew is used to install the `warp-cli` on macOS. On Linux, it can install `warp-cli` on most Debian systems and some RedHat
#     systems. CloudFlare WARP's [download page](https://pkg.cloudflareclient.com/packages/cloudflare-warp) is somewhat barren.
#
#     ## MDM Configuration
#
#     If CloudFlare WARP successfully installs, it first applies MDM configurations (managed configurations). If you would like CloudFlare
#     WARP to connect completely headlessly (while losing some "user-posture" settings), then you can populate the following three secrets:
#
#     1. `CLOUDFLARE_TEAMS_CLIENT_ID` - The ID from a CloudFlare Teams service token. See [this article](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/).
#     2. `CLOUDFLARE_TEAMS_CLIENT_SECRET` - The secret from a CloudFlare Teams service token.
#     3. `CLOUDFLARE_TEAMS_ORG` - The ID of your Zero Trust organization. This variable must be passed in as an environment variable and is housed in the `home/.chezmoi.yaml.tmpl` file. If you do not want to pass an environment variable, you can change the default value in `home/.chezmoi.yaml.tmpl` on your own fork.
#
#     The two variables above can be passed in using either of the methods described in the [Secrets documentation](https://install.doctor/docs/customization/secrets).
#
#     ## Headless CloudFlare WARP Connection
#
#     Even if you do not provide the two variables mentioned above, the script will still headlessly connect your device to the public CloudFlare WARP
#     network, where you will get some of the benefits of a VPN for free. Otherwise, if they were passed in, then the script
#     finishes by connecting to CloudFlare Teams.
#
#     ## Application Certificates
#
#     This script applies the techniques described on the [CloudFlare Zero Trust Install certificate manually page](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/user-side-certificates/install-cloudflare-cert/)
#     to configure the following utilities that leverage seperate certificate authorities:
#
#     * Python
#     * NPM
#     * Git
#     * Google Cloud SDK
#     * AWS CLI
#     * Google Drive for desktop
#
#     Settings used to configure Firefox are housed inside of the Firefox configuration files stored as seperate configuration files
#     outside of this script. **Note: The scripts that enable CloudFlare certificates for all these programs are currently commented out
#     in this script.**
#
#     ## Notes
#
#     According to CloudFlare Teams [documentation on MDM deployment](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/deployment/mdm-deployment/),
#     on macOS the `com.cloudflare.warp.plist` file gets erased on reboot. Also, according to the documentation, the only way around this is to leverage
#     an MDM SaaS provider like JumpCloud.
#
#     ## Links
#
#     * [Linux managed configuration](https://github.com/megabyte-labs/install.doctor/tree/master/home/dot_config/warp/private_mdm.xml.tmpl)
#     * [macOS managed configuration](https://github.com/megabyte-labs/install.doctor/tree/master/home/Library/Managed%20Preferences/private_com.cloudflare.warp.plist.tmpl)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

SSL_CERT_PATH="/etc/ssl/cert.pem"
### Install CloudFlare WARP (on non-WSL *nix systems)
if [[ ! "$(test -d /proc && grep Microsoft /proc/version > /dev/null)" ]]; then
  if [ -d /System ] && [ -d /Applications ]; then
    ### Install on macOS
    if [ ! -d "/Applications/Cloudflare WARP.app" ]; then
      brew install --cask --quiet cloudflare-warp
    else
      gum log -sl info 'Cloudflare WARP already installed'
    fi
  elif [ -n "$(uname -a | grep Debian)" ]; then
    ### Add CloudFlare WARP desktop app apt-get source
    if [ ! -f /etc/apt/sources.list.d/cloudflare-client.list ]; then
      gum log -sl info 'Adding CloudFlare WARP keyring'
      curl https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
      gum log -sl info 'Adding apt source reference'
      echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list
    fi

    ### Update apt-get and install the CloudFlare WARP CLI
    sudo apt-get update && sudo apt-get install -y cloudflare-warp
  elif [ -n "$(uname -a | grep Ubuntu)" ]; then
    ### Add CloudFlare WARP desktop app apt-get source
    if [ ! -f /etc/apt/sources.list.d/cloudflare-client.list ]; then
      gum log -sl info 'Adding CloudFlare WARP keyring'
      curl https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
      gum log -sl info 'Adding apt source reference'
      echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list
    fi

    ### Update apt-get and install the CloudFlare WARP CLI
    sudo apt-get update && sudo apt-get install -y cloudflare-warp
  elif command -v dnf > /dev/null && command -v rpm > /dev/null; then
    ### This is made for CentOS 8 and works on Fedora 36 (hopefully 36+ as well) with `nss-tools` as a dependency
    sudo dnf instal -y nss-tools || NSS_TOOL_EXIT=$?
    if [ -n "${NSS_TOOL_EXIT:-}" ]; then
      gum log -sl warn 'Unable to install nss-tools which was a requirement on Fedora 36 and assumed to be one on other systems as well.'
    fi

    ### According to the download site, this is the only version available for RedHat-based systems
    sudo rpm -ivh https://pkg.cloudflareclient.com/cloudflare-release-el8.rpm || RPM_EXIT_CODE=$?
    if [ -n "${RPM_EXIT_CODE:-}" ]; then
      gum log -sl error 'Unable to install CloudFlare WARP using RedHat 8 RPM package'
    fi
  fi
fi

### Ensure certificate is installed
if [ -d /System ] && [ -d /Applications ] && command -v warp-cli > /dev/null; then
  ### Ensure certificate installed on macOS
  if [ -z "$SSH_CONNECTION" ]; then
    # if [ -z "$HEADLESS_INSTALL" ]; then
    #     gum log -sl info '**macOS Manual Security Permission** Requesting security authorization for Cloudflare trusted certificate'
    #     sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt"
    # fi
    if [ -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" ]; then
      gum log -sl info 'Updating the OpenSSL CA Store to include the Cloudflare certificate'
      sudo tee -a "$SSL_CERT_PATH" < "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" > /dev/null
      echo "" | sudo tee -a "$SSL_CERT_PATH" > /dev/null
    else
      gum log -sl warn "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem is missing so not importing into to master pem"
    fi
  else
    gum log -sl warn 'Session is SSH so adding Cloudflare encryption key to trusted certificates via the security program is being bypassed since it requires Touch ID / Password verification.'
  fi

  if [ -f "/usr/local/opt/openssl@3/bin/c_rehash" ]; then
    # Location on Intel macOS
    gum log -sl info 'Ensuring /usr/local/etc/openssl@3/certs directory exists' && mkdir -p /usr/local/etc/openssl@3/certs
    gum log -sl info 'Adding Cloudflare certificate to /usr/local/etc/openssl@3/certs/cloudflare.pem'
    echo | sudo cat - "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" >> /usr/local/etc/openssl@3/certs/cloudflare.pem
    gum log -sl info 'Running /usr/local/opt/openssl@3/bin/c_rehash'
    /usr/local/opt/openssl@3/bin/c_rehash > /dev/null && gum log -sl info 'OpenSSL certificate rehash successful'
  elif [ -f "${HOMEBREW_PREFIX:-/opt/homebrew}/opt/openssl@3/bin/c_rehash" ]; then
    # Location on arm64 macOS and custom Homebrew locations
    gum log -sl info "Ensuring ${HOMEBREW_PREFIX:-/opt/homebrew}/etc/openssl@3/certs directory exists" && mkdir -p "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/openssl@3/certs"
    gum log -sl info "Adding Cloudflare certificate to ${HOMEBREW_PREFIX:-/opt/homebrew}/etc/openssl@3/certs/cloudflare.pem"
    echo | sudo cat - "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" >> "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/openssl@3/certs/cloudflare.pem"
    gum log -sl info "Running ${HOMEBREW_PREFIX:-/opt/homebrew}/opt/openssl@3/bin/c_rehash"
    "${HOMEBREW_PREFIX:-/opt/homebrew}/opt/openssl@3/bin/c_rehash" > /dev/null && gum log -sl info 'OpenSSL certificate rehash successful'
  else
    gum log -sl warn 'Unable to add cloudflare.pem because /usr/local/etc/openssl@3/certs and /opt/homebrew/etc/openssl@3/certs do not exist!'
  fi
elif command -v warp-cli > /dev/null; then
  # System is Linux
  if command -v dpkg-reconfigure > /dev/null; then
    if [ -d /usr/local/share/ca-certificates ]; then
      gum log -sl info 'Copying CloudFlare Teams PEM file to /usr/local/share/ca-certificates/cloudflare.crt'
      sudo cp -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" /usr/local/share/ca-certificates/cloudflare.crt
      gum log -sl info 'dpkg-reconfigure executable detected so using Debian/Ubuntu method of updating system trusted certificates to include CloudFlare Teams certificate'
      sudo dpkg-reconfigure ca-certificates -p high
      SSL_CERT_PATH="/etc/ssl/certs/ca-certificates.crt"
    else
      gum log -sl warn 'No /usr/local/share/ca-certificates folder present'
    fi
  elif command -v update-ca-trust > /dev/null; then
    if [ -d /etc/pki/ca-trust/source/anchors ]; then
      gum log -sl info 'Copying CloudFlare Teams certificates to /etc/pki/ca-trust/source/anchors'
      sudo cp -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt" "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" /etc/pki/ca-trust/source/anchors
      gum log -sl info 'update-ca-trust executable detected so using CentOS/Fedora method of updating system trusted certificates to include CloudFlare Teams certificate'
      sudo update-ca-trust
      SSL_CERT_PATH="/etc/pki/tls/certs/ca-bundle.crt"
    else
      gum log -sl warn '/etc/pki/ca-trust/source/anchors does not exist so skipping the system certificate update process'
    fi
  fi
fi

if command -v warp-cli > /dev/null; then
  ### Application certificate configuration
  # Application-specific certificate authority modification is currently commented out because
  # it is merely for traffic inspection and `npm install` fails when configured to use the CloudFlare
  # certificate and the WARP client is not running.
  ### Git
  if command -v git > /dev/null; then
    gum log -sl info "Configuring git to use $SSL_CERT_PATH"
    git config --global http.sslcainfo "$SSL_CERT_PATH"
  fi

  ### NPM
  if command -v npm > /dev/null; then
    gum log -sl info "Configuring npm to use $SSL_CERT_PATH"
    npm config set cafile "$SSL_CERT_PATH"
  fi

  ### Python
  if command -v python3 > /dev/null; then
    ### Ensure Certifi package is available globally
    if ! pip3 list | grep certifi > /dev/null; then
      if command -v brew > /dev/null; then
        gum log -sl info 'Ensuring Python certifi is installed via Homebrew'
        brew install --quiet certifi
      else
        gum log -sl info 'Ensuring certifi is installed globally for Python 3'
        pip3 install certifi
      fi
    fi

    ### Copy CloudFlare PEM file to Python 3 location
    gum log -sl info "Configuring python3 / python to use "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem""
    echo | cat - "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" >> $(python3 -m certifi)
  fi

  ### Google Cloud SDK
  if command -v gcloud > /dev/null; then
    gum log -sl info "Configuring gcloud to use "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" and "$HOME/.local/etc/ssl/gcloud/ca.pem""
    mkdir -p "$HOME/.local/etc/ssl/gcloud"
    cat "$HOME/.local/etc/ssl/curl/cacert.pem" "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" > "$HOME/.local/etc/ssl/gcloud/ca.pem"
    gcloud config set core/custom_ca_certs_file "$HOME/.local/etc/ssl/gcloud/ca.pem"
  fi

  ### Google Drive for desktop (macOS)
  if [ -d "/Applications/Google Drive.app" ]; then
    if [ -d "/Applications/Google Drive.app/Contents/Resources" ]; then
      gum log -sl info "Combining Google Drive roots.pem with CloudFlare certificate"
      mkdir -p "$HOME/.local/etc/ssl/google-drive"
      cat "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" "/Applications/Google Drive.app/Contents/Resources/roots.pem" >> "$HOME/.local/etc/ssl/google-drive/roots.pem"
      sudo defaults write /Library/Preferences/com.google.drivefs.settings TrustedRootsCertsFile -string "$HOME/.local/etc/ssl/google-drive/roots.pem"
    else
      gum log -sl warn 'Google Drive.app installed but roots.pem is not available yet'
    fi
  fi

  ### Ensure MDM settings are applied (deletes after reboot on macOS)
  ### TODO: Ensure `.plist` can be added to `~/Library/Managed Preferences` and not just `/Library/Managed Preferences`
  # Source: https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/deployment/mdm-deployment/
  # Source for JumpCloud: https://developers.cloudflare.com/cloudflare-one/static/documentation/connections/CloudflareWARP.mobileconfig
  if [ -d /System ] && [ -d /Applications ]; then
    sudo plutil -convert binary1 '/Library/Managed Preferences/com.cloudflare.warp.plist'
    ### Enable CloudFlare WARP credentials auto-populate (since file is deleted when not managed with MDM)
    sudo launchctl load "/Library/LaunchDaemons/com.cloudflare.warp.plist"
  elif [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/warp/mdm.xml" ]; then
    sudo mkdir -p /var/lib/cloudflare-warp
    sudo cp -f "${XDG_CONFIG_HOME:-$HOME/.config}/warp/mdm.xml" /var/lib/cloudflare-warp/mdm.xml
  fi

  ### Register CloudFlare WARP
  if warp-cli --accept-tos status | grep 'Registration Missing' > /dev/null; then
    gum log -sl info 'Registering CloudFlare WARP'
    warp-cli --accept-tos registration new
  else
    gum log -sl info 'Either there is a misconfiguration or the device is already registered with CloudFlare WARP'
  fi

  ### Connect CloudFlare WARP
  if warp-cli --accept-tos status | grep 'Disconnected' > /dev/null; then
    gum log -sl info 'Connecting to CloudFlare WARP'
    warp-cli --accept-tos connect > /dev/null && gum log -sl info 'Connected to CloudFlare WARP'
  else
    gum log -sl info 'Either there is a misconfiguration or the device is already connected with CloudFlare WARP'
  fi
else
  gum log -sl warn 'warp-cli was not installed so CloudFlare WARP cannot be joined'
fi
