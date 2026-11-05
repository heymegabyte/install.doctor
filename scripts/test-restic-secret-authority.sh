#!/usr/bin/env bash
set -euo pipefail

target=home/dot_config/task/Taskfile.yml
if grep -Fq -- '--password-file "${XDG_CONFIG_HOME:-$HOME/.config}/age/chezmoi.txt"' "$target"; then
  echo 'Restic still reuses the Chezmoi age identity as a repository password' >&2
  exit 1
fi
grep -Fq 'get-secret RESTIC_PASSWORD' "$target"
grep -Fq 'chmod 0600 "$RESTIC_PASSWORD_FILE"' "$target"
grep -Fq "trap 'rm -f \"\$RESTIC_PASSWORD_FILE\"' EXIT" "$target"
echo 'restic-secret-authority: PASS'
