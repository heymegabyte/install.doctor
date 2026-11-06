#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTROL="$ROOT/packages/control-plane/src/index.ts"
BOOTSTRAP="$ROOT/packages/control-plane/src/bootstrap.ts"
PROVISION="$ROOT/scripts/provision.sh"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }
contains() { grep -Fq "$2" "$1" && pass "$3" || fail "$3"; }
excludes() { ! grep -Fq "$2" "$1" && pass "$3" || fail "$3"; }

contains "$BOOTSTRAP" 'STAGE="$(mktemp -d' 'stage zero uses a private temporary directory'
contains "$BOOTSTRAP" '/dev/tty' 'interactive child reads from the terminal'
contains "$BOOTSTRAP" '/dev/null' 'headless child cannot consume the curl stream'
contains "$BOOTSTRAP" 'ssh-keygen -Y verify' 'detached SSHSIG verification is mandatory'
contains "$BOOTSTRAP" 'artifact_sha256' 'signed SHA-256 integrity pin is mandatory'
excludes "$BOOTSTRAP" 'exec bash <(' 'stage zero avoids process substitution'
grep -Eq 'schemaVersion:[[:space:]]*1' "$PROVISION" && pass 'provisioner persists a versioned JSON plan' || fail 'provisioner persists a versioned JSON plan'
contains "$PROVISION" "gum choose --header 'Machine role'" 'TUI selects an explicit machine role'
contains "$PROVISION" "gum choose --header 'Network enrollment' none" 'network enrollment defaults to none'
contains "$INSTALLX" 'tasks.push(() =>' 'install commands are represented as lazy tasks'
contains "$INSTALLX" 'Math.min(CONCURRENCY, tasks.length || 1)' 'worker count is bounded'
contains "$INSTALLX" 'throw new Error(`${failures.length} installation task(s) failed`)' 'installation failures propagate'

printf 'fleet-installer-policy: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
