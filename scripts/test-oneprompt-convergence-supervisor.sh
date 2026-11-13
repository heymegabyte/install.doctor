#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; TOOL="$ROOT/home/dot_local/bin/executable_oneprompt-convergence-supervisor"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
HOME_DIR="$TMP/home"; BIN_DIR="$TMP/bin"; REPO="${ONEPROMPT_TEST_REPO:-/Users/Apple/emdash/repositories/oneprompt.site-2}"; CALLS="$TMP/calls"; MANAGER_STATE="$TMP/manager-state"
NODE_DIR="$(dirname "$(command -v node)")"
mkdir -p "$HOME_DIR" "$BIN_DIR"; chmod +x "$TOOL"
MACHINE="$REPO/scripts/convergence-machine.mjs"
REVISION="$(git -C "$REPO" rev-parse HEAD)"
ARTIFACT_SHA256="$(sed -n 's/^artifact_sha256="\([0-9a-f]*\)"/\1/p' "$TOOL")"
cat >"$BIN_DIR/launchctl" <<'SH'
#!/usr/bin/env bash
set -eu; printf '%s\n' "$*" >>"$FAKE_MANAGER_CALLS"
case "${1:-}" in
  print)
    case "$(cat "$FAKE_MANAGER_STATE" 2>/dev/null || true)" in
      active) printf 'state = running\n';;
      scheduled) printf 'state = not running\n';;
      *) exit 1;;
    esac
    ;;
  bootstrap|kickstart) printf active >"$FAKE_MANAGER_STATE";;
  bootout) printf inactive >"$FAKE_MANAGER_STATE";;
