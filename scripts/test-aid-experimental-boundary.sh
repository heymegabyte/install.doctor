#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0

for path in start.sh scripts/provision.sh scripts/src/provision.sh.tmpl site/src; do
  if rg -q 'probabilistic-intent|createSpeculativeBranch|evaluateEasterEgg|cloudflareEdgeRoute' "$ROOT/$path"; then
    printf 'FAIL experimental aid contracts reached product/runtime surface: %s\n' "$path" >&2
    FAIL=$((FAIL + 1))
  fi
done

if ! rg -q 'experimental HTTP adapters' "$ROOT/packages/aid-core/README.md" "$ROOT/packages/aid-core/docs/PRODUCT-SPEC.md"; then
  printf 'FAIL aid docs do not disclose the experimental control-plane adapter boundary\n' >&2
  FAIL=$((FAIL + 1))
fi

if [ "$FAIL" -eq 0 ]; then
  printf 'PASS aid experimental contracts remain outside bootstrap, provisioner, and site runtime\n'
  printf 'PASS aid docs disclose the experimental control-plane adapters\n'
fi
[ "$FAIL" -eq 0 ]
