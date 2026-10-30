#!/usr/bin/env bash
set -euo pipefail
# @file SendGrid Postfix Configuration
# @brief Configures Postfix to use SendGrid as a relay host so you can use the `mail` program to send e-mail from the command-line
# @description
#     This script follows the instructions from [SendGrid's documentation on integrating Postfix](https://docs.sendgrid.com/for-developers/sending-email/postfix).
#     After this script runs, you should be able to send outgoing e-mails using SendGrid as an SMTP handler. In other words, you will
#     be able to use the `mail` CLI command to send e-mails. The following is an example mailing the contents of `~/.bashrc` to `name@email.com`:
#
#     ```shell
#     cat ~/.bashrc | mail -s "My subject" name@email.com
#     ```

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Acquire PUBLIC_SERVICES_DOMAIN and PRIMARY_EMAIL
if command -v yq > /dev/null; then
  if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml" ]; then
    PUBLIC_SERVICES_DOMAIN="$(yq '.data.host.domain' "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml")"
    PRIMARY_EMAIL="$(yq '.data.user.email' "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml")"
  else
    gum log -sl warn "${XDG_CONFIG_HOME:-$HOME/.config}/chezmoi/chezmoi.yaml is missing and is required for acquiring the PUBLIC_SERVICES_DOMAIN and PRIMARY_EMAIL"
  fi
else
  gum log -sl warn 'yq is not installed on the system and is required for populating the PUBLIC_SERVICES_DOMAIN and PRIMARY_EMAIL'
fi

