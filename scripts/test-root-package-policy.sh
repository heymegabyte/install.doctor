#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="$ROOT/package.json"
P=0 F=0
pass(){ printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail(){ printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if jq -e '.private == true' "$PACKAGE" >/dev/null; then
  pass 'root orchestration package cannot be accidentally published'
else
  fail 'root orchestration package must be private'
fi

if jq -e '((.dependencies // {}) | length) == 0 and ((.devDependencies // {}) | length) == 0 and ((.peerDependencies // {}) | length) == 0' "$PACKAGE" >/dev/null; then
  pass 'root orchestration has no unused or mutable npm dependency surface'
else
  fail 'root package contains dependencies; dependencies belong in the owning workspace with a lockfile'
fi

if jq -e '.scripts.test == "task test" and .scripts.build == "task validate:software"' "$PACKAGE" >/dev/null; then
  pass 'root npm commands delegate to deterministic repository gates'
else
  fail 'root npm scripts do not delegate to canonical Taskfile gates'
fi

printf 'root-package-policy: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
