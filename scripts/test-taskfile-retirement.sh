#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

for retired in .config/taskfiles .config/hbs.cjs .config/husky .config/run pnpm-lock.yaml local/yarn.lock; do
  [ ! -e "$retired" ] || fail "retired root build artifact exists: $retired"
done

node -e 'const p=require("./package.json"); const allowed=new Set(["build","help","lint","repair","sort:software","start","test","validate:software"]); for (const [name,command] of Object.entries(p.scripts)) { if (!allowed.has(name)) throw new Error(`obsolete script: ${name}`); if (/bash start\.sh|task (npm:|commit|fix|preload|publish:|update|vscode)/.test(command)) throw new Error(`legacy task caller: ${name}`); }'

grep -q 'task provision' start.sh || fail 'start.sh does not dispatch the repository provision task'
if rg -n 'ensureTaskfiles|task (donothing|ci:synchronize|install:software:pipx|new:project|-vvv start)|shared-master/common/\.config/taskfiles' start.sh; then
  fail 'start.sh still contains shared-Taskfile bootstrap callers'
fi

grep -q '^  provision:$' Taskfile.yml || fail 'root Taskfile lacks provision task'
grep -q '^  test:scripts:$' Taskfile.yml || fail 'root Taskfile lacks test:scripts task'

printf 'PASS: repository-owned Taskfile is self-contained; dead shared Taskfiles and root locks are retired\n'
