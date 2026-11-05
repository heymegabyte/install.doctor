#!/usr/bin/env bash
set -euo pipefail

for path in \
  packages/control-plane/.aid-admin-token \
  .env \
  .env.production; do
  if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    echo "runtime secret file is tracked: $path" >&2
    exit 1
  fi
done

echo 'no-tracked-runtime-secrets: PASS'
