#!/usr/bin/env bash
# One bounded routine gate for every zero-argument shell suite. Execution is
# delegated to a cross-platform orchestrator so collision-free suites can run
# concurrently while declared shared-state suites remain serialized.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

suites=()
for t in "$DIR"/test-*.sh "$DIR"/validate-software-yml.sh; do
  [ -f "$t" ] || continue
  [ "$(basename "$t")" = "test-all.sh" ] && continue
  suites+=("$t")
done

exec node "$DIR/run-routine-test-harness.mjs" "${suites[@]}"