esac
if test "${1:-}" = bootout; then if test -f "$FAKE_STATE_DB"; then mode="$(sqlite3 "$FAKE_STATE_DB" 'select desired_mode from convergence_state where singleton=1;' 2>/dev/null || printf absent)"; else mode=absent; fi; printf 'bootout-mode=%s\n' "$mode" >>"$FAKE_MANAGER_CALLS"; fi
SH
chmod +x "$BIN_DIR/launchctl"
run_tool() { env HOME="$HOME_DIR" PATH="$BIN_DIR:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_DIR/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=launchd FAKE_MANAGER_STATE="$MANAGER_STATE" FAKE_MANAGER_CALLS="$CALLS" FAKE_STATE_DB="$HOME_DIR/.local/state/oneprompt-convergence/state.sqlite" "$TOOL" "$@"; }
fail() { printf 'not ok - %s\n' "$1" >&2; exit 1; }; pass() { printf 'ok - %s\n' "$1"; }

run_tool install --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION"
PLIST="$HOME_DIR/Library/LaunchAgents/tools.theme.oneprompt.converge.plist"; test -f "$PLIST" || fail canonical-definition
first="$(shasum -a 256 "$PLIST"|awk '{print $1}')"; run_tool install --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null; test "$first" = "$(shasum -a 256 "$PLIST"|awk '{print $1}')" || fail idempotent; ! grep -Eq 'bootstrap|kickstart|bootout' "$CALLS" 2>/dev/null || fail inert
plutil -extract StartInterval raw "$PLIST" | grep -qx '900' || fail launchd-interval
plutil -extract EnvironmentVariables.PATH raw "$PLIST" | grep -q "$(dirname "$(command -v node)")" || fail launchd-node-path
plutil -extract EnvironmentVariables.PATH raw "$PLIST" | grep -q '/opt/homebrew/bin' || fail launchd-subscription-cli-path
pass 'install is canonical, byte-stable, and inert'
: >"$CALLS"

CONFIG="$HOME_DIR/.local/state/oneprompt-convergence/host-adapter/config"
cp "$CONFIG" "$CONFIG.before-upgrade"
sed -i.bak "s/^configured_revision=.*/configured_revision='0000000000000000000000000000000000000000'/" "$CONFIG"
run_tool install --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null
grep -q "configured_revision='$REVISION'" "$CONFIG" || fail revision-upgrade
rm -f "$CONFIG.bak" "$CONFIG.before-upgrade"
pass 'install upgrades an intact managed definition to the requested exact revision'
: >"$CALLS"

cp "$CONFIG" "$CONFIG.before-artifact-upgrade"
sed -i.bak "s/^configured_artifact_sha256=.*/configured_artifact_sha256='0000000000000000000000000000000000000000000000000000000000000000'/" "$CONFIG"
run_tool install --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null
grep -q "configured_artifact_sha256='$ARTIFACT_SHA256'" "$CONFIG" || fail artifact-upgrade
rm -f "$CONFIG.bak" "$CONFIG.before-artifact-upgrade"
pass 'install upgrades an intact managed definition to the requested exact artifact'
: >"$CALLS"

REPIN_REPO="$TMP/oneprompt-repin"
git clone --quiet --shared "$REPO" "$REPIN_REPO"
git -C "$REPIN_REPO" checkout --quiet --detach "$REVISION"
ln -s "$REPO/node_modules" "$REPIN_REPO/node_modules"
REPIN_REPO="$(cd "$REPIN_REPO" && pwd -P)"
REPIN_MACHINE="$REPIN_REPO/scripts/convergence-machine.mjs"
if run_tool install --repo "$REPIN_REPO" --machine-interface "$REPIN_MACHINE" --revision "$REVISION" >/dev/null 2>&1; then fail repin-without-explicit-flag; fi
run_tool install --replace-repo --repo "$REPIN_REPO" --machine-interface "$REPIN_MACHINE" --revision "$REVISION" >/dev/null
grep -q "configured_repo='$REPIN_REPO'" "$CONFIG" || fail repin-config
grep -q "WorkingDirectory</key><string>$REPIN_REPO" "$PLIST" || fail repin-definition
repin_bundle="$(sed -n "s/^repository_repin_bundle='\(.*\)'/\1/p" "$CONFIG")"
test -r "$repin_bundle/manifest.json" || fail repin-recovery-bundle
node -e 'const x=require(process.argv[1]);if(x.kind!=="repository-repin"||x.previousRepo!==process.argv[2]||x.nextRepo!==process.argv[3])process.exit(1)' "$repin_bundle/manifest.json" "$REPO" "$REPIN_REPO" || fail repin-manifest
REPO="$REPIN_REPO"; MACHINE="$REPIN_MACHINE"
pass 'explicit inactive repository repin is recoverable and rewrites the canonical definition'
: >"$CALLS"

LEGACY_PLIST="$HOME_DIR/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist"
printf '<plist>competing-legacy-definition</plist>\n' >"$LEGACY_PLIST"
if run_tool resume >/dev/null 2>&1; then fail duplicate-definition-admission; fi
! grep -Eq 'bootstrap|kickstart|bootout' "$CALLS" 2>/dev/null || fail duplicate-definition-manager-call
rm -f "$LEGACY_PLIST"
pass 'a competing legacy definition blocks admission without a manager call'
: >"$CALLS"

STATE_DB="$HOME_DIR/.local/state/oneprompt-convergence/state.sqlite"
sqlite3 "$STATE_DB" 'update convergence_state set schema_version=999 where singleton=1;'
if run_tool status >/dev/null 2>&1; then fail unknown-schema-status; fi
test ! -s "$CALLS" || fail unknown-schema-manager-call
sqlite3 "$STATE_DB" 'update convergence_state set schema_version=2 where singleton=1;'
pass 'unknown SQLite schema fails closed before manager observation'

STATE_BACKUP="$TMP/state-before-corruption.sqlite"
sqlite3 "$STATE_DB" ".backup '$STATE_BACKUP'"
rm -f "$STATE_DB-wal" "$STATE_DB-shm"
printf 'not-a-sqlite-database\n' >"$STATE_DB"
if run_tool status >/dev/null 2>&1; then fail corrupt-sqlite-status; fi
test ! -s "$CALLS" || fail corrupt-sqlite-manager-call
mv "$STATE_BACKUP" "$STATE_DB"
pass 'corrupt SQLite state fails closed before manager observation'

if run_tool start >/dev/null 2>&1; then fail stopped-start; fi
run_tool resume; grep -q 'tools.theme.oneprompt.converge' "$CALLS" || fail canonical-start
printf scheduled >"$MANAGER_STATE"
scheduled_status="$(run_tool status)"
node -e 'const s=JSON.parse(process.argv[1]);if(s.managerState!=="scheduled"||s.healthy!==true||s.controller.desiredMode!=="running"||s.controller.currentOwner!==null||s.controller.workerLiveness!=="waiting")process.exit(1)' "$scheduled_status" || fail scheduled-waiting-health
pass 'loaded timer between bounded passes is scheduled and healthy without claiming an active worker'
run_tool pause; grep -q 'bootout-mode=paused' "$CALLS" || fail pause-order; run_tool status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).controller.desiredMode!=="paused")process.exit(1)})' || fail pause-first; test "$(cat "$MANAGER_STATE")" = inactive || fail manager-stop
run_tool stop; grep -q 'bootout-mode=stopped' "$CALLS" || fail stop-order; run_tool status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(JSON.parse(s).controller.desiredMode!=="stopped")process.exit(1)})' || fail stop-first
pass 'SQLite intent precedes manager lifecycle and durable stop blocks start'

