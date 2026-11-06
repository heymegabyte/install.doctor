#!/bin/bash
# @file test-linux.sh
# @brief Script to run a Linux VM in a CI/CD environment and execute commands inside it.
# @description
#     This script sets up and runs a virtual machine using QEMU/KVM.
#     It supports multiple Linux distributions, configures a cloud-init ISO,
#     launches the VM, and executes a specified command inside the VM.
#
#     Supported distributions: ubuntu, arch, fedora, centos, debian, alpine, opensuse
#
#     Features:
#      * Downloads the correct cloud image for each distribution
#      * Configures cloud-init for passwordless sudo and SSH access
#      * Snapshot mode to preserve base image integrity
#      * Automatic SSH key detection and generation
#      * Configurable memory, CPU count, and SSH port via environment variables
#
# @usage
#   ./test-linux.sh <distro> "your-command-here"
#
# @envvar MEMORY  VM memory in MB (default: 2048)
# @envvar CPUS  Number of VM CPUs (default: 2)
# @envvar SSH_PORT  Host port for SSH forwarding (default: 2222)
# @envvar CI  Set in CI environments for non-interactive behavior
# @envvar TEST_INSTALL  Alternative to CI for triggering headless mode
# @envvar INSTALLER_PATH  Optional checked-out installer copied into the VM before execution
#
# @exitcode 0 If successful.
# @exitcode 1 If an error occurs.

set -e

# Redirect output to log files
LOG_FILE="run-vm.log"
exec > >(tee -i "$LOG_FILE") 2>&1

# ==============================================================================
# GLOBAL VARIABLES
# ==============================================================================

DISTRO="${1:-ubuntu}"
IMAGE="${DISTRO}-server.img"
CLOUD_INIT_ISO="cloud-init.iso"
VM_NAME="${DISTRO}-vm"
MEMORY="${MEMORY:-2048}"
CPUS="${CPUS:-2}"
SSH_PORT="${SSH_PORT:-2222}"
SSH_USER="ci-user"

# ==============================================================================
# @description Detect an existing SSH key or create a new one if missing.
# ==============================================================================
detectSshKey() {
  SSH_KEY="$(find "$HOME/.ssh" -name "*.pub" 2>/dev/null | head -n 1)"
  if [ -z "$SSH_KEY" ]; then
    echo "No SSH key found. Generating one..."
    mkdir -p "$HOME/.ssh"
    ssh-keygen -t rsa -b 4096 -f "$HOME/.ssh/id_rsa" -N "" >/dev/null 2>&1
    SSH_KEY="$HOME/.ssh/id_rsa.pub"
    if [ ! -f "$SSH_KEY" ]; then
      echo "Error: Failed to generate SSH key."
      exit 1
    fi
  fi
  echo "Using SSH key: $SSH_KEY"
}

# ==============================================================================
# @description Download the selected Linux cloud image if not already available.
#     Each distribution has its own cloud image URL for proper testing.
# ==============================================================================
downloadImage() {
  if [ -f "$IMAGE" ]; then
    echo "Cloud image already exists: $IMAGE"
    return 0
  fi

  local IMAGE_URL
  case "$DISTRO" in
    ubuntu)
      IMAGE_URL="https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img"
      ;;
    debian)
      IMAGE_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2"
      ;;
    fedora)
      IMAGE_URL="https://download.fedoraproject.org/pub/fedora/linux/releases/39/Cloud/x86_64/images/Fedora-Cloud-Base-39-1.5.x86_64.qcow2"
      ;;
    centos)
      IMAGE_URL="https://cloud.centos.org/centos/9-stream/x86_64/images/CentOS-Stream-GenericCloud-9-latest.x86_64.qcow2"
      ;;
    arch)
      IMAGE_URL="https://geo.mirror.pkgbuild.com/images/latest/Arch-Linux-x86_64-cloudimg.qcow2"
      ;;
    alpine)
      IMAGE_URL="https://dl-cdn.alpinelinux.org/alpine/v3.19/releases/cloud/nocloud_alpine-3.19.1-x86_64-bios-cloudinit-r0.qcow2"
      ;;
    opensuse)
      IMAGE_URL="https://download.opensuse.org/distribution/leap/15.5/appliances/openSUSE-Leap-15.5-Minimal-VM.x86_64-Cloud.qcow2"
      ;;
    *)
      echo "Error: Unsupported distribution '$DISTRO'"
      echo "Supported: ubuntu, debian, fedora, centos, arch, alpine, opensuse"
      exit 1
      ;;
  esac

  echo "Downloading $DISTRO cloud image from $IMAGE_URL..."
  wget -q --show-progress -O "$IMAGE" "$IMAGE_URL"
}

