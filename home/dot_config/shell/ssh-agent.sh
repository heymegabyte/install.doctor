#!/usr/bin/env bash
# Homebrew OpenSSH Agent with native FIDO2 / YubiKey hardware support
# Managed by install.doctor / chezmoi for passwordless & touch-only SSH forwarding

# Only run if ssh / ssh-agent is available
if command -v ssh-agent >/dev/null 2>&1; then
  export SSH_AUTH_SOCK="$HOME/.ssh/agent.sock"

  # Find preferred ssh-agent binary (prefer Homebrew on macOS)
  SSH_AGENT_BIN="$(command -v /opt/homebrew/bin/ssh-agent || command -v /usr/local/bin/ssh-agent || command -v ssh-agent)"
  SSH_ADD_BIN="$(command -v /opt/homebrew/bin/ssh-add || command -v /usr/local/bin/ssh-add || command -v ssh-add)"

  # If agent socket is missing or dead, clean up and start a new daemon
  if [ ! -S "$SSH_AUTH_SOCK" ] || ! "$SSH_ADD_BIN" -l >/dev/null 2>&1; then
    rm -f "$SSH_AUTH_SOCK"
    eval "$("$SSH_AGENT_BIN" -a "$SSH_AUTH_SOCK")" >/dev/null 2>&1
  fi

  # Silently register YubiKey and default SSH identities if present and not already loaded
  if ! "$SSH_ADD_BIN" -l 2>/dev/null | grep -qE "5c-nano-laptop|ED25519-SK"; then
    for fido_key in "$HOME/.ssh/ssh-5c-nano-laptop" "$HOME/.ssh/id_ed25519_sk"; do
      [ -f "$fido_key" ] && "$SSH_ADD_BIN" "$fido_key" >/dev/null 2>&1
    done
  fi

  if ! "$SSH_ADD_BIN" -l 2>/dev/null | grep -q "user@work"; then
    [ -f "$HOME/.ssh/id_rsa" ] && "$SSH_ADD_BIN" "$HOME/.ssh/id_rsa" >/dev/null 2>&1
  fi
fi
