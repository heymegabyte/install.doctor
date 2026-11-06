#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEDGER="$(mktemp "${TMPDIR:-/tmp}/install-doctor-file-ledger.XXXXXXXX").json"
trap 'rm -f "$LEDGER"' EXIT
cd "$ROOT"
node scripts/audit-repository-files.mjs --output="$LEDGER" >/dev/null

tracked="$(git ls-files | wc -l | tr -d ' ')"
jq -e --argjson tracked "$tracked" '
  .schemaVersion == 2 and
  .complete == true and
  .trackedFileCount == $tracked and
  .classifiedFileCount == $tracked and
  (.files | length) == $tracked and
  ([.files[].path] | unique | length) == $tracked and
  ([.files[].kind] | all(. != null and . != "")) and
  ([.files[].validators | length] | all(. > 0)) and
  ([.files[].disposition] | all(. != null and . != "" and . != "review-required")) and
  ([.files[].reason] | all(. != null and length >= 20)) and
  ([.files[].evidence | length] | all(. > 0)) and
  .reviewCount == 0 and
  ([.files[] | select(.issues | index("unexpected-empty-file"))] | length) == 0
' "$LEDGER" >/dev/null

printf 'repository-file-ledger: PASS (%s tracked files accounted for)\n' "$tracked"
