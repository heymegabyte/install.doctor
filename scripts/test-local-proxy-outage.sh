#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/sync-nexus-proxy-hook.mjs"
exec node --test "$SCRIPT_DIR/test-local-proxy-outage.mjs"
