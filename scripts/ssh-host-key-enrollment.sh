#!/usr/bin/env bash
# Repository entrypoint for the same command installed by chezmoi.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/home/dot_config/system/usr/local/bin/executable_ssh-host-key-enrollment" "$@"
