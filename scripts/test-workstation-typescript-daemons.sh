#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec node --experimental-strip-types --test "$ROOT/scripts/test-workstation-typescript-daemons.ts"