### Setup Postfix if SENDGRID_API_KEY is retrieved
if get-secret --exists SENDGRID_API_KEY; then
  if command -v postfix > /dev/null; then
    ### Ensure dependencies are installed
    if command -v apt-get > /dev/null; then
      gum log -sl info 'Installing libsasl2-modules'
      sudo apt-get update
      sudo apt-get install -y libsasl2-modules || EXIT_CODE=$?
    elif command -v dnf > /dev/null; then
      sudo dnf install -y cyrus-sasl-plain || EXIT_CODE=$?
    elif command -v yum > /dev/null; then
      sudo yum install -y cyrus-sasl-plain || EXIT_CODE=$?
    fi
    if [ -n "${EXIT_CODE:-}" ]; then
      gum log -sl warn 'There was an error ensuring the Postfix-SendGrid dependencies were installed'
    fi
    if [ -d /etc/postfix ]; then
      ### Add the SendGrid Postfix settings to the Postfix configuration
      if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/postfix/main.cf" ]; then
        CONFIG_FILE=/etc/postfix/main.cf
        if cat "$CONFIG_FILE" | grep '### INSTALL DOCTOR MANAGED' > /dev/null; then
          gum log -sl info 'Removing Install Doctor-managed block of code in /etc/postfix/main.cf block'
          START_LINE="$(grep -n -m 1 "### INSTALL DOCTOR MANAGED ### START" "$CONFIG_FILE" | cut -f1 -d ":")"
          END_LINE="$(grep -n -m 1 "### INSTALL DOCTOR MANAGED ### END" "$CONFIG_FILE" | cut -f1 -d ":")"
          if [ -n "$START_LINE" ] && [ -n "$END_LINE" ]; then
            if command -v gsed > /dev/null; then
              sudo gsed -i "${START_LINE},${END_LINE}d" "$CONFIG_FILE"
            else
              sudo sed -i "${START_LINE},${END_LINE}d" "$CONFIG_FILE"
            fi
          else
            gum log -sl info 'No start-line or end-line detected - configuration appears to already be clean'
          fi
        fi
        ### Add Postfix main configuration
        logg "Adding the following configuration from ${XDG_CONFIG_HOME:-$HOME/.config}/postfix/main.cf to /etc/postfix/main.cf"
        cat "${XDG_CONFIG_HOME:-$HOME/.config}/postfix/main.cf" | sudo tee -a "$CONFIG_FILE" > /dev/null
        echo "" | sudo tee -a "$CONFIG_FILE" > /dev/null
      fi
      ### Ensure proper permissions on `sasl_passwd` and update Postfix hashmaps
      if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/postfix/sasl_passwd" ]; then
        gum log -sl info "Copying file from ${XDG_CONFIG_HOME:-$HOME/.config}/postfix/sasl_passwd to /etc/postfix/sasl_passwd"
        sudo cp -f "${XDG_CONFIG_HOME:-$HOME/.config}/postfix/sasl_passwd" /etc/postfix/sasl_passwd
        gum log -sl info 'Assigning proper permissions to /etc/postfix/sasl_passwd'
        sudo chmod 600 /etc/postfix/sasl_passwd
        gum log -sl info 'Updating Postfix hashmaps for /etc/postfix/sasl_passwd'
        sudo postmap /etc/postfix/sasl_passwd
      else
        gum log -sl warn "${XDG_CONFIG_HOME:-$HOME/.config}/postfix/sasl_passwd file is missing"
      fi

      ### Forward root e-mails
      if [ -n "$PRIMARY_EMAIL" ]; then
        if [ -d /root ]; then
          gum log -sl info "Forwarding root e-mails to $PRIMARY_EMAIL"
          echo "$PRIMARY_EMAIL" | sudo tee /root/.forward > /dev/null || gum log -sl error 'Failed to set root user .forward file'
        elif [ -d /var/root ]; then
          gum log -sl info "Forwarding root e-mails to $PRIMARY_EMAIL"
          echo "$PRIMARY_EMAIL" | sudo tee /var/root/.forward > /dev/null || gum log -sl error 'Failed to set root user .forward file'
        else
          gum log -sl warn 'Unable to identify root user home directory'
        fi
      else
        gum log -sl warn 'PRIMARY_EMAIL is undefined so cannot setup root email forwarding'
      fi

      ### Ensure /etc/postfix/header_checks exists
      if [ ! -d /etc/postfix/header_checks ]; then
        gum log -sl info 'Creating /etc/postfix/header_checks since it does not exist'
        sudo touch /etc/postfix/header_checks
      fi

      ### Re-write header From for SendGrid
      if [ -n "$PUBLIC_SERVICES_DOMAIN" ]; then
        if ! cat /etc/postfix/header_checks | grep "no-reply@${PUBLIC_SERVICES_DOMAIN}" > /dev/null; then
          gum log -sl info 'Added From REPLACE to /etc/postfix/header_checks'
          echo "/^From:.*@${PUBLIC_SERVICES_DOMAIN}/ REPLACE From: no-reply@${PUBLIC_SERVICES_DOMAIN}" | sudo tee -a /etc/postfix/header_checks > /dev/null
        fi
      else
        gum log -sl warn 'PUBLIC_SERVICES_DOMAIN is undefined'
      fi

      ### Update aliases
      if [ -f /etc/aliases ] && [ -n "$PRIMARY_EMAIL" ]; then
        gum log -sl info "Forward root e-mails to $PRIMARY_EMAIL"
        ALIASES_TMP="$(mktemp)"
        gum log -sl info "Setting $PRIMARY_EMAIL as root e-mail in temporary file"
        sudo sed "s/#root.*/root:\ $PRIMARY_EMAIL/" /etc/aliases | tee "$ALIASES_TMP" > /dev/null
        gum log -sl info 'Moving temporary file to /etc/aliases'
        sudo mv -f "$ALIASES_TMP" /etc/aliases
        if ! cat /etc/aliases | grep "$USER_USERNAME: root" > /dev/null; then
          gum log -sl info 'Forward user e-mail to root@localhost'
          echo "$USER_USERNAME: root" | sudo tee -a /etc/aliases > /dev/null
        fi
        ### Ensure old /etc/aliases.db is removed
        if [ -f /etc/aliases.db ]; then
          gum log -sl info 'Ensuring /etc/aliases.db is removed' && sudo rm -f /etc/aliases.db
        else
          gum log -sl info '/etc/aliases.db was not found'
        fi
        ### Re-generate the /etc/aliases.db file
        if [ -f /etc/aliases ]; then
          if command -v gstat > /dev/null; then
            gum log -sl info 'Ensuring proper permissions on the /etc/aliases file' && sudo chown "$(gstat -c "%U:%G" /etc/sudoers)" /etc/aliases
          elif command -v stat > /dev/null; then
            gum log -sl info 'Ensuring proper permissions on the /etc/aliases file' && sudo chown "$(stat -c "%U:%G" /etc/sudoers)" /etc/aliases
          else
            gum log -sl info 'Neither the gstat or stat command are available - cannot run sudo chown $(stat/gstat -c "%U:%G" /etc/sudoers) /etc/aliases'
          fi
          gum log -sl info 'Generating Postfix aliases' && sudo postalias /etc/aliases > /dev/null
        else
          gum log -sl warn '/etc/aliases is missing which is required for Postfix'
        fi
        # The `sudo newaliases` mode is probably used to regenerate the /etc/aliases.db
        # but since we are removing it to ensure proper permissions, this method is commented out.
        # gum log -sl info 'Running newaliases to regenerate the alias database' && sudo newaliases
      else
        gum log -sl warn '/etc/aliases does not appear to exist or PRIMARY_EMAIL is undefined'
      fi
      if [ -d /Applications ] && [ -d /System ]; then
        ### macOS
        # Source: https://budiirawan.com/install-mail-server-mac-osx/
        if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/postfix/com.apple.postfix.master.plist" ] && ! sudo launchctl list | grep 'postfix.master' > /dev/null; then
          gum log -sl info 'Copying com.apple.postfix.master.plist'
          sudo cp -f "${XDG_CONFIG_HOME:-$HOME/.config}/postfix/com.apple.postfix.master.plist" /System/Library/LaunchDaemons/com.apple.postfix.master.plist
          if sudo launchctl list | grep 'com.apple.postfix.master' > /dev/null; then
            gum log -sl info 'Unloading previous Postfix launch configuration'
            sudo launchctl unload /System/Library/LaunchDaemons/com.apple.postfix.master.plist
          fi
          sudo launchctl load -w /System/Library/LaunchDaemons/com.apple.postfix.master.plist && gum log -sl info 'launchctl load of com.apple.postfix.master successful'
        fi
        if ! sudo postfix status > /dev/null; then
          gum log -sl info 'Starting postfix'
          sudo postfix start > /dev/null
        else
          gum log -sl info 'Reloading postfix'
          sudo postfix reload > /dev/null
        fi
      else
        ### Enable / restart postfix on Linux
        gum log -sl info 'Enabling / restarting postfix'
        sudo systemctl enable postfix
        sudo systemctl restart postfix
      fi
    else
      gum log -sl warn '/etc/postfix is not a directory! Skipping SendGrid Postfix setup.'
    fi
  else
    gum log -sl info 'Skipping Postfix configuration because Postfix is not installed'
  fi
else
  gum log -sl info 'SENDGRID_API_KEY is undefined so skipping Postfix configuration'
fi