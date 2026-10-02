#!/usr/bin/env bash
# @file Homebrew Install
# @brief Installs Homebrew on macOS and / or Linux.
# @description
#     This script installs Homebrew on macOS and/or Linux machines. The script:
#
#     1. Ensures Homebrew is not already installed
#     2. Installs Homebrew headlessly if sudo privileges are already given
#     3. Prompts for the sudo password, if required
#     4. Performs some clean up and update tasks when the Homebrew installation reports an error
#
#     **Note**: `https://install.doctor/brew` points to this file.

# @description This function logs with style using Gum if it is installed, otherwise it uses `echo`. It is also capable of leveraging Glow to render markdown.
#     When Glow is not installed, it uses `cat`. The following sub-commands are available:
#
#     | Sub-Command | Description                                                                                         |
#     |-------------|-----------------------------------------------------------------------------------------------------|
#     | `error`     | Logs a bright red error message                                                                     |
#     | `info`      | Logs a regular informational message                                                                |
#     | `md`        | Tries to render the specified file using `glow` if it is installed and uses `cat` as a fallback     |
#     | `prompt`    | Alternative that logs a message intended to describe an upcoming user input prompt                  |
#     | `star`      | Alternative that logs a message that starts with a star icon                                        |
#     | `start`     | Same as `success`                                                                                   |
#     | `success`   | Logs a success message that starts with green checkmark                                             |
#     | `warn`      | Logs a bright yellow warning message                                                                |
logg() {
  TYPE="$1"
  MSG="$2"
  if [ "$TYPE" == 'error' ]; then
    if command -v gum > /dev/null; then
        gum style --border="thick" "$(gum style --foreground="#ff0000" "✖") $(gum style --bold --background="#ff0000" --foreground="#ffffff"  " ERROR ") $(gum style --bold "$MSG")"
    else
        echo "ERROR: $MSG"
    fi
  elif [ "$TYPE" == 'info' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ffff" "○") $(gum style --faint "$MSG")"
    else
        echo "INFO: $MSG"
    fi
  elif [ "$TYPE" == 'md' ]; then
    if command -v glow > /dev/null; then
        glow "$MSG"
    else
        cat "$MSG"
    fi
  elif [ "$TYPE" == 'prompt' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00008b" "▶") $(gum style --bold "$MSG")"
    else
        echo "PROMPT: $MSG"
    fi
  elif [ "$TYPE" == 'star' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#d1d100" "◆") $(gum style --bold "$MSG")"
    else
        echo "STAR: $MSG"
    fi
  elif [ "$TYPE" == 'start' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ff00" "▶") $(gum style --bold "$MSG")"
    else
        echo "START: $MSG"
    fi
  elif [ "$TYPE" == 'success' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ff00" "✔") $(gum style --bold "$MSG")"
    else
        echo "SUCCESS: $MSG"
    fi
  elif [ "$TYPE" == 'warn' ]; then
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#d1d100" "◆") $(gum style --bold --background="#ffff00" --foreground="#000000"  " WARNING ") $(gum style --bold "$MSG")"
    else
        echo "WARNING: $MSG"
    fi
  else
    if command -v gum > /dev/null; then
        gum style " $(gum style --foreground="#00ff00" "▶") $(gum style --bold "$TYPE")"
    else
        echo "$MSG"
    fi
  fi
}

# @description This function ensures dependencies like `git` and `curl` are installed. More specifically, this function will:
#
#     1. Check if `curl`, `git`, `expect`, `rsync`, and `unbuffer` are on the system
#     2. If any of the above are missing, it will then use the appropriate system package manager to satisfy the requirements. *Note that some of the requirements are not scanned for in order to keep it simple and fast.*
#     3. On macOS, the official Xcode Command Line Tools are installed.
ensureBasicDeps() {
  if ! command -v curl > /dev/null || ! command -v git > /dev/null || ! command -v expect > /dev/null || ! command -v rsync > /dev/null || ! command -v unbuffer > /dev/null; then
    if command -v apt-get > /dev/null; then
      ### Debian / Ubuntu
      logg info 'Running sudo apt-get update' && sudo apt-get update
      logg info 'Running sudo apt-get install -y build-essential curl expect git moreutils rsync procps file' && sudo apt-get install -y build-essential curl expect git moreutils rsync procps file
    elif command -v dnf > /dev/null; then
      ### Fedora
      logg info 'Running sudo dnf groupinstall -y "Development Tools"' && sudo dnf groupinstall -y 'Development Tools'
      logg info 'Running sudo dnf install -y curl expect git moreutils rsync procps-ng file' && sudo dnf install -y curl expect git moreutils rsync procps-ng file
    elif command -v yum > /dev/null; then
      ### CentOS
      logg info 'Running sudo yum groupinstall -y "Development Tools"' && sudo yum groupinstall -y 'Development Tools'
      logg info 'Running sudo yum install -y curl expect git moreutils rsync procps-ng file' && sudo yum install -y curl expect git moreutils rsync procps-ng file
    elif command -v pacman > /dev/null; then
      ### Archlinux
      logg info 'Running sudo pacman -Sy --noconfirm' && sudo pacman -Sy --noconfirm
      logg info 'Running sudo pacman -Syu --noconfirm base-devel curl expect git moreutils rsync procps-ng file' && sudo pacman -Syu --noconfirm base-devel curl expect git moreutils rsync procps-ng file
    elif command -v zypper > /dev/null; then
      ### OpenSUSE
      logg info 'Running sudo zypper install -yt pattern devel_basis' && sudo zypper install -yt pattern devel_basis
      logg info 'Running sudo zypper install -y curl expect git moreutils rsync procps file' && sudo zypper install -y curl expect git moreutils rsync procps file
    elif command -v apk > /dev/null; then
      ### Alpine
      logg info 'Running sudo apk add build-base curl expect git moreutils rsync ruby procps file' && sudo apk add build-base curl expect git moreutils rsync ruby procps file
    elif [ -d /Applications ] && [ -d /Library ]; then
      ### macOS
      logg info "Ensuring Xcode Command Line Tools are installed.."
      if ! xcode-select -p >/dev/null 2>&1; then
        logg info "Command Line Tools for Xcode not found"
        ### This temporary file prompts the 'softwareupdate' utility to list the Command Line Tools
        touch /tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress;
        XCODE_PKG="$(softwareupdate -l | grep "\*.*Command Line" | tail -n 1 | sed 's/^[^C]* //')"
        logg info "Installing from softwareupdate" && softwareupdate -i "$XCODE_PKG" && logg info "Successfully installed $XCODE_PKG"
        if command -v xcodebuild > /dev/null; then
          logg info 'Running xcodebuild -license accept'
          sudo xcodebuild -license accept
          logg info 'Running sudo xcodebuild -runFirstLaunch'
          sudo xcodebuild -runFirstLaunch
        else
          logg warn 'xcodebuild is not available'
        fi
      fi
      if /usr/bin/pgrep -q oahd; then
        logg info 'Rosetta 2 is already installed'
      else
        logg info 'Ensuring Rosetta 2 is installed' && softwareupdate --install-rosetta --agree-to-license
      fi
    elif [[ "$OSTYPE" == 'cygwin' ]] || [[ "$OSTYPE" == 'msys' ]] || [[ "$OSTYPE" == 'win32' ]]; then
      ### Windows
      logg info 'Running choco install -y curl expect git moreutils rsync' && choco install -y curl expect git moreutils rsync
    elif [[ "$OSTYPE" == 'freebsd'* ]]; then
      ### FreeBSD
      logg warn "TODO - Add support for FreeBSD"
    elif command -v pkg > /dev/null; then
      ### Termux
      logg warn "TODO - Add support for Termux"
    elif command -v xbps-install > /dev/null; then
      ### Void
      logg warn "TODO - Add support for Void"
    fi
  fi
}
ensureBasicDeps

### Ensure Homebrew is loaded
loadHomebrew() {
  if ! command -v brew > /dev/null; then
    if [ -f /usr/local/bin/brew ]; then
      logg info "Using /usr/local/bin/brew" && eval "$(/usr/local/bin/brew shellenv)"
    elif [ -f "${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew" ]; then
      logg info "Using ${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew" && eval "$("${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew" shellenv)"
    elif [ -d "$HOME/.linuxbrew" ]; then
      logg info "Using $HOME/.linuxbrew/bin/brew" && eval "$("$HOME/.linuxbrew/bin/brew" shellenv)"
    elif [ -d "/home/linuxbrew/.linuxbrew" ]; then
      logg info 'Using /home/linuxbrew/.linuxbrew/bin/brew' && eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
    else
      logg info 'Could not find Homebrew installation'
    fi
  fi
}

### Ensures Homebrew folders have proper owners / permissions
fixHomebrewPermissions() {
  if command -v brew > /dev/null; then
    logg info 'Applying proper permissions on Homebrew folders'
    sudo chmod -R go-w "$(brew --prefix)/share"
    BREW_DIRS="share etc/bash_completion.d"
    for BREW_DIR in $BREW_DIRS; do
      if [ -d "$(brew --prefix)/$BREW_DIR" ]; then
        sudo chown -Rf "$(whoami)" "$(brew --prefix)/$BREW_DIR"
      fi
    done
    logg info 'Running brew update --force --quiet' && brew update --force --quiet
  fi
}

# @description This function removes group write permissions from the Homebrew share folder which
#     is required for the ZSH configuration.
fixHomebrewSharePermissions() {
  if [ -f /usr/local/bin/brew ]; then
    sudo chmod -R g-w /usr/local/share
  elif [ -f "${HOMEBREW_PREFIX:-/opt/homebrew}/bin/brew" ]; then
    sudo chmod -R g-w "${HOMEBREW_PREFIX:-/opt/homebrew}/share"
  elif [ -d "$HOME/.linuxbrew" ]; then
    sudo chmod -R g-w "$HOME/.linuxbrew/share"
  elif [ -d "/home/linuxbrew/.linuxbrew" ]; then
    sudo chmod -R g-w /home/linuxbrew/.linuxbrew/share
  fi
}

### Installs Homebrew
ensurePackageManagerHomebrew() {
  if ! command -v brew > /dev/null; then
    ### Select install type based off of whether or not sudo privileges are available
    if command -v sudo > /dev/null && sudo -n true; then
      logg info 'Installing Homebrew. Sudo privileges available.'
      echo | bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || BREW_EXIT_CODE="$?"
      fixHomebrewSharePermissions
    else
      logg info 'Installing Homebrew. Sudo privileges not available. Password may be required.'
      bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || BREW_EXIT_CODE="$?"
      fixHomebrewSharePermissions
    fi

    ### Attempt to fix problematic installs
    if [ -n "$BREW_EXIT_CODE" ]; then
        logg warn 'Homebrew was installed but part of the installation failed to complete successfully.'
        fixHomebrewPermissions
      fi

    ### Ensure /opt/homebrew is owned by the active user when present
    # Some macOS install flows create /opt/homebrew with root ownership which can
    # cause permission issues for the intended user. Run the chown only when the
    # directory exists.
    if [ -d "/opt/homebrew" ]; then
      logg info "Setting owner of /opt/homebrew to '$USER'" && sudo chown -R "$USER" /opt/homebrew || logg warn "Failed to chown /opt/homebrew to '$USER'"
    fi
  fi
}

### Ensures gcc is installed
ensureGcc() {
  # Eval homebrew before checking if gcc is installed
  loadHomebrew
  if command -v brew >/dev/null; then
    if ! brew list | grep gcc >/dev/null; then
      logg info 'Installing Homebrew gcc' && brew install --quiet gcc
    else
      logg info 'Homebrew gcc is available'
    fi
  else
    logg error 'Failed to initialize Homebrew' && exit 1
  fi
}

# @description This function ensures Homebrew is installed and available in the `PATH`. It handles the installation of Homebrew on both **Linux and macOS**.
#     It will attempt to bypass sudo password entry if it detects that it can do so. The function also has some error handling in regards to various
#     directories falling out of the correct ownership and permission states. Finally, it loads Homebrew into the active profile (allowing other parts of the script
#     to use the `brew` command).
#
#     With Homebrew installed and available, the script finishes by installing the `gcc` Homebrew package which is a very common dependency.
ensureHomebrew() {
  loadHomebrew
  ensurePackageManagerHomebrew
  loadHomebrew
  ensureGcc
}
ensureHomebrew
