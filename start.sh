#!/usr/bin/env bash

# @file start.sh
# @brief Local bootstrap that installs the repository-pinned Task runner, then runs `task provision`.
# @description
#   This local launcher validates its tiny prerequisite set, installs the exact
#   repository-pinned Task runner, and delegates to the canonical signed
#   app.install.doctor release endpoint through `task provision`.
#   It performs the following steps:
#
#   1. **Environment Setup**: Configures PATH and preserves the SSH trust store
#   2. **Prerequisite Validation**: Requires curl, gzip, and tar without mutating package indexes
#   3. **Task Installation**: Verifies and installs the pinned [Task](https://github.com/go-task/task) runner
#   4. **Execution**: Enters the signed release workflow through `task provision`
#
#   ## Non-Interactive Mode
#
#   Package acquisition is deferred to signed desired state. Headless runs must
#   provide every required consent explicitly through the documented environment.
#
#   Documentation on Taskfile.yml syntax can be found [here](https://taskfile.dev/).
git config url."https://gitlab.com/".insteadOf git@gitlab.com:
git config url."https://github.com/".insteadOf git@github.com:
set -eo pipefail

# @description Detect the base operating system (embedded copy — start.sh runs
# before the repo is cloned, so it can't source scripts/lib/detect_os.sh).
# Returns: macos|ubuntu|debian|fedora|alpine|arch|wsl|container|linux|unknown
detect_os() {
  if [ -f /proc/sys/fs/binfmt_misc/WSLInterop ] || grep -qi microsoft /proc/version 2>/dev/null; then echo "wsl"; return 0; fi
  if [ -f /.dockerenv ] || grep -qE 'docker|lxc|containerd' /proc/1/cgroup 2>/dev/null; then echo "container"; return 0; fi
  if [[ "$OSTYPE" == 'darwin'* ]]; then echo "macos"; return 0; fi
  if [ -f /etc/os-release ]; then
    local id; id="$(. /etc/os-release && echo "${ID:-unknown}")"
    case "$id" in
      ubuntu) echo "ubuntu"; return 0 ;;
      debian) echo "debian"; return 0 ;;
      fedora|rhel|centos|rocky|almalinux|ol) echo "fedora"; return 0 ;;
      arch|archlinux|manjaro) echo "arch"; return 0 ;;
      alpine) echo "alpine"; return 0 ;;
      opensuse*|sles) echo "fedora"; return 0 ;;
    esac
  fi
  [ -f /etc/redhat-release ] && { echo "fedora"; return 0; }
  [ -f /etc/debian_version ] && { echo "debian"; return 0; }
  [ -f /etc/arch-release ] && { echo "arch"; return 0; }
  [ -f /etc/alpine-release ] && { echo "alpine"; return 0; }
  [[ "$OSTYPE" == 'linux'* ]] && { echo "linux"; return 0; }
  echo "unknown"
}

# @description Initialize variables
export HOMEBREW_NO_INSTALL_CLEANUP=true
export HOMEBREW_NO_ANALYTICS=1

# @description Ensure permissions in CI environments
if [ -n "$CI" ]; then
  if type sudo &> /dev/null; then
    sudo chown -R "$(whoami):$(whoami)" .
  fi
fi

# @description Ensure .config/log is present
if [ ! -f .config/log ]; then
  printf 'Missing trusted .config/log; run start.sh from a complete install.doctor checkout.\n' >&2
  exit 1
fi

# @description Ensure .config/log is executable
chmod +x .config/log

