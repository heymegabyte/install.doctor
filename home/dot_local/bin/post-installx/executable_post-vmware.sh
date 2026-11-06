#!/usr/bin/env bash
set -euo pipefail
# @file VMWare Configuration
# @brief Installs VMWare Workstation Pro on Linux devices, applies a "publicly-retrieved" license key (see disclaimer), and automatically accepts the terms and conditions
# @description
#     This script ensures the user included `vmware` in their software installation list. It then checks for presence of the `vmware` utility. If it is not present, then the script:
#
#     1. Downloads the [VMWare Workstation Pro](https://www.vmware.com/content/vmware/vmware-published-sites/us/products/workstation-pro.html.html) Linux installer
#     2. Installs VMWare Workstation Pro
#     3. Passes options to the installation script that automatically apply a publicly retrived license key and accept the Terms & Conditions
#
#     **DISCLAIMER:** If you plan on using VMWare Workstation for anything but evaluation purposes, then we highly suggest purchasing a copy
#     of VMWare Workstation. The "publicly-retrived" license keys are scattered throughout GitHub and we are not exactly
#     sure why they work. You can pass in your own key by utilizing the `VMWARE_WORKSTATION_LICENSE_KEY` environment variable. More details on
#     using environment variables or repository-housed encrypted secrets can be found in our [Secrets documentation](https://install.doctor/docs/customization/secrets).
#
#     ## VMWare on macOS
#
#     This script only installs VMWare Workstation on Linux. The macOS-variant titled VMWare Fusion can be installed using a Homebrew
#     cask so a "work-around" script does not have to be used.
#
#     ## VMWare vs. Parallels vs. VirtualBox vs. KVM vs. Hyper-V
#
#     There are a handful of VM virtualization providers you can choose from. VMWare is a nice compromise between OS compatibility and performance.
#     Parallels, on the hand, might be better for macOS since it is designed specifically for macOS. Finally, VirtualBox is a truly free,
#     open-source option that does not come with the same optimizations that VMWare and Parallels provide.
#
#     Other virtualization options include KVM (Linux / macOS) and Hyper-V (Windows). These options are better used for headless
#     systems.
#
#     ## Links
#
#     * [VMWare Workstation homepage](https://www.vmware.com/content/vmware/vmware-published-sites/us/products/workstation-pro.html.html)
#     * [`home/.chezmoidata.yaml`](https://github.com/heymegabyte/install.doctor/blob/master/home/.chezmoidata.yaml)
#     * [Default license key gist](https://gist.github.com/PurpleVibe32/30a802c3c8ec902e1487024cdea26251)

set -Eeo pipefail
trap "gum log -sl error 'Script encountered an error!'" ERR

### Run logic if VMware is installed
if command -v vmware > /dev/null; then
  ### Build kernel modules if they are not present
  if [ ! -f "/lib/modules/$(uname -r)/misc/vmmon.ko" ] || [ ! -f "/lib/modules/$(uname -r)/misc/vmnet.ko" ]; then
    ### Build VMWare host modules
    gum log -sl info 'Building VMware host modules'
    if sudo vmware-modconfig --console --install-all; then
      gum log -sl info 'Built VMWare host modules successfully with sudo vmware-modconfig --console --install-all'
    else
      gum log -sl warn 'Vendor module build failed; unverified third-party kernel-module fallback is unsupported'
      exit 20
    fi

    ### Sign VMware host modules if Secure Boot is enabled
    if [ -f /sys/firmware/efi ]; then
      gum log -sl info 'Signing host modules'
      mkdir -p /tmp/vmware
      cd /tmp/vmware
      openssl req -new -x509 -newkey rsa:2048 -keyout MOK.priv -outform DER -out MOK.der -nodes -days 36500 -subj "/CN=VMware/"
      "/usr/src/linux-headers-$(uname -r)/scripts/sign-file" sha256 ./MOK.priv ./MOK.der "$(modinfo -n vmmon)"
      "/usr/src/linux-headers-$(uname -r)/scripts/sign-file" sha256 ./MOK.priv ./MOK.der "$(modinfo -n vmnet)"
      echo '' | mokutil --import MOK.der
      gum log -sl info 'Successfully signed VMware host modules. Reboot the host before powering on VMs'
    fi

    # Third-party root patching is intentionally unsupported: the former
    # latest-release flow executed replaceable network bytes as root.
    gum log -sl info 'VMware Unlocker is not managed by Install Doctor'
    if [[ ! "$(test -d /proc && grep Microsoft /proc/version > /dev/null)" ]]; then
      ### Start / enable VMWare service
      gum log -sl info 'Ensuring vmware.service is enabled and running'
      sudo systemctl enable vmware.service
      sudo systemctl restart vmware.service

      ### Start / enable VMWare Workstation Server service
      gum log -sl info 'Ensuring vmware-workstation-server.service is enabled and running'
      sudo systemctl enable vmware-workstation-server.service
      sudo systemctl restart vmware-workstation-server.service

      ### Start / enable VMWare USB Arbitrator service
      if command -v vmware-usbarbitrator.service > /dev/null; then
        gum log -sl info 'Ensuring vmware-usbarbitrator.service is enabled and running'
        sudo systemctl enable vmware-usbarbitrator.service
        sudo systemctl restart vmware-usbarbitrator.service
      else
        gum log -sl warn 'vmware-usbarbitrator does not exist in the PATH'
      fi
    fi
  else
    gum log -sl info 'VMware host modules are present'
  fi
else
  if [ -d /Applications ] && [ -d /System ]; then
    ### macOS
    gum log -sl info 'System is macOS so there is no unlocker or modules that need to be enabled'
  else
    ### Linux and VMWare not installed
    gum log -sl warn 'VMware Workstation is not installed so the VMware Unlocker will not be installed'
  fi
fi
