#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

test -f "$ROOT/scripts/provision.sh"
test ! -e "$ROOT/scripts/src/provision.sh.tmpl"
grep -q '`scripts/provision.sh` is the authored and served source of truth' "$ROOT/scripts/.gomplate.yaml"

printf 'Bootstrap source-authority tests passed.\n'
