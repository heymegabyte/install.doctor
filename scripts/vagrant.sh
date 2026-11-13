#!/usr/bin/env bash

# @file Vagrant Quick Start Script
# @brief Sets up Vagrant, checks for a compatible virtualization platform, and provisions a virtual machine using the Install Doctor `Vagrantfile`.
# @description
#     This script is the target of the one-liner advertised on the landing page:
#
#       bash <(curl -sSL "https://install.doctor/vagrant")
#
#     **Note**: `https://install.doctor/vagrant` redirects to this file.
#
#     It performs the following steps:
#
#     1. **OS Detection**: Detects the host operating system (macOS or Linux)
#     2. **Dependencies**: Ensures `curl`, `git`, and `gzip` are installed
#     3. **Virtualization Platform**: Detects a supported provider (KVM/libvirt,
#        VirtualBox, VMware Workstation/Fusion, or Parallels Desktop)
#     4. **Vagrant**: Installs Vagrant if it is not already present
#     5. **Repository**: Clones (or updates) the Install Doctor repository so the
#        `Vagrantfile` is available locally
#     6. **Launch**: Runs `vagrant up` with the selected provider. The `Vagrantfile`
#        provisions each node with the Install Doctor provisioning logic
#
#     ## Variables
#
#     | Variable                  | Description                                                                                  |
#     |---------------------------|----------------------------------------------------------------------------------------------|
#     | `VAGRANT_PROVIDER`        | Override the auto-detected provider (e.g. `libvirt`, `virtualbox`, `vmware_desktop`)          |
#     | `VAGRANT_NODE`            | Only bring up the named node from the `Vagrantfile` (e.g. `ukdah`)                            |
#     | `INSTALL_DOCTOR_REPO`     | Repository to clone, in `owner/name` form (defaults to `heymegabyte/install.doctor`)        |
#     | `INSTALL_DOCTOR_DIR`      | Directory the repository is cloned into (defaults to `$HOME/.install-doctor`)                 |
#     | `INSTALL_DOCTOR_BRANCH`   | Branch to check out during the clone (defaults to `master`)                                   |
#
#     Run it non-interactively by exporting `VAGRANT_PROVIDER` so the provider
#     prompt can be skipped.
#
#     ## Usage
#
#     Run the following for the interactive experience:
#
#         bash <(curl -sSL "https://install.doctor/vagrant")
#
#     Or, to select the provider up front:
#
#         VAGRANT_PROVIDER=libvirt bash <(curl -sSL "https://install.doctor/vagrant")

set -eo pipefail

INSTALL_DOCTOR_REPO="${INSTALL_DOCTOR_REPO:-heymegabyte/install.doctor}"
INSTALL_DOCTOR_DIR="${INSTALL_DOCTOR_DIR:-$HOME/.install-doctor}"
INSTALL_DOCTOR_BRANCH="${INSTALL_DOCTOR_BRANCH:-master}"
REPO_URL="https://github.com/$INSTALL_DOCTOR_REPO.git"

# @description Formats log statements with a colored label
#
# @arg $1 string The log level (`info`, `success`, `warn`, or `error`)
# @arg $2 string The message to log
function logg() {
  case "$1" in
    info) echo -e "\e[1;46m   INFO   \e[0m $2\e[0;39m" ;;
    success) echo -e "\e[1;42m SUCCESS  \e[0m $2\e[0;39m" ;;
    warn) echo -e "\e[1;43m WARNING  \e[0m $2\e[0;39m" ;;
    error) echo -e "\e[1;41m  ERROR   \e[0m $2\e[0;39m" ;;
    *) echo "$2" ;;
  esac
}

