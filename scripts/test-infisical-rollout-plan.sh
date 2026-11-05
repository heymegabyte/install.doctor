#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf '%s\n' '{"schemaVersion":1,"repositories":[' \
  '{"repository":"a","configured":false,"runtimeClass":"worker"},' \
  '{"repository":"b","configured":true,"runtimeClass":"worker"},' \
  '{"repository":"c","configured":true,"runtimeClass":"worker","manifest":{"overbroad":true}},' \
  '{"repository":"d","configured":true,"runtimeClass":"worker","manifest":{"overbroad":false},"evidence":{"state":"stale"}},' \
  '{"repository":"e","configured":true,"runtimeClass":"worker","manifest":{"overbroad":false},"evidence":{"state":"verified"}},' \
  '{"repository":"f","configured":true,"runtimeClass":"service","manifest":{"overbroad":false},"evidence":{"state":"revoked"}}]}' >"$TMP/inventory.json"
python3 "$ROOT/scripts/infisical-rollout-plan.py" "$TMP/inventory.json" --batch-size 2 >"$TMP/plan.json"
jq -e '.mutationAllowed == false' "$TMP/plan.json" >/dev/null
jq -e '[.repositories[].state] == ["unenrolled","manifest-missing","overbroad","stale","verified","revoked"]' "$TMP/plan.json" >/dev/null
jq -e '.canaries == [{"runtimeClass":"worker","repository":"b"}]' "$TMP/plan.json" >/dev/null
jq -e '.batches[0].repositories == ["d"]' "$TMP/plan.json" >/dev/null
jq -e '.batches[0].onFailure == "stop-class-and-restore-previous-configuration"' "$TMP/plan.json" >/dev/null
! grep -Eqi 'password|secretValue|tokenValue' "$TMP/plan.json"
echo 'infisical-rollout-plan: PASS'
