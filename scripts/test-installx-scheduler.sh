#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if grep -Fq 'await (typeof task === '\''function'\'' ? task() : task)' "$INSTALLX"; then
  pass 'serial helper starts each task only when its turn is reached'
else
  fail 'serial helper only awaits already-started promises'
fi

flatpak_case="$(sed -n "/case 'flatpak':/,/break/p" "$INSTALLX")"
if printf '%s\n' "$flatpak_case" | grep -Fq 'forEachSeries' \
  && ! printf '%s\n' "$flatpak_case" | grep -Fq '.map(task => task())'; then
  pass 'flatpak installs remain lazy and serial'
else
  fail 'flatpak promises start eagerly before serial iteration'
fi

bundle_fn="$(sed -n '/async function bundleInstall/,/^}/p' "$INSTALLX")"
if printf '%s\n' "$bundle_fn" | grep -Fq 'fs.mkdtempSync' \
  && printf '%s\n' "$bundle_fn" | grep -Fq 'fs.rmSync' \
  && ! printf '%s\n' "$bundle_fn" | grep -Fq 'cd('; then
  pass 'brew bundle uses a cleaned private directory without changing global cwd'
else
  fail 'brew bundle leaks its temp directory or mutates process-global cwd'
fi

printf 'installx-scheduler: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
