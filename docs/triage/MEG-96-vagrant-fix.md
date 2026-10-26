# MEG-96 — Vagrant setup link dead: ready-to-push patch

Branch: `MEG-96-vagrant-setup-link-dead` — commit `aea6ef9f` (unpushed: GitHub and Paperclip credentials unavailable in this run)

## Root cause

- `https://install.doctor/vagrant` 301'd to `https://raw.githubusercontent.com/megabyte-labs/install.doctor/master/scripts/vagrant.sh`, which returns 404 (reproduced). The repo moved to `heymegabyte/install.doctor`, so the redirect target org is also retired.
- The landing page Windows tab links to `https://install.doctor/windows-vagrant`, but `site/firebase.json` only defined `/vagrant-windows`, so that URL never matched a redirect.
- `scripts/vagrant.sh` was never present in this repository's history.

## Fix

1. Add `scripts/vagrant.sh` — detects OS and virtualization platform, installs Vagrant if missing, clones the repo for the root `Vagrantfile`, runs `vagrant up`. Env overrides: `VAGRANT_PROVIDER`, `VAGRANT_NODE`, `INSTALL_DOCTOR_REPO`, `INSTALL_DOCTOR_DIR`, `INSTALL_DOCTOR_BRANCH`.
2. `site/firebase.json` — retarget `/vagrant` to `heymegabyte/install.doctor/scripts/vagrant.sh`; rename `/vagrant-windows` to `/windows-vagrant` (the URL the site actually advertises) and point it at the new org.
3. `docs/advanced/virtualization.md` — document the one-liner and its variables.
4. `.github/workflows/test-linux.yml` — include `scripts/vagrant.sh` in the blocking ShellCheck step.

## Verification

- `bash -n scripts/vagrant.sh` and `shellcheck -x scripts/vagrant.sh` — clean.
- `python3 -m json.tool site/firebase.json` — valid.
- Stubbed runs confirmed: automatic single-provider selection, interactive multi-provider prompt, rejection of an undetected explicit provider, and `VAGRANT_NODE` passthrough to `vagrant up <node>`.
- Upstream 404 reproduced; the corrected raw URL returns 200 for the sibling `provision.sh` pattern and the branch file will resolve once merged.

## Remaining before closure

1. Push branch `MEG-96-vagrant-setup-link-dead` and open a PR (blocked on GitHub write access, tracked in MEG-222).
2. After merge, confirm `curl -sSI https://install.doctor/vagrant` no longer 404s (site deploy needed for the redirect change).
3. Reply to @hacfi on https://github.com/heymegabyte/install.doctor/issues/171 with the outcome.

## Diff

```diff
diff --git a/.github/workflows/test-linux.yml b/.github/workflows/test-linux.yml
index e665b7e1..b16ef4fb 100644
--- a/.github/workflows/test-linux.yml
+++ b/.github/workflows/test-linux.yml
@@ -32,7 +32,7 @@ jobs:
 
       - name: Lint core scripts (blocking)
         run: |
-          shellcheck -x scripts/provision.sh start.sh || {
+          shellcheck -x scripts/provision.sh scripts/vagrant.sh start.sh || {
             echo "::error::ShellCheck failed on core scripts — fix before merge"
             exit 1
           }
diff --git a/docs/advanced/virtualization.md b/docs/advanced/virtualization.md
index cb9f66e3..f5f213a0 100644
--- a/docs/advanced/virtualization.md
+++ b/docs/advanced/virtualization.md
@@ -40,6 +40,33 @@ After Docker is installed, the provisioning scripts:
 
 Vagrant enables reproducible development environments defined as code in `Vagrantfile` configurations.
 
+### Quick Start in a Virtual Machine
+
+The landing page advertises a one-liner that provisions Install Doctor inside a virtual machine. The one-liner points at `scripts/vagrant.sh` in this repository (served through the `https://install.doctor/vagrant` redirect):
+
+```shell
+bash <(curl -sSL "https://install.doctor/vagrant")
+```
+
+The script detects the host OS, ensures `curl`, `git`, and `gzip` are present, detects a supported virtualization platform (KVM/libvirt, VirtualBox, VMware Workstation/Fusion, or Parallels Desktop), installs Vagrant when it is missing, clones this repository so the `Vagrantfile` is available, and then runs `vagrant up` with the selected provider.
+
+Set the following environment variables to run it non-interactively:
+
+| Variable                | Description                                                                       |
+|-------------------------|-----------------------------------------------------------------------------------|
+| `VAGRANT_PROVIDER`      | Skip the provider prompt by naming the provider (e.g. `libvirt` or `virtualbox`)  |
+| `VAGRANT_NODE`          | Only bring up the named node from the `Vagrantfile` (e.g. `ukdah`)                |
+| `INSTALL_DOCTOR_REPO`   | Clone a fork instead of `megabyte-labs/install.doctor` (in `owner/name` form)     |
+| `INSTALL_DOCTOR_DIR`    | Directory the repository is cloned into (defaults to `$HOME/.install-doctor`)     |
+
+For example:
+
+```shell
+VAGRANT_PROVIDER=libvirt bash <(curl -sSL "https://install.doctor/vagrant")
+```
+
+Use `vagrant ssh <node>` to connect to a provisioned node and `vagrant destroy` to remove it. The Windows PowerShell variant is available at `https://install.doctor/windows-vagrant`.
+
 ## VirtualBox
 
 [VirtualBox](https://www.virtualbox.org/) is installed as a cross-platform hypervisor:
diff --git a/site/firebase.json b/site/firebase.json
index 9569c406..e8c3f3aa 100644
--- a/site/firebase.json
+++ b/site/firebase.json
@@ -96,12 +96,12 @@
       },
       {
         "source": "/vagrant",
-        "destination": "https://raw.githubusercontent.com/megabyte-labs/install.doctor/master/scripts/vagrant.sh",
+        "destination": "https://raw.githubusercontent.com/heymegabyte/install.doctor/master/scripts/vagrant.sh",
         "type": 301
       },
       {
-        "source": "/vagrant-windows",
-        "destination": "https://raw.githubusercontent.com/megabyte-labs/install.doctor/master/scripts/vagrant.ps1",
+        "source": "/windows-vagrant",
+        "destination": "https://raw.githubusercontent.com/heymegabyte/install.doctor/master/scripts/vagrant.ps1",
         "type": 301
       },
       {
```

## New file: scripts/vagrant.sh

```bash
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
#     | `INSTALL_DOCTOR_REPO`     | Repository to clone, in `owner/name` form (defaults to `megabyte-labs/install.doctor`)        |
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

INSTALL_DOCTOR_REPO="${INSTALL_DOCTOR_REPO:-megabyte-labs/install.doctor}"
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

logg info "Starting the virtual machine with the $VAGRANT_PROVIDER provider"
if [ -n "$VAGRANT_NODE" ]; then
  logg info "Only bringing up the $VAGRANT_NODE node"
  vagrant up "$VAGRANT_NODE" --provider="$VAGRANT_PROVIDER"
else
  vagrant up --provider="$VAGRANT_PROVIDER"
fi

logg success 'The virtual machine is ready. Run "vagrant ssh <node>" to connect, and "vagrant destroy" to remove it.'
```
