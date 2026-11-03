#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTROL="$ROOT/packages/control-plane/src/index.ts"
PROVISION="$ROOT/scripts/provision.sh"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }
contains() { grep -Fq "$2" "$1" && pass "$3" || fail "$3"; }
excludes() { ! grep -Fq "$2" "$1" && pass "$3" || fail "$3"; }

contains "$CONTROL" 'START_TMP="$(mktemp -d' 'stage zero uses a private temporary directory'
contains "$CONTROL" '< /dev/tty' 'interactive child reads from the terminal'
contains "$CONTROL" '< /dev/null' 'headless child cannot consume the curl stream'
contains "$CONTROL" 'START_SHA256' 'optional SHA-256 integrity pin is enforced'
excludes "$CONTROL" 'exec bash <(' 'stage zero avoids process substitution'
contains "$PROVISION" '"schemaVersion":1' 'provisioner persists a versioned JSON plan'
contains "$PROVISION" "gum choose --header 'Machine role'" 'TUI selects an explicit machine role'
contains "$PROVISION" "gum choose --header 'Network enrollment' none" 'network enrollment defaults to none'
contains "$INSTALLX" 'tasks.push(() =>' 'install commands are represented as lazy tasks'
contains "$INSTALLX" 'Math.min(CONCURRENCY, tasks.length || 1)' 'worker count is bounded'
contains "$INSTALLX" 'throw new Error(`${failures.length} installation task(s) failed`)' 'installation failures propagate'

printf 'fleet-installer-policy: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