# @description Detects the host operating system
#
# @noarg
#
# @stdout The detected OS (`macos` or `linux`)
# @exitcode 0 The OS was detected
# @exitcode 1 The OS is not supported
function detectOS() {
  if [[ "$OSTYPE" == 'darwin'* ]]; then
    echo 'macos'
    return 0
  fi
  if [ -f /etc/os-release ] || [ -f /etc/debian_version ] || [ -f /etc/arch-release ] || [ -f /etc/redhat-release ] || [ -f /etc/alpine-release ]; then
    echo 'linux'
    return 0
  fi
  if [[ "$OSTYPE" == 'linux'* ]]; then
    echo 'linux'
    return 0
  fi
  return 1
}

# @description Installs a system package with the host's package manager
#
# @arg $1 string The name of the package to install
#
# @exitcode 0 The package was installed or is already present
# @exitcode 1+ The package could not be installed
function ensurePackageInstalled() {
  if type "$1" &> /dev/null; then
    return 0
  fi
  local os="$HOST_OS"
  if [[ "$os" == 'macos' ]]; then
    if ! type brew &> /dev/null; then
      logg error 'Homebrew is required to install Vagrant on macOS. Install Homebrew from https://brew.sh and re-run this script.'
      exit 1
    fi
    brew install "$1"
    return 0
  fi
  if type dnf &> /dev/null; then
    sudo dnf install -y "$1"
  elif type yum &> /dev/null; then
    sudo yum install -y "$1"
  elif type pacman &> /dev/null; then
    sudo pacman -Sy --noconfirm
    sudo pacman -S --noconfirm "$1"
  elif type apk &> /dev/null; then
    sudo apk --no-cache add "$1"
  elif type apt-get &> /dev/null; then
    sudo apt-get update
    sudo apt-get install -y "$1"
  else
    logg error "Could not install $1 because no supported package manager was found."
    exit 1
  fi
}

# @description Detects the installed virtualization platforms and returns the
#     matching Vagrant provider names
#
# @noarg
#
# @stdout A space-separated list of Vagrant provider names
function detectProviders() {
  local providers=''
  if type qemu-system-x86_64 &> /dev/null || type virsh &> /dev/null; then
    providers="$providers libvirt"
  fi
  if type VBoxManage &> /dev/null || type vboxmanage &> /dev/null; then
    providers="$providers virtualbox"
  fi
  if [[ "$HOST_OS" == 'macos' ]] && type vmrun &> /dev/null; then
    providers="$providers vmware_desktop"
  fi
  if [[ "$HOST_OS" == 'linux' ]] && type vmware &> /dev/null; then
    providers="$providers vmware_desktop"
  fi
  if [[ "$HOST_OS" == 'macos' ]] && [ -d '/Applications/Parallels Desktop.app' ]; then
    providers="$providers parallels"
  fi
  echo "${providers# }"
}

# @description Ensures Vagrant is installed, using the host's package manager
#
# @noarg
#
# @exitcode 0 Vagrant is available
# @exitcode 1 Vagrant could not be installed
function ensureVagrant() {
  if type vagrant &> /dev/null; then
    logg info "Vagrant is already installed ($(vagrant --version))"
    return 0
  fi
  logg info 'Vagrant is not installed - installing it now'
  if [[ "$HOST_OS" == 'macos' ]]; then
    ensurePackageInstalled 'hashicorp/tap/vagrant'
  elif type apt-get &> /dev/null; then
    ensurePackageInstalled 'vagrant'
  else
    ensurePackageInstalled 'vagrant'
  fi
  if ! type vagrant &> /dev/null; then
    logg error 'Vagrant could not be installed automatically. Install it from https://developer.hashicorp.com/vagrant/install and re-run this script.'
    exit 1
  fi
  logg success "Installed $(vagrant --version)"
}