status="$(run_tool status)"; node -e 'const s=JSON.parse(process.argv[1]); if(s.logicalIdentity!=="tools.theme.oneprompt.converge"||s.controller.desiredMode!=="stopped"||s.healthy!==false||s.packageVersion!=="1.0.0")process.exit(1)' "$status" || fail status
grep -q 'c.workerLiveness==="healthy"' "$TOOL" || fail healthy-liveness-contract
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
run_linux() { env HOME="$HOME_LINUX" PATH="$BIN_LINUX:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_LINUX/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=systemd FAKE_SYSTEMD_CALLS="$SYS_CALLS" "$TOOL" "$@"; }
run_linux resume >/dev/null
linux_scheduled_status="$(run_linux status)"
node -e 'const s=JSON.parse(process.argv[1]);if(s.manager!=="systemd"||s.managerState!=="scheduled"||s.healthy!==true||s.controller.workerLiveness!=="waiting")process.exit(1)' "$linux_scheduled_status" || fail systemd-scheduled-health
pass 'enabled systemd timer between bounded passes is scheduled and healthy'

if grep -R -E '(TOKEN|SECRET|PASSWORD)=' "$PLIST" "$UNIT" 2>/dev/null; then fail secrets; fi
pass 'definitions contain no secret environment'

HOME_ADOPT="$TMP/home-adopt"; mkdir -p "$HOME_ADOPT/Library/LaunchAgents" "$HOME_ADOPT/.local/state/oneprompt-convergence/config"
printf '<plist>legacy-managed</plist>\n' >"$HOME_ADOPT/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist"
printf '%s\n' "$REPO" >"$HOME_ADOPT/.local/state/oneprompt-convergence/config/repository"
printf 'launchd\n' >"$HOME_ADOPT/.local/state/oneprompt-convergence/config/manager"
printf 'legacy-controller\n' >"$HOME_ADOPT/.local/state/oneprompt-convergence/config/controller"
: >"$HOME_ADOPT/.local/state/oneprompt-convergence/pause"
run_adopt() { env HOME="$HOME_ADOPT" PATH="$BIN_DIR:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_ADOPT/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=launchd FAKE_MANAGER_STATE="$TMP/adopt-manager" FAKE_MANAGER_CALLS="$TMP/adopt-calls" FAKE_STATE_DB="$HOME_ADOPT/.local/state/oneprompt-convergence/state.sqlite" "$TOOL" "$@"; }
run_adopt adopt --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null
ADOPT_PLIST="$HOME_ADOPT/Library/LaunchAgents/tools.theme.oneprompt.converge.plist"; test -f "$ADOPT_PLIST" || fail adopt-definition; test ! -e "$HOME_ADOPT/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist" || fail legacy-retired; ! grep -Eq 'bootstrap|kickstart' "$TMP/adopt-calls" || fail adopt-inert
run_adopt status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);if(x.controller.desiredMode!=="paused"||x.adoptionState!=="adopted")process.exit(1)})' || fail restrictive
run_adopt adopt --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null || fail adopt-retry
bundle="$(sed -n "s/^recovery_bundle='\(.*\)'/\1/p" "$HOME_ADOPT/.local/state/oneprompt-convergence/host-adapter/config")"; test -r "$bundle/manifest.json" || fail bundle; test "$(stat -f %Lp "$bundle" 2>/dev/null || stat -c %a "$bundle")" = 700 || fail bundle-mode
pass 'adoption is inactive, most-restrictive, recoverable, and retry-idempotent'
run_adopt rollback >/dev/null; test -f "$HOME_ADOPT/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist" || fail rollback-legacy; test ! -e "$ADOPT_PLIST" || fail rollback-canonical; test -f "$HOME_ADOPT/.local/state/oneprompt-convergence/stop" || fail rollback-stop; ! grep -Eq 'bootstrap|kickstart' "$TMP/adopt-calls" || fail rollback-started
pass 'rollback restores managed legacy evidence and remains stopped/inactive'

