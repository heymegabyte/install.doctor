#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; TOOL="$ROOT/home/dot_local/bin/executable_oneprompt-convergence-supervisor"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
HOME_DIR="$TMP/home"; BIN_DIR="$TMP/bin"; REPO="$TMP/oneprompt"; CALLS="$TMP/calls"; MANAGER_STATE="$TMP/manager-state"
NODE_DIR="$(dirname "$(command -v node)")"
mkdir -p "$HOME_DIR" "$BIN_DIR" "$REPO/scripts"; chmod +x "$TOOL"
printf 'export default {}\n' >"$REPO/scripts/convergence-worker.mjs"
cat >"$REPO/scripts/machine" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$ONEPROMPT_CONVERGENCE_STATE_DIR"; file="$ONEPROMPT_CONVERGENCE_STATE_DIR/fake-state"
mode="$(cat "$file" 2>/dev/null || printf paused)"
case "$1" in install) : ;; pause) mode=paused;; stop) mode=stopped;; resume) mode=running;; status|verify) : ;; *) exit 2;; esac
printf '%s' "$mode" >"$file"
printf '{"schemaVersion":2,"desiredMode":"%s","workerLiveness":"absent","heartbeatFreshness":"missing","progressFreshness":"missing","checkpointId":null,"ownershipEpoch":0,"blockers":[],"budgets":{"maxWorkers":8}}\n' "$mode"
SH
chmod +x "$REPO/scripts/machine"
git -C "$REPO" init -q; git -C "$REPO" config user.email test@example.invalid; git -C "$REPO" config user.name test; git -C "$REPO" add .; git -C "$REPO" commit -qm fixture
REVISION="$(git -C "$REPO" rev-parse HEAD)"
cat >"$BIN_DIR/launchctl" <<'SH'
#!/usr/bin/env bash
set -eu; printf '%s\n' "$*" >>"$FAKE_MANAGER_CALLS"
case "${1:-}" in print) test "$(cat "$FAKE_MANAGER_STATE" 2>/dev/null || true)" = active || exit 1;; bootstrap|kickstart) printf active >"$FAKE_MANAGER_STATE";; bootout) printf inactive >"$FAKE_MANAGER_STATE";; esac
SH
chmod +x "$BIN_DIR/launchctl"
run_tool() { env HOME="$HOME_DIR" PATH="$BIN_DIR:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_DIR/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=launchd FAKE_MANAGER_STATE="$MANAGER_STATE" FAKE_MANAGER_CALLS="$CALLS" "$TOOL" "$@"; }
fail() { printf 'not ok - %s\n' "$1" >&2; exit 1; }; pass() { printf 'ok - %s\n' "$1"; }

run_tool install --repo "$REPO" --machine-interface "$REPO/scripts/machine" --revision "$REVISION"
PLIST="$HOME_DIR/Library/LaunchAgents/tools.theme.oneprompt.converge.plist"; test -f "$PLIST" || fail canonical-definition
first="$(shasum -a 256 "$PLIST"|awk '{print $1}')"; run_tool install --repo "$REPO" --machine-interface "$REPO/scripts/machine" --revision "$REVISION" >/dev/null; test "$first" = "$(shasum -a 256 "$PLIST"|awk '{print $1}')" || fail idempotent; test ! -s "$CALLS" || fail inert
pass 'install is canonical, byte-stable, and inert'

if run_tool start >/dev/null 2>&1; then fail stopped-start; fi
run_tool resume; grep -q 'tools.theme.oneprompt.converge' "$CALLS" || fail canonical-start
run_tool pause; test "$(cat "$HOME_DIR/.local/state/oneprompt-convergence/fake-state")" = paused || fail pause-first; test "$(cat "$MANAGER_STATE")" = inactive || fail manager-stop
run_tool stop; test "$(cat "$HOME_DIR/.local/state/oneprompt-convergence/fake-state")" = stopped || fail stop-first
pass 'SQLite intent precedes manager lifecycle and durable stop blocks start'

status="$(run_tool status)"; node -e 'const s=JSON.parse(process.argv[1]); if(s.logicalIdentity!=="tools.theme.oneprompt.converge"||s.controller.desiredMode!=="stopped"||s.healthy!==false||s.packageVersion!=="1.0.0")process.exit(1)' "$status" || fail status
pass 'status separates controller, manager, and artifact evidence'

printf '# drift\n' >>"$REPO/scripts/machine"; if run_tool resume >/dev/null 2>&1; then fail drift; fi; git -C "$REPO" checkout -q -- scripts/machine; chmod +x "$REPO/scripts/machine"
pass 'artifact drift blocks admission'

plan="$(run_tool adopt-plan)"; node -e 'const p=JSON.parse(process.argv[1]); if(p.mutationPerformed!==false)process.exit(1)' "$plan" || fail plan
pass 'adoption planning is read-only'

run_tool uninstall >/dev/null; test ! -e "$PLIST" || fail uninstall; test "$(cat "$HOME_DIR/.local/state/oneprompt-convergence/fake-state")" = stopped || fail retained
pass 'uninstall removes only managed definition and retains stopped state'

HOME_LINUX="$TMP/home-linux"; BIN_LINUX="$TMP/bin-linux"; SYS_CALLS="$TMP/syscalls"; mkdir -p "$HOME_LINUX" "$BIN_LINUX"
cat >"$BIN_LINUX/systemctl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_SYSTEMD_CALLS"; case "$*" in *is-active*) exit 3;; esac
SH
chmod +x "$BIN_LINUX/systemctl"
env HOME="$HOME_LINUX" PATH="$BIN_LINUX:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_LINUX/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=systemd FAKE_SYSTEMD_CALLS="$SYS_CALLS" "$TOOL" install --repo "$REPO" --machine-interface "$REPO/scripts/machine" --revision "$REVISION" >/dev/null
UNIT="$HOME_LINUX/.config/systemd/user/tools.theme.oneprompt.converge.service"; test -f "$UNIT" || fail systemd; grep -q '^Restart=no$' "$UNIT" || fail restart; test ! -s "$SYS_CALLS" || fail systemd-inert
pass 'systemd definition is canonical and inert'

if grep -R -E '(TOKEN|SECRET|PASSWORD)=' "$PLIST" "$UNIT" 2>/dev/null; then fail secrets; fi
pass 'definitions contain no secret environment'
