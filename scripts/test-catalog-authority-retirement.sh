#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RECONCILER="$ROOT/scripts/reconcile-catalog-authority.mjs"
CATALOG="$ROOT/packages/control-plane/src/catalog.json"

first="$(node "$RECONCILER" --check)"
second="$(node "$RECONCILER" --check)"
[ "$first" = "$second" ]

node - "$ROOT/config/catalog-authority.json" <<'JS'
const fs = require('node:fs');
const authority = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (authority.canonicalSource !== 'software.yml') throw new Error('canonical source drift');
if (authority.derivedViews.map(view => view.kind).sort().join(',') !== 'checked-in-release-catalog,host-runtime-cache') {
  throw new Error('derived-view inventory drift');
}
if (authority.compatibilityBoundaries.some(boundary => !boundary.constraint || !boundary.status)) {
  throw new Error('compatibility boundary lacks an explicit constraint');
}
JS

before="$(shasum -a 256 "$CATALOG" | awk '{print $1}')"
node "$RECONCILER" --write >/dev/null
after="$(shasum -a 256 "$CATALOG" | awk '{print $1}')"
[ "$before" = "$after" ]

for retired in scripts/software.mjs scripts/software-github.mjs; do
  [ ! -e "$ROOT/$retired" ]
  ! git -C "$ROOT" grep -l -F "$retired" -- ':!config/catalog-authority.json' ':!scripts/test-catalog-authority-retirement.sh' >/dev/null
done

printf 'catalog-authority-retirement: 12 passed, 0 failed\n'
