#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/app"
git -C "$TMP/app" init -q
printf '%s\n' 'console.log(process.env.DATABASE_PASSWORD, process.env.PUBLIC_URL)' >"$TMP/app/app.js"
printf '%s\n' '{"workspaceId":"not-a-secret-value"}' >"$TMP/app/.infisical.json"
git -C "$TMP/app" add app.js .infisical.json
python3 "$ROOT/scripts/infisical-estate-audit.py" "$TMP" >"$TMP/report.json"
jq -e '.repositories[0].configured == true' "$TMP/report.json" >/dev/null
jq -e '.repositories[0].secretNames == ["DATABASE_PASSWORD"]' "$TMP/report.json" >/dev/null
jq -e '.repositories[0].runtimeClass == "local-process"' "$TMP/report.json" >/dev/null
! grep -Fq 'not-a-secret-value' "$TMP/report.json"
echo 'infisical-estate-audit: PASS'
