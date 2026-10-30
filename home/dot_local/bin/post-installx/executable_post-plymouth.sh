#!/usr/bin/env bash
set -euo pipefail
# @file Plymouth Theme / Configuration
# @brief Configures Plymouth to use a custom theme
# @description
#     This script installs Plymouth and then configures it to use our custom Betelgeuse theme.

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Create /etc/plymouth/plymouthd.conf
if [ -f /etc/plymouth/plymouthd.conf ]; then
  ### Back up original plymouthd.conf
  if [ ! -f /etc/plymouth/plymouthd.conf.bak ]; then
    gum log -sl info 'Backing up /etc/plymouth/plymouthd.conf to /etc/plymouth/plymouthd.conf.bak'
    sudo cp -f /etc/plymouth/plymouthd.conf /etc/plymouth/plymouthd.conf.bak
  fi
  ### Create new plymouthd.conf
  gum log -sl info 'Populating the /etc/plymouth/plymouthd.conf file'
  echo "[Daemon]" | sudo tee /etc/plymouth/plymouthd.conf > /dev/null
  echo "Theme=Betelgeuse" | sudo tee -a /etc/plymouth/plymouthd.conf > /dev/null
  echo "ShowDelay=1" | sudo tee -a /etc/plymouth/plymouthd.conf > /dev/null
fi

### Apply update-alternatives
if command -v update-alternatives > /dev/null; then
  if [ -f "/usr/local/share/plymouth/themes/Betelgeuse/Betelgeuse.plymouth" ]; then
    sudo update-alternatives --install /usr/share/plymouth/themes/default.plymouth default.plymouth "/usr/local/share/plymouth/themes/Betelgeuse/Betelgeuse.plymouth" 100
    gum log -sl info 'Installed default.plymouth'
    # Required sometimes
    sudo update-alternatives --set default.plymouth "/usr/local/share/plymouth/themes/Betelgeuse/Betelgeuse.plymouth"
    gum log -sl info 'Set default.plymouth'
  else
    gum log -sl warn "/usr/local/share/plymouth/themes/Betelgeuse/Betelgeuse.plymouth does not exist!"
  fi
else
  gum log -sl warn 'update-alternatives is not available'
fi

### Update /etc/plymouth/plymouthd.conf
# Replaced by code above
# if [ -f /etc/plymouth/plymouthd.conf ]; then
#     gum log -sl info 'Setting ShowDelay=1 in /etc/plymouth/plymouthd.conf'
#     if cat /etc/plymouth/plymouthd.conf | grep ShowDelay; then
#         sudo sed -i 's/^ShowDelay=.*/ShowDelay=1/' /etc/plymouth/plymouthd.conf
#     else
#         echo 'ShowDelay=1' | sudo tee -a /etc/plymouth/plymouthd.conf > /dev/null
#     fi
# else
#     gum log -sl warn '/etc/plymouth/plymouthd.conf does not exist!'
# fi

### Symlink /usr/local/share/plymouth/themes to /usr/share/plymouth/themes
if [ ! -d '/usr/share/plymouth/themes/Betelgeuse' ]; then
  gum log -sl info 'Symlinking /usr/local/share/plymouth/themes/Betelgeuse to /usr/share/plymouth/themes/Betelgeuse'
  sudo ln -s '/usr/local/share/plymouth/themes/Betelgeuse' '/usr/share/plymouth/themes/Betelgeuse'
fi

### Set default Plymouth theme
if command -v plymouth-set-default-theme > /dev/null; then
  sudo plymouth-set-default-theme -R 'Betelgeuse' || EXIT_CODE=$?
  if [ -n "${EXIT_CODE:-}" ]; then
    gum log -sl warn 'There may have been an issue while setting the Plymouth default theme with plymouth-set-default-theme'
  else
    gum log -sl info 'Set Plymouth default theme with plymouth-set-default-theme'
  fi
else
  gum log -sl warn 'Could not apply default Plymouth theme because plymouth-set-default-theme is missing'
fi

### Apply update-alternatives (again - required sometimes)
if command -v update-alternatives > /dev/null; then
  if [ -f "/usr/local/share/plymouth/themes/Betelgeuse/Betelgeuse.plymouth" ]; then
    # Required sometimes
    sudo update-alternatives --set default.plymouth "/usr/local/share/plymouth/themes/Betelgeuse/Betelgeuse.plymouth"
    gum log -sl info 'Set default.plymouth (second time is required sometimes)'
  else
    gum log -sl warn "/usr/local/share/plymouth/themes/Betelgeuse/Betelgeuse.plymouth does not exist!"
  fi
else
  gum log -sl warn 'update-alternatives is not available'
fi

### Update kernel / initrd images
# Set `export DEBUG_MODE=true` to bypass GRUB2 / Plymouth application
if [ "${DEBUG_MODE:-}" != 'true' ]; then
  if command -v update-initramfs > /dev/null; then
    gum log -sl info 'Running sudo update-initramfs -u'
    sudo update-initramfs -u
    gum log -sl info 'Updated kernel / initrd images for Plymouth'
  elif command -v dracut > /dev/null; then
    gum log -sl info 'Running sudo dracut --regenerate-all -f'
    sudo dracut --regenerate-all -f
    gum log -sl info 'Updated kernel / initrd images for Plymouth'
  else
    gum log -sl warn 'Unable to update kernel / initrd images because neither update-initramfs or dracut are available'
  fi
fi
