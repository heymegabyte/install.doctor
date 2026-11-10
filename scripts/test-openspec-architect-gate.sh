#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for name in new propose ff continue update onboard explore; do
  test ! -e "$ROOT/.opencode/commands/opsx-$name.md" || {
    echo "OpenCode architecture-authoring command remains: opsx-$name" >&2
    exit 1
  }
done

for name in new propose ff continue update; do
  test ! -e "$ROOT/.opencode/skills/openspec-$name-change/SKILL.md" || {
    echo "OpenCode architecture-authoring skill remains: openspec-$name-change" >&2
    exit 1
  }
done
for name in onboard explore; do
  test ! -e "$ROOT/.opencode/skills/openspec-$name/SKILL.md" || {
    echo "OpenCode architecture-authoring skill remains: openspec-$name" >&2
    exit 1
  }
done

node --experimental-strip-types "$ROOT/scripts/validate-openspec-architect.ts"
echo 'openspec-architect-gate: PASS'
