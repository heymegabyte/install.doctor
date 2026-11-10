#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; TOOL="$ROOT/home/dot_local/bin/executable_oneprompt-convergence-supervisor"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
HOME_DIR="$TMP/home"; BIN_DIR="$TMP/bin"; REPO="${ONEPROMPT_TEST_REPO:-/Users/Apple/emdash/repositories/oneprompt.site-2}"; CALLS="$TMP/calls"; MANAGER_STATE="$TMP/manager-state"
NODE_DIR="$(dirname "$(command -v node)")"
mkdir -p "$HOME_DIR" "$BIN_DIR"; chmod +x "$TOOL"
MACHINE="$REPO/scripts/convergence-machine.mjs"
REVISION="$(git -C "$REPO" rev-parse HEAD)"
cat >"$BIN_DIR/launchctl" <<'SH'
#!/usr/bin/env bash
set -eu; printf '%s\n' "$*" >>"$FAKE_MANAGER_CALLS"
case "${1:-}" in print) test "$(cat "$FAKE_MANAGER_STATE" 2>/dev/null || true)" = active || exit 1;; bootstrap|kickstart) printf active >"$FAKE_MANAGER_STATE";; bootout) printf inactive >"$FAKE_MANAGER_STATE";; esac
SH
chmod +x "$BIN_DIR/launchctl"
run_tool() { env HOME="$HOME_DIR" PATH="$BIN_DIR:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_DIR/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=launchd FAKE_MANAGER_STATE="$MANAGER_STATE" FAKE_MANAGER_CALLS="$CALLS" "$TOOL" "$@"; }
fail() { printf 'not ok - %s\n' "$1" >&2; exit 1; }; pass() { printf 'ok - %s\n' "$1"; }

run_tool install --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION"
PLIST="$HOME_DIR/Library/LaunchAgents/tools.theme.oneprompt.converge.plist"; test -f "$PLIST" || fail canonical-definition
first="$(shasum -a 256 "$PLIST"|awk '{print $1}')"; run_tool install --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null; test "$first" = "$(shasum -a 256 "$PLIST"|awk '{print $1}')" || fail idempotent; test ! -s "$CALLS" || fail inert
pass 'install is canonical, byte-stable, and inert'

if run_tool start >/dev/null 2>&1; then fail stopped-start; fi
run_tool resume; grep -q 'tools.theme.oneprompt.converge' "$CALLS" || fail canonical-start
run_tool pause; run_tool status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).controller.desiredMode!=="paused")process.exit(1)})' || fail pause-first; test "$(cat "$MANAGER_STATE")" = inactive || fail manager-stop
run_tool stop; run_tool status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).controller.desiredMode!=="stopped")process.exit(1)})' || fail stop-first
pass 'SQLite intent precedes manager lifecycle and durable stop blocks start'

status="$(run_tool status)"; node -e 'const s=JSON.parse(process.argv[1]); if(s.logicalIdentity!=="tools.theme.oneprompt.converge"||s.controller.desiredMode!=="stopped"||s.healthy!==false||s.packageVersion!=="1.0.0")process.exit(1)' "$status" || fail status
pass 'status separates controller, manager, and artifact evidence'

CONFIG="$HOME_DIR/.local/state/oneprompt-convergence/host-adapter/config"; cp "$CONFIG" "$CONFIG.save"; sed -i.bak 's/^configured_machine_sha256=.*/configured_machine_sha256='"'"'bad'"'"'/' "$CONFIG"; if run_tool resume >/dev/null 2>&1; then fail drift; fi; mv "$CONFIG.save" "$CONFIG"; rm -f "$CONFIG.bak"
pass 'artifact drift blocks admission'

plan="$(run_tool adopt-plan)"; node -e 'const p=JSON.parse(process.argv[1]); if(p.mutationPerformed!==false)process.exit(1)' "$plan" || fail plan
pass 'adoption planning is read-only'

