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
#     * [Linux managed configuration](https://github.com/heymegabyte/install.doctor/tree/master/home/dot_config/warp/private_mdm.xml.tmpl)
#     * [macOS managed configuration](https://github.com/heymegabyte/install.doctor/tree/master/home/Library/Managed%20Preferences/private_com.cloudflare.warp.plist.tmpl)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

SSL_CERT_PATH="/etc/ssl/cert.pem"
### Installation belongs to selected desired state; this hook configures only
### an already admitted WARP client and never adds package trust on its own.
if ! command -v warp-cli >/dev/null 2>&1 && [ ! -d "/Applications/Cloudflare WARP.app" ]; then
  gum log -sl warn 'Cloudflare WARP is absent; select it through Install Doctor desired state'
  exit 20
fi

### Ensure certificate is installed
if [ -d /System ] && [ -d /Applications ] && command -v warp-cli > /dev/null; then
  ### Ensure certificate installed on macOS
  if [ -z "${SSH_CONNECTION:-}" ]; then
    # if [ -z "$HEADLESS_INSTALL" ]; then
    #     gum log -sl info '**macOS Manual Security Permission** Requesting security authorization for Cloudflare trusted certificate'
    #     sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$HOME/.local/etc/ssl/cloudflare/cloudflare.crt"
    # fi
    if [ -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" ]; then
      gum log -sl info 'Updating the OpenSSL CA Store to include the Cloudflare certificate'
      CF_CERT_HEADER="$(head -n 2 "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" | tail -n 1)"
      if ! grep -qF "$CF_CERT_HEADER" "$SSL_CERT_PATH" 2>/dev/null; then
        sudo tee -a "$SSL_CERT_PATH" < "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" > /dev/null
        echo "" | sudo tee -a "$SSL_CERT_PATH" > /dev/null
      fi
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
    sudo cp -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" /usr/local/etc/openssl@3/certs/cloudflare.pem
    gum log -sl info 'Running /usr/local/opt/openssl@3/bin/c_rehash'
    /usr/local/opt/openssl@3/bin/c_rehash > /dev/null && gum log -sl info 'OpenSSL certificate rehash successful'
  elif [ -f "${HOMEBREW_PREFIX:-/opt/homebrew}/opt/openssl@3/bin/c_rehash" ]; then
    # Location on arm64 macOS and custom Homebrew locations
    gum log -sl info "Ensuring ${HOMEBREW_PREFIX:-/opt/homebrew}/etc/openssl@3/certs directory exists" && mkdir -p "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/openssl@3/certs"
    gum log -sl info "Adding Cloudflare certificate to ${HOMEBREW_PREFIX:-/opt/homebrew}/etc/openssl@3/certs/cloudflare.pem"
    sudo cp -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/openssl@3/certs/cloudflare.pem"
    gum log -sl info "Running ${HOMEBREW_PREFIX:-/opt/homebrew}/opt/openssl@3/bin/c_rehash"
    "${HOMEBREW_PREFIX:-/opt/homebrew}/opt/openssl@3/bin/c_rehash" > /dev/null && gum log -sl info 'OpenSSL certificate rehash successful'
  else
    gum log -sl warn 'Unable to add cloudflare.pem because /usr/local/etc/openssl@3/certs and /opt/homebrew/etc/openssl@3/certs do not exist!'
  fi
elif command -v warp-cli > /dev/null; then
  # System is Linux
  if command -v update-ca-certificates > /dev/null; then
    if [ -d /usr/local/share/ca-certificates ]; then
      gum log -sl info 'Copying CloudFlare Teams PEM file to /usr/local/share/ca-certificates/cloudflare.crt'
      sudo cp -f "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" /usr/local/share/ca-certificates/cloudflare.crt
      gum log -sl info 'update-ca-certificates detected so using the Debian/Ubuntu/Alpine method of updating system trusted certificates to include the CloudFlare Teams certificate'
      sudo update-ca-certificates
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
    gum log -sl info "Configuring python3 / python to use $HOME/.local/etc/ssl/cloudflare/cloudflare.pem"
    CERTIFI_BUNDLE="$(python3 -m certifi)"
    CF_CERT_HEADER="$(head -n 2 "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" | tail -n 1)"
    if [ -f "$CERTIFI_BUNDLE" ] && ! grep -qF "$CF_CERT_HEADER" "$CERTIFI_BUNDLE" 2>/dev/null; then
      echo | cat - "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" >> "$CERTIFI_BUNDLE"
    fi
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
      cat "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem" "/Applications/Google Drive.app/Contents/Resources/roots.pem" > "$HOME/.local/etc/ssl/google-drive/roots.pem"
      sudo defaults write /Library/Preferences/com.google.drivefs.settings TrustedRootsCertsFile -string "$HOME/.local/etc/ssl/google-drive/roots.pem"
    else
      gum log -sl warn 'Google Drive.app installed but roots.pem is not available yet'
    fi
  fi

  ### Linux Desktop Browsers (Chrome/Chromium NSS DB + Firefox Enterprise Roots + Chrome English Locale Policy),
  ### uv/certifi bundles, systemd user units (Paperclip/OpenClaw/Runners), and Paperclip plugin-worker CA passthrough
  if [ "$(uname -s)" = "Linux" ]; then
    WARP_CA_PEM=""
    for candidate in /usr/local/share/ca-certificates/managed-warp.pem /usr/local/share/ca-certificates/cloudflare.crt "$HOME/.local/etc/ssl/cloudflare/cloudflare.pem"; do
      if [ -s "$candidate" ]; then
        WARP_CA_PEM="$candidate"
        break
      fi
    done

    if [ -n "$WARP_CA_PEM" ]; then
      # 1. Chrome / Chromium / Electron user NSS DB (~/.pki/nssdb) + Firefox profile NSS DBs
      if ! command -v certutil >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libnss3-tools >/dev/null 2>&1 || true
      fi
      if command -v certutil >/dev/null 2>&1; then
        mkdir -p "$HOME/.pki/nssdb"
        certutil -D -d "sql:$HOME/.pki/nssdb" -n "Cloudflare Gateway CA" 2>/dev/null || true
        certutil -A -d "sql:$HOME/.pki/nssdb" -n "Cloudflare Gateway CA" -t "CT,C,C" -i "$WARP_CA_PEM" 2>/dev/null || true
        for dbdir in "$HOME"/snap/firefox/common/.mozilla/firefox/*.default* "$HOME"/.mozilla/firefox/*.default*; do
          [ -d "$dbdir" ] || continue
          certutil -D -d "sql:$dbdir" -n "Cloudflare Gateway CA" 2>/dev/null || true
          certutil -A -d "sql:$dbdir" -n "Cloudflare Gateway CA" -t "CT,C,C" -i "$WARP_CA_PEM" 2>/dev/null || true
        done
      fi

      # 2. Firefox Enterprise Roots policy + Chrome English locale policy (prevents WARP egress IP geolocation serving foreign Google)
      if sudo -n true 2>/dev/null; then
        sudo -n mkdir -p /etc/firefox/policies /etc/opt/chrome/policies/managed
        sudo -n tee /etc/firefox/policies/policies.json >/dev/null <<FF_EOF
{"policies":{"Certificates":{"ImportEnterpriseRoots":true,"Install":["$WARP_CA_PEM","/etc/ssl/certs/managed-warp.pem","/etc/ssl/certs/ca-certificates.crt"]}}}
FF_EOF
        sudo -n tee /etc/opt/chrome/policies/managed/00-english.json >/dev/null <<'CHROME_EOF'
{"ApplicationLocaleValue":"en-US","HomepageLocation":"https://www.google.com/ncr?hl=en&gl=us","HomepageIsNewTabPage":false,"RestoreOnStartup":4,"RestoreOnStartupURLs":["https://www.google.com/ncr?hl=en&gl=us"]}
CHROME_EOF
        if ! grep -q '^NODE_EXTRA_CA_CERTS=' /etc/environment 2>/dev/null; then
          sudo -n tee -a /etc/environment >/dev/null <<ENV_EOF
NODE_EXTRA_CA_CERTS=$WARP_CA_PEM
NODE_OPTIONS=--use-system-ca
SSL_CERT_FILE=$SSL_CERT_PATH
SSL_CERT_DIR=/etc/ssl/certs
REQUESTS_CA_BUNDLE=$SSL_CERT_PATH
CURL_CA_BUNDLE=$SSL_CERT_PATH
GIT_SSL_CAINFO=$SSL_CERT_PATH
AWS_CA_BUNDLE=$SSL_CERT_PATH
ENV_EOF
        fi
      fi

      # 3. User-session environment.d + systemd user service drop-ins (Paperclip, OpenClaw, GitHub Actions runners)
      mkdir -p "$HOME/.config/environment.d"
      cat > "$HOME/.config/environment.d/10-warp-ca.conf" <<ENVD_EOF
NODE_EXTRA_CA_CERTS=$WARP_CA_PEM
NODE_OPTIONS=--use-system-ca
SSL_CERT_FILE=$SSL_CERT_PATH
SSL_CERT_DIR=/etc/ssl/certs
REQUESTS_CA_BUNDLE=$SSL_CERT_PATH
CURL_CA_BUNDLE=$SSL_CERT_PATH
GIT_SSL_CAINFO=$SSL_CERT_PATH
AWS_CA_BUNDLE=$SSL_CERT_PATH
ENVD_EOF
      for unit_dir in paperclipai.service.d agent-runner-01.service.d agent-runner-02.service.d agent-runner-03.service.d; do
        if [ -d "$HOME/.config/systemd/user/$unit_dir" ] || [ -f "$HOME/.config/systemd/user/${unit_dir%.d}" ]; then
          mkdir -p "$HOME/.config/systemd/user/$unit_dir"
          cat > "$HOME/.config/systemd/user/$unit_dir/use-system-ca.conf" <<DROPIN_EOF
[Service]
Environment="NODE_EXTRA_CA_CERTS=$WARP_CA_PEM"
Environment="NODE_OPTIONS=--use-system-ca"
Environment="SSL_CERT_FILE=$SSL_CERT_PATH"
Environment="SSL_CERT_DIR=/etc/ssl/certs"
Environment="REQUESTS_CA_BUNDLE=$SSL_CERT_PATH"
Environment="CURL_CA_BUNDLE=$SSL_CERT_PATH"
Environment="GIT_SSL_CAINFO=$SSL_CERT_PATH"
Environment="AWS_CA_BUNDLE=$SSL_CERT_PATH"
DROPIN_EOF
        fi
      done

      # 4. Append WARP CA to isolated uv Python certifi bundles (~/.local/share/uv & ~/.cache/uv) and patch Paperclip plugin-worker env
      python3 - "$WARP_CA_PEM" <<'PY_EOF' 2>/dev/null || true
from pathlib import Path
import sys

warp_ca = Path(sys.argv[1])
warp_pem = warp_ca.read_text()
header = warp_pem.splitlines()[1] if len(warp_pem.splitlines()) > 1 else "BEGIN CERTIFICATE"
home = Path.home()

for base in (home / ".local/share/uv", home / ".cache/uv"):
    if base.is_dir():
        for cacert in base.rglob("cacert.pem"):
            try:
                txt = cacert.read_text()
                if header not in txt:
                    cacert.write_text(txt.rstrip() + "\n\n# Cloudflare Gateway CA\n" + warp_pem)
            except OSError:
                pass

pwm = home / ".paperclip/cli/current/node_modules/@paperclipai/server/dist/services/plugin-worker-manager.js"
if pwm.is_file():
    t = pwm.read_text()
    target = '            TZ: process.env.TZ ?? "UTC",\n        };'
    repl = (
        '            TZ: process.env.TZ ?? "UTC",\n'
        '            ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}),\n'
        '            ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}),\n'
        '            ...(process.env.SSL_CERT_FILE ? { SSL_CERT_FILE: process.env.SSL_CERT_FILE } : {}),\n'
        '            ...(process.env.SSL_CERT_DIR ? { SSL_CERT_DIR: process.env.SSL_CERT_DIR } : {}),\n'
        '            ...(process.env.REQUESTS_CA_BUNDLE ? { REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE } : {}),\n'
        '            ...(process.env.CURL_CA_BUNDLE ? { CURL_CA_BUNDLE: process.env.CURL_CA_BUNDLE } : {}),\n'
        '        };'
    )
    if "NODE_EXTRA_CA_CERTS" not in t and target in t:
        pwm.write_text(t.replace(target, repl, 1))
PY_EOF
    fi
  fi

  ### Ensure MDM settings are applied (deletes after reboot on macOS)
  ### TODO: Ensure `.plist` can be added to `~/Library/Managed Preferences` and not just `/Library/Managed Preferences`
  # Source: https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/deployment/mdm-deployment/
  # Source for JumpCloud: https://developers.cloudflare.com/cloudflare-one/static/documentation/connections/CloudflareWARP.mobileconfig
  if [ -d /System ] && [ -d /Applications ]; then
    sudo plutil -convert binary1 '/Library/Managed Preferences/com.cloudflare.warp.plist'
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
