#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/privileged-broker-transport.yml"
FIXTURE="$ROOT/packages/installer-engine/test/privileged-broker-controller-linux.test.mjs"
CONTROLLER="$ROOT/packages/installer-engine/src/privileged-broker-controller.ts"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }
check() { local label="$1"; shift; if "$@"; then pass "$label"; else fail "$label"; fi; }

check 'broker acceptance is independently time bounded' \
  grep -Fq 'timeout --signal=TERM --kill-after=5s 120s sudo env' "$WORKFLOW"
check 'broker acceptance supplies both sealed fixture artifacts' \
  grep -Fq 'DESKTOP_TOOLS_PRIVILEGED_BROKER_CLIENT_TEST_MODULE=' "$WORKFLOW"
check 'root fixture copies its client into the bounded execution fixture' \
  grep -Fq "copyFile(clientModuleSource, clientModulePath)" "$FIXTURE"
check 'real transport fixture declares a unique sticky-directory client path' \
  awk '/real sealed-FD broker transport/{seen=1} seen && /const clientModulePath = join\(.\/tmp., `\$\{runId\}-client\.mjs`\)/{found=1} END{exit !found}' "$FIXTURE"
check 'fixture client is root-owned and non-writable before privilege drop' \
  awk '/chmod\(clientModulePath, 0o444\)/{mode=1} /chown\(clientModulePath, 0, 0\)/{owner=1} END{exit !(mode && owner)}' "$FIXTURE"
check 'standalone fixture reproduces production runtime parent modes' \
  awk '/prepareRuntimeParents\(enrolledGid\)/{call=1} /chmod\(.\/run\/desktop-tools., 0o750\)/{root=1} /chmod\(.\/run\/desktop-tools\/authority., 0o711\)/{authority=1} /chmod\(.\/run\/desktop-tools\/broker., 0o750\)/{broker=1} END{exit !(call && root && authority && broker)}' "$FIXTURE"
check 'controller subscribes to completion before invoking readiness' \
  awk '/const childCompletion = new Promise/{listener=NR} /await testOptions\.onReady/{ready=NR} END{exit !(listener && ready && listener < ready)}' "$CONTROLLER"
check 'controller escalates bounded failed child cleanup' \
  grep -Fq "child.kill('SIGKILL')" "$CONTROLLER"

printf 'privileged-broker-acceptance: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