run_tool uninstall >/dev/null; test ! -e "$PLIST" || fail uninstall; run_tool status >/dev/null 2>&1 && fail removed-config || true
pass 'uninstall removes only managed definition and retains stopped state'

HOME_LINUX="$TMP/home-linux"; BIN_LINUX="$TMP/bin-linux"; SYS_CALLS="$TMP/syscalls"; mkdir -p "$HOME_LINUX" "$BIN_LINUX"
cat >"$BIN_LINUX/systemctl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_SYSTEMD_CALLS"; case "$*" in *is-active*) exit 3;; esac
SH
chmod +x "$BIN_LINUX/systemctl"
env HOME="$HOME_LINUX" PATH="$BIN_LINUX:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_LINUX/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=systemd FAKE_SYSTEMD_CALLS="$SYS_CALLS" "$TOOL" install --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null
UNIT="$HOME_LINUX/.config/systemd/user/tools.theme.oneprompt.converge.service"; test -f "$UNIT" || fail systemd; grep -q '^Restart=no$' "$UNIT" || fail restart; test ! -s "$SYS_CALLS" || fail systemd-inert
pass 'systemd definition is canonical and inert'

if grep -R -E '(TOKEN|SECRET|PASSWORD)=' "$PLIST" "$UNIT" 2>/dev/null; then fail secrets; fi
pass 'definitions contain no secret environment'

HOME_ADOPT="$TMP/home-adopt"; mkdir -p "$HOME_ADOPT/Library/LaunchAgents" "$HOME_ADOPT/.local/state/oneprompt-convergence/config"
printf '<plist>legacy-managed</plist>\n' >"$HOME_ADOPT/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist"
printf '%s\n' "$REPO" >"$HOME_ADOPT/.local/state/oneprompt-convergence/config/repository"
printf 'launchd\n' >"$HOME_ADOPT/.local/state/oneprompt-convergence/config/manager"
printf 'legacy-controller\n' >"$HOME_ADOPT/.local/state/oneprompt-convergence/config/controller"
: >"$HOME_ADOPT/.local/state/oneprompt-convergence/pause"
run_adopt() { env HOME="$HOME_ADOPT" PATH="$BIN_DIR:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_ADOPT/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=launchd FAKE_MANAGER_STATE="$TMP/adopt-manager" FAKE_MANAGER_CALLS="$TMP/adopt-calls" "$TOOL" "$@"; }
run_adopt adopt --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null
ADOPT_PLIST="$HOME_ADOPT/Library/LaunchAgents/tools.theme.oneprompt.converge.plist"; test -f "$ADOPT_PLIST" || fail adopt-definition; test ! -e "$HOME_ADOPT/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist" || fail legacy-retired; ! grep -Eq 'bootstrap|kickstart' "$TMP/adopt-calls" || fail adopt-inert
run_adopt status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(x.controller.desiredMode!=="paused"||x.adoptionState!=="adopted")process.exit(1)})' || fail restrictive
run_adopt adopt --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null || fail adopt-retry
bundle="$(sed -n "s/^recovery_bundle='\(.*\)'/\1/p" "$HOME_ADOPT/.local/state/oneprompt-convergence/host-adapter/config")"; test -r "$bundle/manifest.json" || fail bundle; test "$(stat -f %Lp "$bundle" 2>/dev/null || stat -c %a "$bundle")" = 700 || fail bundle-mode
pass 'adoption is inactive, most-restrictive, recoverable, and retry-idempotent'
run_adopt rollback >/dev/null; test -f "$HOME_ADOPT/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist" || fail rollback-legacy; test ! -e "$ADOPT_PLIST" || fail rollback-canonical; test -f "$HOME_ADOPT/.local/state/oneprompt-convergence/stop" || fail rollback-stop; ! grep -Eq 'bootstrap|kickstart' "$TMP/adopt-calls" || fail rollback-started
pass 'rollback restores managed legacy evidence and remains stopped/inactive'
