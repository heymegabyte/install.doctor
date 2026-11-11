#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/left" "$TMP/right"
printf 'engine\n' >"$TMP/left/desktop-tools-engine.mjs"; cp "$TMP/left/desktop-tools-engine.mjs" "$TMP/right/desktop-tools-engine.mjs"
printf 'launcher\n' >"$TMP/left/start"; cp "$TMP/left/start" "$TMP/right/start"
node "$ROOT/scripts/compare-release-reproducibility.mjs" "$TMP/left" "$TMP/right" "$TMP/receipt.json" >/dev/null
node --input-type=module - "$TMP/receipt.json" <<'NODE'
import { readFileSync } from 'node:fs'; const value=JSON.parse(readFileSync(process.argv[2]));
if(value.result!=='identical'||Object.keys(value.artifacts).length!==2)throw new Error('invalid receipt');
NODE
printf 'diverged\n' >"$TMP/right/start"
if node "$ROOT/scripts/compare-release-reproducibility.mjs" "$TMP/left" "$TMP/right" "$TMP/rejected.json" >/dev/null 2>&1; then
  echo 'FAIL accepted divergent output' >&2; exit 1
fi
WORKFLOW="$ROOT/.github/workflows/desktop-tools-release-production.yml"
for artifact in install-doctor-engine.mjs desktop-tools-privileged-broker desktop-tools-supervisor.mjs desktop-tools-tools.tar.gz; do
  grep -Fq "$artifact" "$WORKFLOW"
done
grep -Fq '.release-work/reproducibility/source-first .release-work/reproducibility/source-second' "$WORKFLOW"
grep -Fq '.release-work/output/unsigned .release-work/output/reproduced' "$WORKFLOW"
grep -Fq 'desktop-tools-release-reproducibility-${{ github.run_id }}' "$WORKFLOW"
printf 'release-reproducibility: 10 passed, 0 failed\n'
