#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEDGER="$(mktemp "${TMPDIR:-/tmp}/install-doctor-file-ledger.XXXXXXXX").json"
trap 'rm -f "$LEDGER"' EXIT
cd "$ROOT"
node scripts/audit-repository-files.mjs --output="$LEDGER" >/dev/null

# Canonical output is tracked and therefore self-referential. Two unchanged
# regenerations must still be byte-identical.
CANONICAL="$ROOT/.agent/repository-file-ledger.json"
BACKUP="$(mktemp "${TMPDIR:-/tmp}/install-doctor-file-ledger-backup.XXXXXXXX").json"
cp "$CANONICAL" "$BACKUP"
restore_canonical() { cp "$BACKUP" "$CANONICAL"; rm -f "$BACKUP"; }
trap 'rm -f "$LEDGER"; restore_canonical' EXIT
node scripts/audit-repository-files.mjs --output=.agent/repository-file-ledger.json >/dev/null
first="$(shasum -a 256 "$CANONICAL" | awk '{print $1}')"
node scripts/audit-repository-files.mjs --output=.agent/repository-file-ledger.json >/dev/null
second="$(shasum -a 256 "$CANONICAL" | awk '{print $1}')"
[ "$first" = "$second" ] || { printf 'repository ledger regeneration is not deterministic\n' >&2; exit 1; }
restore_canonical
trap 'rm -f "$LEDGER"' EXIT

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
