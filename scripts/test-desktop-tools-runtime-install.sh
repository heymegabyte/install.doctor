#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/provision.sh
source "$ROOT/scripts/provision.sh"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/desktop-tools-runtime-install.XXXXXX")"
trap 'rm -rf -- "$FIXTURE"' EXIT

for name in runtime supervisor tools lock; do printf '%s\n' "$name" > "$FIXTURE/$name"; done
cat > "$FIXTURE/supervisor.mjs" <<'NODE'
import fs from 'node:fs';
const args=process.argv.slice(2); const take=name=>{const index=args.indexOf(name);if(index<0||index+1>=args.length)throw new Error(`missing ${name}`);return args[index+1]};
if(args[0]!=='install')throw new Error('runtime closure did not use install');
for(const flag of ['--runtime-archive','--sha256','--version','--supervisor','--supervisor-sha256','--tools-archive','--tools-sha256','--lock','--lock-sha256'])take(flag);
if(take('--version')!=='2.2.5')throw new Error('version changed');
for(const flag of ['--runtime-archive','--supervisor','--tools-archive','--lock'])if(!fs.statSync(take(flag)).isFile())throw new Error(`${flag} is not a file`);
fs.writeFileSync(process.env.CALL_LEDGER,`${JSON.stringify(args)}\n`,{flag:'a'});
process.stdout.write('{"schemaVersion":1,"changed":false,"closureDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","executable":"/tmp/desktop-tools"}\n');
NODE
chmod 0700 "$FIXTURE/supervisor.mjs"
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

export CALL_LEDGER="$FIXTURE/calls" INSTALL_DOCTOR_RUNTIME_NODE="$(node -p 'process.execPath')"
export DESKTOP_TOOLS_PROFILE_ID=profile-test DESKTOP_TOOLS_OPENCODE_VERSION=2.2.5
export DESKTOP_TOOLS_OPENCODE_ARCHIVE="$FIXTURE/runtime" DESKTOP_TOOLS_OPENCODE_SHA256="$(sha "$FIXTURE/runtime")"
export DESKTOP_TOOLS_SUPERVISOR_PATH="$FIXTURE/supervisor.mjs" DESKTOP_TOOLS_SUPERVISOR_SHA256="$(sha "$FIXTURE/supervisor.mjs")"
export DESKTOP_TOOLS_TOOLS_ARCHIVE="$FIXTURE/tools" DESKTOP_TOOLS_TOOLS_SHA256="$(sha "$FIXTURE/tools")"
export DESKTOP_TOOLS_OPENCODE_LOCK_PATH="$FIXTURE/lock" DESKTOP_TOOLS_OPENCODE_LOCK_SHA256="$(sha "$FIXTURE/lock")"

idInstallDesktopToolsRuntimeClosure >/dev/null
[ "$DESKTOP_TOOLS_EXECUTABLE" = /tmp/desktop-tools ]
[ "$(wc -l < "$CALL_LEDGER" | tr -d '[:space:]')" = 1 ]
grep -Fq -- '--runtime-archive' "$CALL_LEDGER"
grep -Fq -- '--lock-sha256' "$CALL_LEDGER"
printf 'desktop-tools-runtime-install: PASS\n'