# ==============================================================================
# @description Resize the cloud image to allow sufficient disk space.
# ==============================================================================
resizeImage() {
  echo "Resizing cloud image for efficiency..."
  qemu-img resize "$IMAGE" +10G
}

# ==============================================================================
# @description Generate cloud-init configuration files for VM initialization.
#     Creates a user with passwordless sudo and SSH key access.
# ==============================================================================
createCloudInitConfig() {
  echo "Creating cloud-init configuration..."
  mkdir -p cloud-init

  cat > cloud-init/user-data <<EOF
#cloud-config
users:
  - name: $SSH_USER
    sudo: ['ALL=(ALL) NOPASSWD:ALL']
    groups: sudo
    shell: /bin/bash
    ssh_authorized_keys:
      - $(cat "$SSH_KEY")

runcmd:
  - echo "Cloud-init setup complete"
EOF

  cat > cloud-init/meta-data <<EOF
instance-id: ${DISTRO}-ci
local-hostname: ${DISTRO}-ci
EOF

  genisoimage -output "$CLOUD_INIT_ISO" -volid cidata -joliet -rock cloud-init/user-data cloud-init/meta-data
}

# ==============================================================================
# @description Start the Linux VM using QEMU with snapshot mode.
# ==============================================================================
startQemuVm() {
  echo "Starting $DISTRO VM (memory: ${MEMORY}MB, cpus: ${CPUS})..."
  qemu-system-x86_64 \
      -m "$MEMORY" \
      -smp "$CPUS" \
      -enable-kvm \
      -drive file="$IMAGE",format=qcow2,if=virtio,snapshot=on \
      -cdrom "$CLOUD_INIT_ISO" \
      -netdev user,id=user.0,hostfwd=tcp::"$SSH_PORT"-:22 \
      -device virtio-net,netdev=user.0 \
      -nographic &
}

# ==============================================================================
# @description Wait for SSH to become available inside the VM.
#     Times out after 120 seconds to prevent hanging in CI.
# ==============================================================================
waitForSsh() {
  echo "Waiting for SSH connection on port $SSH_PORT..."
  local SECONDS_WAITED=0
  local MAX_WAIT=120
  while ! nc -z localhost "$SSH_PORT" 2>/dev/null; do
    if [ "$SECONDS_WAITED" -ge "$MAX_WAIT" ]; then
      echo "Error: SSH did not become available within $MAX_WAIT seconds."
      exit 1
    fi
    sleep 2
    SECONDS_WAITED=$((SECONDS_WAITED + 2))
  done
  # Give sshd a moment to fully initialize after port is open
  sleep 3
  echo "SSH is available!"
}

# ==============================================================================
# @description Run a command inside the VM via SSH.
#     Sets CI and HEADLESS_INSTALL environment variables automatically.
#     Uses StrictHostKeyChecking=no since VM keys are ephemeral in CI.
#
# @arg $1 string The command to execute inside the VM.
# ==============================================================================
runCommandInVm() {
  local COMMAND="$1"
  echo "Running command inside VM: $COMMAND"
  ssh -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=10 \
      -p "$SSH_PORT" \
      "$SSH_USER"@localhost \
      "export CI=true; export TEST_INSTALL=true; export HEADLESS_INSTALL=true; $COMMAND"
}

# Copy the checked-out installer into the disposable VM so CI validates the revision under test rather than
# mutable production. Production URL availability is a separate smoke-test responsibility.
copyInstallerToVm() {
  [ -n "${INSTALLER_PATH:-}" ] || return 0
  [ -f "$INSTALLER_PATH" ] || { echo "Error: INSTALLER_PATH does not exist: $INSTALLER_PATH"; return 1; }
  scp -q -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ConnectTimeout=10 \
      -P "$SSH_PORT" \
      "$INSTALLER_PATH" "$SSH_USER"@localhost:/tmp/install-doctor-provision.sh
}

# ==============================================================================
# @description Stop the QEMU VM process gracefully.
# ==============================================================================
stopVm() {
  echo "Stopping VM..."
  pkill qemu-system-x86_64 || echo "Warning: VM process may not have been running."
}

# ==============================================================================
# Main Execution
# ==============================================================================
main() {
  if [ -z "$2" ]; then
    echo "Usage: $0 <distro> \"your-command-here\""
    echo "Supported distros: ubuntu, debian, fedora, centos, arch, alpine, opensuse"
    exit 1
  fi

  trap stopVm EXIT

  detectSshKey
  downloadImage
  resizeImage
  createCloudInitConfig
  startQemuVm
  waitForSsh
  copyInstallerToVm
  runCommandInVm "$2"
}

main "$@"
