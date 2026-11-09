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
check 'root fixture copies its client into protected authority' \
  grep -Fq "copyFile(clientModuleSource, clientModulePath)" "$FIXTURE"
check 'real transport fixture declares its protected client path' \
  awk '/real sealed-FD broker transport/{seen=1} seen && /const clientModulePath = join\(authorityRoot, .client\.mjs.\)/{found=1} END{exit !found}' "$FIXTURE"
check 'controller subscribes to completion before invoking readiness' \
  awk '/const childCompletion = new Promise/{listener=NR} /await testOptions\.onReady/{ready=NR} END{exit !(listener && ready && listener < ready)}' "$CONTROLLER"
check 'controller escalates bounded failed child cleanup' \
  grep -Fq "child.kill('SIGKILL')" "$CONTROLLER"

printf 'privileged-broker-acceptance: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
