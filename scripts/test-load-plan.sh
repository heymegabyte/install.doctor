#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P=0 F=0
pass(){ printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail(){ printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

npm --prefix "$ROOT/packages/installer-engine" run build >/dev/null
first="$(node "$ROOT/scripts/generate-load-plan.mjs" --platform macos --architecture arm64 --role workstation --resolver go --resolver node --resolver python --resolver ruby --resolver rust --resolver uv)"
second="$(node "$ROOT/scripts/generate-load-plan.mjs" --platform macos --architecture arm64 --role workstation --resolver uv --resolver rust --resolver ruby --resolver python --resolver node --resolver go)"

if [ "$(printf '%s' "$first" | jq -r .digest)" = "$(printf '%s' "$second" | jq -r .digest)" ]; then
  pass 'repeated load planning is deterministic across set-like input order'
else
  fail 'load plan digest changes with set-like input order'
fi

if printf '%s' "$first" | jq -e '
  (.startOrder | length) == 0 and
  all(.items[] | select(.classification == "eager-service"); (.selected == false and (.actions | length) == 0)) and
  ([.items[] | select(.selected == true)] | length) > 0 and
  ([.items[] | select(.selected == false)] | length) > 0
' >/dev/null; then
  pass 'unselected services remain uninstalled/unstarted and excluded entries stay visible'
else
  fail 'load plan selected an unrequested service or omitted selection/exclusion detail'
fi

if printf '%s' "$first" | jq -e '
  (.items[] | select(.name == "rclone") | .postInstallPrivilege) == "user" and
  (.items[] | select(.name == "mise") | .postInstallPrivilege) == "admin"
' >/dev/null; then
  pass 'post-install privilege authority survives catalog and load planning'
else
  fail 'post-install privilege authority was lost or broadened during load planning'
fi

if node "$ROOT/scripts/generate-load-plan.mjs" --platform linux --architecture x64 --package definitely-not-a-package >/dev/null 2>&1; then
  fail 'unknown desired package was accepted'
else
  pass 'unknown desired package fails before mutation'
fi

printf 'load-plan: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