# @description Acquire unique ID for this script
if [ -z "$CI" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    FILE_HASH="$(sha256sum "$0" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    FILE_HASH="$(shasum -a 256 "$0" | awk '{print $1}')"
  elif command -v openssl >/dev/null 2>&1; then
    FILE_HASH="$(openssl dgst -sha256 "$0" | awk '{print $NF}')"
  else
    FILE_HASH="$(cksum "$0" | awk '{print $1 "-" $2}')"
  fi
else
  FILE_HASH="none"
fi

# @description Caches values from commands
function cache() {
  local DIR="${CACHE_DIR:-.cache}"
  if ! test -d "$DIR"; then
    mkdir -p "$DIR"
  fi
  local FN="$DIR/${LINENO}-${FILE_HASH}"
  if ! test -f "$FN" ; then
    "$@" > "$FN"
  fi
  cat "$FN"
}

# @description Formats log statements
function format() {
  # shellcheck disable=SC2001,SC2016
  ANSI_STR="$(echo "$1" | sed 's/^\([^`]*\)`\([^`]*\)`/\1\\e[100;1m \2 \\e[0;39m/')"
  if [[ $ANSI_STR == *'`'*'`'* ]]; then
    ANSI_STR="$(format "$ANSI_STR")"
  fi
  echo -e "$ANSI_STR"
}

# @description Proxy function for handling logs in this script
function logger() {
  if [ -f .config/log ]; then
    .config/log "$1" "$2"
  else
    if [ "$1" == 'error' ]; then
      echo -e "\e[1;41m  ERROR   \e[0m $(format "$2")\e[0;39m"
    elif [ "$1" == 'info' ]; then
      echo -e "\e[1;46m   INFO   \e[0m $(format "$2")\e[0;39m"
    elif [ "$1" == 'success' ]; then
      echo -e "\e[1;42m SUCCESS  \e[0m $(format "$2")\e[0;39m"
    elif [ "$1" == 'warn' ]; then
      echo -e "\e[1;43m WARNING  \e[0m $(format "$2")\e[0;39m"
    else
      echo "$2"
    fi
  fi
}

# Homebrew refuses root and an automatically-created blanket-sudo account is
# not an acceptable workaround. The served provisioner has an explicit,
# audited root-to-user handoff for fleet images.
if [ -z "$NO_INSTALL_HOMEBREW" ] && [ "$(id -u)" -eq 0 ] && [ -z "$INIT_CWD" ]; then
  logger error 'Run start.sh as the intended non-root user; refusing to create a passwordless sudo account.'
  exit 1
fi

# @description Ensures ~/.local/bin is in the PATH variable on *nix machines and
# exits with an error on unsupported OS types
#
# @set PATH string The updated PATH with a reference to ~/.local/bin
#
# @noarg
#
# @exitcode 0 If the PATH was appropriately updated or did not need updating
# @exitcode 1+ If the OS is unsupported
function ensureLocalPath() {
  local os; os="$(detect_os)"
  if [ "$os" = "macos" ] || [ "$os" != "unknown" ]; then
    # shellcheck disable=SC2016
    PATH_STRING='export PATH="$HOME/.local/bin:$PATH"'
    mkdir -p "$HOME/.local/bin"
    if ! grep "$PATH_STRING" < "$HOME/.profile" > /dev/null; then
      echo -e "${PATH_STRING}\n" >> "$HOME/.profile"
      logger info "Updated the PATH variable to include ~/.local/bin in $HOME/.profile"
    fi
  fi
}

# @description Ensures the immutable repository-approved Task version is installed
# under the current user's private executable prefix.
#
# @noarg
#
# @exitcode 0 If the package is already present and up-to-date or if it was installed/updated
# @exitcode 1+ If the OS is unsupported or if there was an error either installing the package or setting the PATH
function ensureTaskInstalled() {
  local target="$HOME/.local/bin/task" platform arch asset expected_binary
  platform="$(task_bootstrap_platform "$(detect_os)")" || return
  arch="$(task_bootstrap_arch "$(uname -m 2>/dev/null)")" || return
  asset="task_${platform}_${arch}.tar.gz"
  expected_binary="$(task_bootstrap_binary_sha256 "$asset")" || return
  if task_bootstrap_is_expected_binary "$target" "$expected_binary"; then
    logger info "Task $INSTALL_DOCTOR_TASK_VERSION is already installed"
    return 0
  fi
  for candidate in "$(command -v task 2>/dev/null || true)" "$(command -v go-task 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && task_bootstrap_is_expected_binary "$candidate" "$expected_binary"; then
      mkdir -p "$(dirname "$target")"
      cp -f "$candidate" "$target"
      chmod 0755 "$target"
      logger info "Linked verified system Task $INSTALL_DOCTOR_TASK_VERSION ($candidate) to $target"
      return 0
    fi
  done
  logger info "Installing immutable Task $INSTALL_DOCTOR_TASK_VERSION"
  install_pinned_task "$(detect_os)" "$(uname -m 2>/dev/null)" "$target"
  logger success "Installed Task $INSTALL_DOCTOR_TASK_VERSION to $target"
}

# The local bootstrap runs from a complete checkout, so keep its independently
# testable release verifier in the repository instead of duplicating it inline.
START_SH_ROOT="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly START_SH_ROOT
# shellcheck source=scripts/lib/task-bootstrap.sh
. "$START_SH_ROOT/scripts/lib/task-bootstrap.sh"

##### Main Logic #####

if [ ! -f "$HOME/.profile" ]; then
  touch "$HOME/.profile"
fi

# @description Preserve the operator-verified SSH trust store. Never convert
# an unauthenticated network scan into a trusted host key.
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/known_hosts
chmod 600 ~/.ssh/known_hosts

# @description Ensures ~/.local/bin is in PATH
ensureLocalPath

# @description Validates the tiny local-launcher prerequisite set. Package
# acquisition belongs to signed stage zero or selected desired state; this
# checkout launcher must not mutate current package indexes before planning.
for START_REQUIRED_COMMAND in curl gzip tar; do
  if ! command -v "$START_REQUIRED_COMMAND" >/dev/null 2>&1; then
    logger error "Missing bootstrap prerequisite: $START_REQUIRED_COMMAND. Install it with the operating system's trusted package workflow, then rerun."
    exit 69
  fi
done
unset START_REQUIRED_COMMAND

# Source updates are an explicit, provenance-checked operator action. The local
# launcher executes the checkout exactly as supplied and never rewrites remotes,
# fetches branches, prints CI secrets, or mutates adjacent repositories.

# @description Ensures Task is installed and properly configured
ensureTaskInstalled

# @description Run the start logic, if appropriate
if [ -z "$CI" ] && [ -z "$START" ] && [ -z "$INIT_CWD" ]; then
  logger info "Sourcing profile located in $HOME/.profile"
  # shellcheck disable=SC1091
  . "$HOME/.profile" &> /dev/null || true
  # Dispatch `task provision` through the exact verified binary, never an ambient executable.
  "$HOME/.local/bin/task" provision
fi