# @description Clones the Install Doctor repository (or updates an existing
#     clone) so the `Vagrantfile` is available locally
#
# @noarg
#
# @set VAGRANT_DIR string The directory containing the `Vagrantfile`
#
# @exitcode 0 The repository is available
# @exitcode 1 The repository could not be cloned or updated
function ensureRepository() {
  if [ -d "$INSTALL_DOCTOR_DIR/.git" ]; then
    logg info "Updating existing clone in $INSTALL_DOCTOR_DIR"
    git -C "$INSTALL_DOCTOR_DIR" fetch origin "$INSTALL_DOCTOR_BRANCH"
    git -C "$INSTALL_DOCTOR_DIR" checkout "$INSTALL_DOCTOR_BRANCH"
    git -C "$INSTALL_DOCTOR_DIR" pull --ff-only origin "$INSTALL_DOCTOR_BRANCH"
  else
    logg info "Cloning $INSTALL_DOCTOR_REPO into $INSTALL_DOCTOR_DIR"
    git clone --branch "$INSTALL_DOCTOR_BRANCH" "$REPO_URL" "$INSTALL_DOCTOR_DIR"
  fi
  if [ ! -f "$INSTALL_DOCTOR_DIR/Vagrantfile" ]; then
    logg error "The Vagrantfile was not found in $INSTALL_DOCTOR_DIR"
    exit 1
  fi
  VAGRANT_DIR="$INSTALL_DOCTOR_DIR"
  logg success "Vagrantfile is available in $VAGRANT_DIR"
}

# @description Resolves the Vagrant provider to use, either from the
#     `VAGRANT_PROVIDER` variable or by prompting the user
#
# @noarg
#
# @set VAGRANT_PROVIDER string The selected provider
#
# @exitcode 0 A provider was selected
# @exitcode 1 No supported provider is available
function selectProvider() {
  local available
  available="$(detectProviders)"
  if [ -z "$available" ]; then
    logg error 'No supported virtualization platform was detected. Install one of the following and re-run this script: KVM/libvirt, VirtualBox, VMware Workstation/Fusion, or Parallels Desktop.'
    exit 1
  fi
  if [ -n "$VAGRANT_PROVIDER" ]; then
    if ! echo " $available " | grep -q " $VAGRANT_PROVIDER "; then
      logg error "The requested provider ($VAGRANT_PROVIDER) was not detected. Detected providers: $available"
      exit 1
    fi
    logg info "Using the requested provider: $VAGRANT_PROVIDER"
    return 0
  fi
  # shellcheck disable=SC2086
  set -- $available
  if [ "$#" = '1' ]; then
    VAGRANT_PROVIDER="$1"
    logg info "Using the only detected provider: $VAGRANT_PROVIDER"
    return 0
  fi
  logg info 'Multiple virtualization platforms were detected. Select the one to use:'
  select VAGRANT_PROVIDER in "$@"; do
    if [ -n "$VAGRANT_PROVIDER" ]; then
      break
    fi
    logg warn 'Invalid selection - choose a number from the list'
  done
  if [ -z "$VAGRANT_PROVIDER" ]; then
    logg error 'No provider was selected'
    exit 1
  fi
  logg info "Using the selected provider: $VAGRANT_PROVIDER"
}

HOST_OS="$(detectOS)" || {
  logg error "The host operating system ($OSTYPE) is not supported by this script."
  exit 1
}
logg info "Detected host operating system: $HOST_OS"

logg info 'Ensuring curl, git, and gzip are installed'
ensurePackageInstalled 'curl'
ensurePackageInstalled 'git'
ensurePackageInstalled 'gzip'

VAGRANT_PROVIDER="${VAGRANT_PROVIDER:-}"
selectProvider
ensureVagrant
ensureRepository

cd "$VAGRANT_DIR"

logg info "Starting the virtual machine with the $VAGRANT_PROVIDER provider"
if [ -n "$VAGRANT_NODE" ]; then
  logg info "Only bringing up the $VAGRANT_NODE node"
  vagrant up "$VAGRANT_NODE" --provider="$VAGRANT_PROVIDER"
else
  vagrant up --provider="$VAGRANT_PROVIDER"
fi

logg success 'The virtual machine is ready. Run "vagrant ssh <node>" to connect, and "vagrant destroy" to remove it.'
