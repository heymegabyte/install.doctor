#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="$ROOT/packages/installer-engine"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'SKIP installer-engine (Node/npm unavailable)\n'
  exit 0
fi

if [ ! -d "$PACKAGE/node_modules" ]; then
  npm ci --prefix "$PACKAGE" --ignore-scripts --no-audit --no-fund >/dev/null
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
if npm test --prefix "$PACKAGE" >"$log" 2>&1; then
  pass 'strict installer engine builds from source and passes its lifecycle/CLI suite'
else
  tail -n 80 "$log" >&2
  fail 'installer engine build or tests failed'
fi

if grep -q "createInstallerEngine" "$PACKAGE/src/engine.ts" \
  && grep -q "reduceInstallerEvents" "$PACKAGE/src/renderers.ts" \
  && ! grep -qE "from ['\"].*(gum|ink|blessed|tui)" "$PACKAGE/src/engine.ts"; then
  pass 'engine owns lifecycle while renderers remain passive protocol consumers'
else
  fail 'engine/presentation boundary regressed'
fi

if grep -q "shell: false" "$PACKAGE/src/process-runner.ts" \
  && ! grep -qE "exec\(|execSync\(|shell: true" "$PACKAGE/src/cli.ts" "$PACKAGE/src/process-runner.ts"; then
  pass 'process adapter executes validated argv without a shell'
else
  fail 'process adapter permits shell-string execution'
fi

printf 'installer-engine: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