HOME_CANONICAL="$TMP/home-canonical"; mkdir -p "$HOME_CANONICAL/Library/LaunchAgents"
CANONICAL_PREDECESSOR="$HOME_CANONICAL/Library/LaunchAgents/tools.theme.oneprompt.converge.plist"
cat >"$CANONICAL_PREDECESSOR" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Label</key><string>tools.theme.oneprompt.converge</string><key>ProgramArguments</key><array><string>$(command -v node)</string><string>$REPO/scripts/convergence-worker.mjs</string></array><key>WorkingDirectory</key><string>$REPO</string><key>EnvironmentVariables</key><dict><key>ONEPROMPT_CONVERGENCE_STATE_DIR</key><string>$HOME_CANONICAL/.local/state/oneprompt-convergence</string></dict><key>RunAtLoad</key><true/><key>StartInterval</key><integer>900</integer></dict></plist>
EOF
chmod 600 "$CANONICAL_PREDECESSOR"
canonical_before="$(shasum -a 256 "$CANONICAL_PREDECESSOR" | awk '{print $1}')"
run_canonical() { env HOME="$HOME_CANONICAL" PATH="$BIN_DIR:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_CANONICAL/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=launchd FAKE_MANAGER_STATE="$TMP/canonical-manager" FAKE_MANAGER_CALLS="$TMP/canonical-calls" FAKE_STATE_DB="$HOME_CANONICAL/.local/state/oneprompt-convergence/state.sqlite" "$TOOL" "$@"; }
run_canonical adopt --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null
test "$canonical_before" != "$(shasum -a 256 "$CANONICAL_PREDECESSOR" | awk '{print $1}')" || fail canonical-predecessor-not-replaced
canonical_status="$(run_canonical status)"
node -e 'const x=JSON.parse(process.argv[1]);if(x.controller.desiredMode==="running"||x.adoptionState!=="adopted")process.exit(1)' "$canonical_status" || { printf '%s\n' "$canonical_status" >&2; fail canonical-predecessor-status; }
! grep -Eq 'bootstrap|kickstart' "$TMP/canonical-calls" 2>/dev/null || fail canonical-predecessor-started
run_canonical rollback >/dev/null
test "$canonical_before" = "$(shasum -a 256 "$CANONICAL_PREDECESSOR" | awk '{print $1}')" || fail canonical-predecessor-rollback
pass 'known inactive canonical predecessor is adopted recoverably without starting'

HOME_UNKNOWN="$TMP/home-unknown"; mkdir -p "$HOME_UNKNOWN/Library/LaunchAgents"
printf '<plist><dict><key>Label</key><string>tools.theme.oneprompt.converge</string><key>ProgramArguments</key><array><string>/tmp/unknown-writer</string></array></dict></plist>\n' >"$HOME_UNKNOWN/Library/LaunchAgents/tools.theme.oneprompt.converge.plist"
unknown_before="$(shasum -a 256 "$HOME_UNKNOWN/Library/LaunchAgents/tools.theme.oneprompt.converge.plist" | awk '{print $1}')"
if env HOME="$HOME_UNKNOWN" PATH="$BIN_DIR:$NODE_DIR:/usr/bin:/bin" XDG_STATE_HOME="$HOME_UNKNOWN/.local/state" ONEPROMPT_SUPERVISOR_MANAGER=launchd FAKE_MANAGER_STATE="$TMP/unknown-manager" FAKE_MANAGER_CALLS="$TMP/unknown-calls" FAKE_STATE_DB="$HOME_UNKNOWN/.local/state/oneprompt-convergence/state.sqlite" "$TOOL" adopt --repo "$REPO" --machine-interface "$MACHINE" --revision "$REVISION" >/dev/null 2>&1; then fail unknown-canonical-adopted; fi
test "$unknown_before" = "$(shasum -a 256 "$HOME_UNKNOWN/Library/LaunchAgents/tools.theme.oneprompt.converge.plist" | awk '{print $1}')" || fail unknown-canonical-mutated
! grep -Eq 'bootstrap|kickstart|bootout' "$TMP/unknown-calls" 2>/dev/null || fail unknown-canonical-manager-mutation
pass 'unknown canonical definition blocks adoption without mutation'

(cd "$REPO" && npm test -- --maxWorkers=1 --reporter=dot test/convergence/shared-controller-adoption.test.ts)
pass 'shared-controller fixtures fence stale owners and late settlement'
