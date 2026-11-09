#!/usr/bin/env bash
# Manual disposable-host lifecycle canary. It consumes existing public releases
# and writes evidence only; it never publishes, activates, or edits support claims.
set -euo pipefail
umask 077

: "${GITHUB_ACTIONS:?GitHub Actions is required}"
: "${RELEASE_V1:?release_v1 is required}"
: "${RELEASE_V2:?release_v2 is required}"
: "${CANARY_EVIDENCE_ROOT:?evidence root is required}"
: "${CANARY_REPORT:?report path is required}"
: "${CANARY_OFFLINE_BUNDLE_URL:?signed offline bundle URL is required}"
: "${CANARY_OFFLINE_BUNDLE_SHA256:?signed offline bundle digest is required}"
: "${CANARY_OFFLINE_SIGNER_ID:?offline authority signer identity is required}"
: "${CANARY_OFFLINE_SIGNER_PUBLIC_KEY:?offline authority public key is required}"
[ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] || exit 64
case "$RELEASE_V1:$RELEASE_V2" in *[!a-z0-9._:-]*|:*|*:) exit 64;; esac
[ "$RELEASE_V1" != "$RELEASE_V2" ] || exit 64
case "$CANARY_OFFLINE_BUNDLE_SHA256" in *[!a-f0-9]*|'') exit 64;; esac
[ "${#CANARY_OFFLINE_BUNDLE_SHA256}" -eq 64 ] || exit 64
case "$CANARY_OFFLINE_SIGNER_ID" in ''|[!a-z0-9]*|*[!a-z0-9._-]*) exit 64;; esac
case "$CANARY_OFFLINE_SIGNER_PUBLIC_KEY" in 'ssh-ed25519 '[A-Za-z0-9+/]*|'ssh-ed25519 '[A-Za-z0-9+/]*' '*) ;; *) exit 64;; esac
case "$CANARY_OFFLINE_BUNDLE_URL" in "https://desktop.tools/releases/$RELEASE_V2/"*.tar) ;; *) exit 64;; esac

mkdir -p "$CANARY_EVIDENCE_ROOT" "$(dirname "$CANARY_REPORT")"
chmod 0700 "$CANARY_EVIDENCE_ROOT"
readonly BASE=https://desktop.tools/releases
curl_args=(--fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 300 --retry 3 --retry-all-errors)
export HOME="${RUNNER_TEMP:?}/install-doctor-canary-home" USER=canary LOGNAME=canary
mkdir -m 0700 "$HOME"
export HEADLESS_INSTALL=1 SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_ROLE=container INSTALL_DOCTOR_CAPABILITY=minimal
export INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_SELECTED_SERVICES=''
export INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true

for version in v1 v2; do
  variable="RELEASE_${version^^}"; id="${!variable}"
  curl "${curl_args[@]}" --output "$RUNNER_TEMP/start-$version" "$BASE/$id/start"
  curl "${curl_args[@]}" --output "$RUNNER_TEMP/manifest-$version" "$BASE/$id/manifest"
  curl "${curl_args[@]}" --output "$RUNNER_TEMP/manifest-$version.sig" "$BASE/$id/manifest.sig"
  chmod 0700 "$RUNNER_TEMP/start-$version"
  grep -Fxq "release_id=$id" "$RUNNER_TEMP/manifest-$version"
  grep -Fxq "launcher_url=$BASE/$id/start" "$RUNNER_TEMP/manifest-$version"
done
manifest_digest="$(sha256sum "$RUNNER_TEMP/manifest-v2" | awk '{print $1}')"
source_commit="$(sed -n 's/^source_commit=//p' "$RUNNER_TEMP/manifest-v2")"
signer_id="$(sed -n "s/^readonly SIGNER_ID='\([^']*\)'$/\1/p" "$RUNNER_TEMP/start-v2")"
signer_key="$(sed -n "s/^readonly SIGNER_KEY='\([^']*\)'$/\1/p" "$RUNNER_TEMP/start-v2")"
[ -n "$signer_id" ] && [ -n "$signer_key" ] || exit 1
cp "$RUNNER_TEMP/manifest-v2" "$CANARY_EVIDENCE_ROOT/release.manifest"
cp "$RUNNER_TEMP/manifest-v2.sig" "$CANARY_EVIDENCE_ROOT/release.manifest.sig"
printf '%s %s\n' "$signer_id" "$signer_key" >"$CANARY_EVIDENCE_ROOT/release.allowed-signers"
node - "$CANARY_EVIDENCE_ROOT/signed-release.json" "$RELEASE_V2" "$source_commit" "$manifest_digest" "$signer_id" <<'NODE'
const fs=require('node:fs'); const [file,releaseId,sourceCommit,manifestDigest,signerId]=process.argv.slice(2);
fs.writeFileSync(file,JSON.stringify({schemaVersion:1,releaseId,sourceCommit,manifestDigest,signerId,manifestPath:'release.manifest',signaturePath:'release.manifest.sig',allowedSignersPath:'release.allowed-signers'})+'\n',{mode:0o600,flag:'wx'});
NODE

run_start() {
  local version="$1" output="$2"; shift 2
  env "$@" bash "$RUNNER_TEMP/start-$version" >"$output" 2>&1
}
latest_approval() {
  find "$HOME/.local/state/install.doctor/engine/approvals" -type f -name '*.json' -printf '%T@ %f\n' \
    | sort -nr | head -1 | awk '{sub(/\.json$/, "", $2); print $2}'
}

set +e; run_start v1 "$CANARY_EVIDENCE_ROOT/clean-install.log"; status=$?; set -e
[ "$status" -eq 3 ] || exit 1
v1_digest="$(latest_approval)"
run_start v1 "$RUNNER_TEMP/clean-apply.log" INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$v1_digest"
cat "$RUNNER_TEMP/clean-apply.log" >>"$CANARY_EVIDENCE_ROOT/clean-install.log"
printf 'v1_plan=%s\nclean_install=passed\n' "$v1_digest" >>"$CANARY_EVIDENCE_ROOT/clean-install.log"
state="$HOME/.local/state/install.doctor/engine"
clean_run="$(find "$state/runs/$v1_digest" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' | sort -nr | head -1 | awk '{print $2}')"

set +e; run_start v2 "$RUNNER_TEMP/upgrade-plan.log"; status=$?; set -e
[ "$status" -eq 3 ] || exit 1
v2_digest="$(latest_approval)"
[ "$v1_digest" != "$v2_digest" ] || exit 1

set +e
timeout --signal=TERM --kill-after=30s 20s env INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$v2_digest" \
  bash "$RUNNER_TEMP/start-v2" >"$CANARY_EVIDENCE_ROOT/interrupted-resume.log" 2>&1
interrupt_status=$?
set -e
case "$interrupt_status" in 124|143) ;; *) exit 1;; esac
source_run="$(find "$state/runs/$v2_digest" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' | sort -nr | head -1 | awk '{print $2}')"
[ -n "$source_run" ] || { printf 'interruption produced no resumable journal\n' >&2; exit 1; }
run_start v2 "$RUNNER_TEMP/resume.log" INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$v2_digest"
find "$state/runs/$v2_digest/$source_run/commits" -type f -name '*.commit.json' -print -quit | grep -q . \
  || { printf 'resume did not commit the interrupted run\n' >&2; exit 1; }
cat "$RUNNER_TEMP/resume.log" >>"$CANARY_EVIDENCE_ROOT/interrupted-resume.log"
printf 'interrupted_status=%s\nresumed_run=%s\nresume=passed\n' "$interrupt_status" "$source_run" >>"$CANARY_EVIDENCE_ROOT/interrupted-resume.log"
cat "$RUNNER_TEMP/upgrade-plan.log" >"$CANARY_EVIDENCE_ROOT/upgrade.log"
printf 'v1_plan=%s\nv2_plan=%s\nupgrade=passed\n' "$v1_digest" "$v2_digest" >>"$CANARY_EVIDENCE_ROOT/upgrade.log"

home_fingerprint() {
  find "$HOME" -path "$state" -prune -o -type f -print0 | sort -z \
    | xargs -0 -r sha256sum | sha256sum | awk '{print $1}'
}
before_unchanged="$(home_fingerprint)"
run_start v2 "$CANARY_EVIDENCE_ROOT/unchanged-second-run.log" INSTALL_DOCTOR_APPROVED_PLAN_DIGEST="$v2_digest"
after_unchanged="$(home_fingerprint)"
[ "$before_unchanged" = "$after_unchanged" ] || { printf 'unchanged run altered managed home files\n' >&2; exit 1; }
printf 'approved_plan=%s\nhome_fingerprint=%s\nunchanged_second_run=passed\n' "$v2_digest" "$after_unchanged" >>"$CANARY_EVIDENCE_ROOT/unchanged-second-run.log"

engine_url="$(sed -n 's/^engine_url=//p' "$RUNNER_TEMP/manifest-v2")"
engine_sha="$(sed -n 's/^engine_sha256=//p' "$RUNNER_TEMP/manifest-v2")"
curl "${curl_args[@]}" --output "$RUNNER_TEMP/engine.mjs" "$engine_url"
printf '%s  %s\n' "$engine_sha" "$RUNNER_TEMP/engine.mjs" | sha256sum --check --strict >/dev/null

# Prove the release-v2 interactive path independently of the headless lifecycle
# above. Each session gets a fresh home and engine state. The root session uses
# a disposable, explicitly enrolled admin account so the evidence covers the
# real root-to-user handoff without contaminating the runner's normal home.
command -v script >/dev/null 2>&1 || { printf 'util-linux script is required for the interactive canary\n' >&2; exit 79; }
direct_tui_home="$RUNNER_TEMP/desktop-tools-direct-tui-home"
root_tui_suffix="$(printf '%s' "${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}" | sha256sum | cut -c1-12)"
root_tui_user="dtcanary${root_tui_suffix}"
root_tui_home="/home/$root_tui_user"
mkdir -m 0700 "$direct_tui_home"
sudo useradd --create-home --home-dir "$root_tui_home" --shell /bin/bash --groups sudo "$root_tui_user"
sudo chmod 0700 "$root_tui_home"
cleanup_tui_account() { sudo userdel --remove "$root_tui_user" >/dev/null 2>&1 || true; }
trap cleanup_tui_account EXIT

tui_common=(
  SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_ROLE=container INSTALL_DOCTOR_CAPABILITY=minimal
  INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_SELECTED_SERVICES=
  INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false
  INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true INSTALL_DOCTOR_OFFLINE=false TERM=xterm-256color
  INSTALL_DOCTOR_RENDERER=tui
)

approval_for_home() {
  local approval_home="$1"
  sudo find "$approval_home/.local/state/install.doctor/engine/approvals" -type f -name '*.json' -printf '%T@ %f\n' \
    | sort -nr | head -1 | awk '{sub(/\.json$/, "", $2); print $2}'
}

run_tui_plan() {
  local mode="$1" plan_home="$2" plan_user="$3" output="$4" status
  set +e
  if [ "$mode" = direct ]; then
    env -u INSTALL_DOCTOR_APPROVED_PLAN_DIGEST HOME="$plan_home" USER="$plan_user" LOGNAME="$plan_user" \
      HEADLESS_INSTALL=1 INSTALL_DOCTOR_USER="$plan_user" "${tui_common[@]}" \
      bash "$RUNNER_TEMP/start-v2" >"$output" 2>&1
  else
    # The runner owns the diagnostic destination; only the launcher process is elevated.
    # shellcheck disable=SC2024
    sudo env -u INSTALL_DOCTOR_APPROVED_PLAN_DIGEST HOME=/root USER=root LOGNAME=root \
      SUDO_USER="$plan_user" HEADLESS_INSTALL=1 INSTALL_DOCTOR_USER="$plan_user" "${tui_common[@]}" \
      bash "$RUNNER_TEMP/start-v2" >"$output" 2>&1
  fi
  status=$?
  set -e
  [ "$status" -eq 3 ] || { printf '%s interactive planning returned %s\n' "$mode" "$status" >&2; cat "$output" >&2; exit 79; }
}

# Feed the launcher through a real controlling PTY. Cancellation is sent only
# after a complete worker-attribution frame is durable in the transcript.
run_tui_cancel() {
  local mode="$1" session_home="$2" session_user="$3" digest="$4" transcript="$5"
  local wrapper="$6" fifo="$7" stdout="$8" status='' observed=false script_pid writer_fd deadline
  if [ "$mode" = direct ]; then
    printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
      "exec env -u HEADLESS_INSTALL HOME='$session_home' USER='$session_user' LOGNAME='$session_user' INSTALL_DOCTOR_USER='$session_user' INSTALL_DOCTOR_APPROVED_PLAN_DIGEST='$digest' SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_ROLE=container INSTALL_DOCTOR_CAPABILITY=minimal INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_SELECTED_SERVICES='' INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true INSTALL_DOCTOR_OFFLINE=false INSTALL_DOCTOR_RENDERER=tui TERM=xterm-256color bash '$RUNNER_TEMP/start-v2'" >"$wrapper"
  else
    printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' \
      "exec sudo env -u HEADLESS_INSTALL HOME=/root USER=root LOGNAME=root SUDO_USER='$session_user' INSTALL_DOCTOR_USER='$session_user' INSTALL_DOCTOR_APPROVED_PLAN_DIGEST='$digest' SOFTWARE_GROUP=Minimal INSTALL_DOCTOR_ROLE=container INSTALL_DOCTOR_CAPABILITY=minimal INSTALL_DOCTOR_NETWORK=none INSTALL_DOCTOR_CONCURRENCY=2 INSTALL_DOCTOR_SELECTED_SERVICES='' INSTALL_DOCTOR_CONSENT_PRIVILEGED=true INSTALL_DOCTOR_CONSENT_NETWORK=false INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true INSTALL_DOCTOR_OFFLINE=false INSTALL_DOCTOR_RENDERER=tui TERM=xterm-256color bash '$RUNNER_TEMP/start-v2'" >"$wrapper"
  fi
  chmod 0700 "$wrapper"
  mkfifo -m 0600 "$fifo"
  exec {writer_fd}<>"$fifo"
  set +e
  script -q -e -c "$wrapper" "$transcript" <"$fifo" >"$stdout" 2>&1 &
  script_pid=$!
  set -e
  deadline=$((SECONDS + 300))
  while kill -0 "$script_pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do
    if [ -f "$transcript" ] && grep -aEq 'Workers[[:space:]]+[1-9][0-9]* active[[:space:]]+[0-9]+ waiting[[:space:]]+[0-9]+/[0-9]+ done' "$transcript"; then
      observed=true
      printf '\003' >&"$writer_fd"
      break
    fi
    sleep 1
  done
  if [ "$observed" != true ]; then
    printf '\003' >&"$writer_fd" || true
    kill -TERM "$script_pid" 2>/dev/null || true
  fi
  set +e; wait "$script_pid"; status=$?; set -e
  eval "exec ${writer_fd}>&-"
  rm -f -- "$fifo"
  [ "$observed" = true ] || { printf '%s TUI never rendered worker attribution\n' "$mode" >&2; cat "$stdout" >&2; exit 79; }
  [ "$status" -eq 130 ] || { printf '%s TUI status=%s\n' "$mode" "$status" >&2; cat "$stdout" >&2; exit 79; }
  grep -aFq $'\033[?1049h\033[?25l' "$transcript" || { printf '%s TUI did not enter alternate screen\n' "$mode" >&2; exit 79; }
  grep -aFq $'\033[?25h\033[?1049l' "$transcript" || { printf '%s TUI did not restore terminal\n' "$mode" >&2; exit 79; }
  grep -aFq 'DESKTOP TOOLS' "$transcript" || { printf '%s TUI lacks Desktop Tools identity\n' "$mode" >&2; exit 79; }
}

export_tui_authority() {
  local label="$1" session_home="$2" transcript="$3" digest="$4" exit_status=130
  local session_state="$session_home/.local/state/install.doctor/engine"
  local runs_list="$CANARY_EVIDENCE_ROOT/$label.runs-list.json"
  local authority_name="$label.uncommitted-authority"
  local authority_root="$CANARY_EVIDENCE_ROOT/$authority_name"
  local invocation="$RUNNER_TEMP/$label-runs-list-invocation.json"
  printf '{"schemaVersion":1,"command":"runs-list","stateRoot":"%s"}\n' "$session_state" >"$invocation"
  local node_command=(node) state_owner
  state_owner="$(sudo stat -c '%u' "$session_state")"
  if [ "$state_owner" != "$(id -u)" ]; then node_command=(sudo node); fi
  "${node_command[@]}" "$RUNNER_TEMP/engine.mjs" --input "$invocation" >"$runs_list"
  "${node_command[@]}" - "$runs_list" "$session_state" "$authority_root" "$RELEASE_V2" "$digest" <<'NODE'
const fs=require('node:fs'),path=require('node:path');
const [runsPath,stateRoot,outputRoot,releaseId,planDigest]=process.argv.slice(2);
const report=JSON.parse(fs.readFileSync(runsPath));
const matches=report.runs.filter(run=>run.planDigest===planDigest&&run.releaseId===releaseId&&run.authority==='uncommitted'&&run.resumeCandidate===true&&run.taskCounts?.interrupted>0);
if(matches.length!==1)throw new Error(`expected one resumable interrupted TUI run, found ${matches.length}`);
const run=matches[0],source=path.join(stateRoot,'runs',planDigest,run.runId),target=path.join(outputRoot,'runs',planDigest,run.runId);
if(fs.existsSync(path.join(source,'owner.json')))throw new Error('interrupted TUI run retained a live owner');
const commits=path.join(source,'commits');if(!fs.statSync(commits).isDirectory()||fs.readdirSync(commits).length!==0)throw new Error('interrupted TUI run has commit authority');
const heads=fs.readdirSync(path.join(source,'heads')).filter(name=>/^\d{16}-[a-f0-9]{64}\.json$/.test(name)).sort();
if(heads.length<1)throw new Error('interrupted TUI run has no journal head');
const headBytes=fs.readFileSync(path.join(source,'heads',heads.at(-1))),head=JSON.parse(headBytes);
const objectBytes=fs.readFileSync(path.join(source,'objects','sha256',`${head.journalDigest}.json`));
fs.mkdirSync(path.join(target,'commits'),{recursive:true,mode:0o700});
for(const [name,bytes] of [['plan.json',fs.readFileSync(path.join(source,'plan.json'))],['journal-head.json',headBytes],['journal-object.json',objectBytes]])fs.writeFileSync(path.join(target,name),bytes,{mode:0o600,flag:'wx'});
process.stdout.write(`${run.runId}\n`);
NODE
  if [ "${node_command[0]}" = sudo ]; then
    sudo chown -R "$(id -u):$(id -g)" "$authority_root"
  fi
  local run_id transcript_digest runs_digest
  run_id="$(node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1]));const m=r.runs.filter(v=>v.planDigest===process.argv[2]&&v.releaseId===process.argv[3]&&v.authority==="uncommitted"&&v.resumeCandidate===true&&v.taskCounts.interrupted>0);if(m.length!==1)process.exit(1);process.stdout.write(m[0].runId)' "$runs_list" "$digest" "$RELEASE_V2")"
  transcript_digest="$(sha256sum "$transcript" | awk '{print $1}')"
  runs_digest="$(sha256sum "$runs_list" | awk '{print $1}')"
  node - "$RUNNER_TEMP/$label-session.json" "$(basename "$transcript")" "$transcript_digest" "$exit_status" "$(basename "$runs_list")" "$runs_digest" "$authority_name" "$run_id" "$digest" <<'NODE'
const fs=require('node:fs');const [file,transcriptPath,transcriptDigest,exitStatus,runsListPath,runsListDigest,authorityRoot,runId,planDigest]=process.argv.slice(2);
fs.writeFileSync(file,JSON.stringify({transcriptPath,transcriptDigest,exitStatus:Number(exitStatus),runsListPath,runsListDigest,authorityRoot,runId,planDigest})+'\n',{mode:0o600,flag:'wx'});
NODE
}

run_tui_resume_success() {
  local mode="$1" wrapper="$2" transcript="$3" stdout="$4" status
  set +e
  script -q -e -c "$wrapper" "$transcript" </dev/null >"$stdout" 2>&1
  status=$?
  set -e
  [ "$status" -eq 0 ] || { printf '%s resumed TUI status=%s\n' "$mode" "$status" >&2; cat "$stdout" >&2; exit 79; }
  grep -aFq $'\033[?1049h\033[?25l' "$transcript" || { printf '%s resumed TUI did not enter alternate screen\n' "$mode" >&2; exit 79; }
  grep -aFq $'\033[?25h\033[?1049l' "$transcript" || { printf '%s resumed TUI did not restore terminal\n' "$mode" >&2; exit 79; }
  grep -aFq 'DESKTOP TOOLS' "$transcript" || { printf '%s resumed TUI lacks Desktop Tools identity\n' "$mode" >&2; exit 79; }
}

export_tui_completion() {
  local label="$1" session_home="$2" transcript="$3" digest="$4"
  local session_state="$session_home/.local/state/install.doctor/engine"
  local run_id authority_name="$label.committed-authority" authority_root="$CANARY_EVIDENCE_ROOT/$label.committed-authority"
  run_id="$(node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1]));process.stdout.write(r.runId)' "$RUNNER_TEMP/$label-session.json")"
  local run_root="$session_state/runs/$digest/$run_id" commit
  commit="$(sudo find "$run_root/commits" -type f -name '*.commit.json' -print -quit)"
  [ -n "$commit" ] || { printf '%s resumed TUI produced no commit authority\n' "$label" >&2; exit 79; }
  sudo node - "$commit" "$run_root" "$authority_root" "$run_id" "$digest" <<'NODE'
const fs=require('node:fs'),path=require('node:path');
const [source,runRoot,outputRoot,runId,planDigest]=process.argv.slice(2);
for(const directory of ['compensations','native','journal-objects','journal-heads'])fs.mkdirSync(path.join(outputRoot,directory),{recursive:true,mode:0o700});
const withinRun=value=>{const resolved=fs.realpathSync(value),root=fs.realpathSync(runRoot);if(!resolved.startsWith(`${root}${path.sep}`))throw new Error('TUI commit artifact escaped run root');return resolved;};
const copy=(sourcePath,destination)=>{const sourceFile=withinRun(sourcePath),target=path.join(outputRoot,destination);const bytes=fs.readFileSync(sourceFile);fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});};
const commit=JSON.parse(fs.readFileSync(source));if(commit.runId!==runId||commit.planDigest!==planDigest)throw new Error('resumed TUI commit identity mismatch');
fs.copyFileSync(source,path.join(outputRoot,'commit.json'));copy(path.join(runRoot,'terminal-authority.json'),'terminal-authority.json');
for(const [field,name] of [['planArtifact','plan.json'],['journalObject','journal-object.json'],['journalHead','journal-head.json'],['events','events.ndjson'],['receipt','receipt.json']])copy(commit[field].path,name);
for(const name of fs.readdirSync(path.join(runRoot,'objects','sha256')).sort())copy(path.join(runRoot,'objects','sha256',name),`journal-objects/${name}`);
for(const name of fs.readdirSync(path.join(runRoot,'heads')).sort())copy(path.join(runRoot,'heads',name),`journal-heads/${name}`);
if(commit.compensationIndex){copy(commit.compensationIndex.path,'compensation-index.json');const index=JSON.parse(fs.readFileSync(commit.compensationIndex.path));for(const artifact of index.artifacts)copy(artifact.path,`compensations/${path.basename(artifact.path)}`);}
if(commit.nativeTransactionIndex){copy(commit.nativeTransactionIndex.path,'native-transaction-index.json');const index=JSON.parse(fs.readFileSync(commit.nativeTransactionIndex.path));for(const artifact of index.objects)copy(artifact.path,`native/${path.basename(artifact.path)}`);for(const transaction of index.transactions){copy(transaction.current.path,`native/${path.basename(transaction.current.path)}`);copy(transaction.record.path,`native/${path.basename(transaction.record.path)}`);}}
NODE
  sudo chown -R "$(id -u):$(id -g)" "$authority_root"
  local transcript_digest authority_digest
  transcript_digest="$(sha256sum "$transcript" | awk '{print $1}')"
  authority_digest="$(sha256sum "$authority_root/commit.json" | awk '{print $1}')"
  node - "$RUNNER_TEMP/$label-session.json" "$(basename "$transcript")" "$transcript_digest" "$authority_name" "$authority_digest" <<'NODE'
const fs=require('node:fs');const [file,transcriptPath,transcriptDigest,authorityRoot,authorityDigest]=process.argv.slice(2);const value=JSON.parse(fs.readFileSync(file));
value.completion={transcriptPath,transcriptDigest,exitStatus:0,authority:{schemaVersion:2,runId:value.runId,planDigest:value.planDigest,authorityRoot,executionMode:'online',beforeFingerprint:'',afterFingerprint:''},authorityDigest};
fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600});
NODE
}

direct_tui_user="$(id -un)"
run_tui_plan direct "$direct_tui_home" "$direct_tui_user" "$RUNNER_TEMP/direct-tui-plan.log"
direct_tui_digest="$(approval_for_home "$direct_tui_home")"
run_tui_cancel direct "$direct_tui_home" "$direct_tui_user" "$direct_tui_digest" \
  "$CANARY_EVIDENCE_ROOT/direct-user-tui.typescript" "$RUNNER_TEMP/direct-tui-wrapper" \
  "$RUNNER_TEMP/direct-tui.stdin" "$RUNNER_TEMP/direct-tui.stdout"
export_tui_authority direct-user-tui "$direct_tui_home" "$CANARY_EVIDENCE_ROOT/direct-user-tui.typescript" "$direct_tui_digest"
run_tui_resume_success direct "$RUNNER_TEMP/direct-tui-wrapper" "$CANARY_EVIDENCE_ROOT/direct-user-tui-resumed.typescript" "$RUNNER_TEMP/direct-tui-resumed.stdout"
export_tui_completion direct-user-tui "$direct_tui_home" "$CANARY_EVIDENCE_ROOT/direct-user-tui-resumed.typescript" "$direct_tui_digest"

run_tui_plan root "$root_tui_home" "$root_tui_user" "$RUNNER_TEMP/root-tui-plan.log"
root_tui_digest="$(approval_for_home "$root_tui_home")"
run_tui_cancel root "$root_tui_home" "$root_tui_user" "$root_tui_digest" \
  "$CANARY_EVIDENCE_ROOT/root-handoff-tui.typescript" "$RUNNER_TEMP/root-tui-wrapper" \
  "$RUNNER_TEMP/root-tui.stdin" "$RUNNER_TEMP/root-tui.stdout"
export_tui_authority root-handoff-tui "$root_tui_home" "$CANARY_EVIDENCE_ROOT/root-handoff-tui.typescript" "$root_tui_digest"
run_tui_resume_success root "$RUNNER_TEMP/root-tui-wrapper" "$CANARY_EVIDENCE_ROOT/root-handoff-tui-resumed.typescript" "$RUNNER_TEMP/root-tui-resumed.stdout"
export_tui_completion root-handoff-tui "$root_tui_home" "$CANARY_EVIDENCE_ROOT/root-handoff-tui-resumed.typescript" "$root_tui_digest"

node - "$CANARY_EVIDENCE_ROOT/interactive-tui.json" "$RUNNER_TEMP/direct-user-tui-session.json" "$RUNNER_TEMP/root-handoff-tui-session.json" "$RELEASE_V2" "$source_commit" "$manifest_digest" <<'NODE'
const fs=require('node:fs');const [output,directPath,rootPath,releaseId,sourceCommit,manifestDigest]=process.argv.slice(2);
const directUser=JSON.parse(fs.readFileSync(directPath)),rootHandoff=JSON.parse(fs.readFileSync(rootPath));
if(directUser.runId===rootHandoff.runId)throw new Error('interactive sessions reused a run identity');
fs.writeFileSync(output,JSON.stringify({schemaVersion:1,release:{releaseId,sourceCommit,manifestDigest},directUser,rootHandoff})+'\n',{mode:0o600,flag:'wx'});
NODE

node -e 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({schemaVersion:1,command:"rollback-config-plan",stateRoot:process.argv[2],sourceRunId:process.argv[3],sourcePlanDigest:process.argv[4]})+"\n",{mode:384})' \
  "$RUNNER_TEMP/rollback-plan.json" "$state" "$source_run" "$v2_digest"
node "$RUNNER_TEMP/engine.mjs" --input "$RUNNER_TEMP/rollback-plan.json" >"$RUNNER_TEMP/rollback-derived.json"
rollback_digest="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1])).digest)' "$RUNNER_TEMP/rollback-derived.json")"
node -e 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({schemaVersion:1,command:"rollback-config-execute",stateRoot:process.argv[2],sourceRunId:process.argv[3],sourcePlanDigest:process.argv[4],rollbackRunId:process.argv[5],approvedPlanDigest:process.argv[6]})+"\n",{mode:384})' \
  "$RUNNER_TEMP/rollback-execute.json" "$state" "$source_run" "$v2_digest" "canary-${GITHUB_RUN_ID}" "$rollback_digest"
node "$RUNNER_TEMP/engine.mjs" --input "$RUNNER_TEMP/rollback-execute.json" >"$CANARY_EVIDENCE_ROOT/config-rollback.log"
printf 'source_run=%s\nrollback_plan=%s\nconfig_rollback=passed\n' "$source_run" "$rollback_digest" >>"$CANARY_EVIDENCE_ROOT/config-rollback.log"

export_install_authority() {
  local label="$1" run_id="$2" plan_digest="$3" execution_mode="$4" before="${5:-}" after="${6:-}"
  local run_root="$state/runs/$plan_digest/$run_id" commit
  commit="$(find "$run_root/commits" -type f -name '*.commit.json' -print -quit)"
  [ -n "$commit" ] || return 1
  node - "$commit" "$run_root" "$CANARY_EVIDENCE_ROOT" "$label" "$run_id" "$plan_digest" "$execution_mode" "$before" "$after" <<'NODE'
const fs=require('node:fs'); const path=require('node:path');
const [source,runRoot,evidenceRoot,label,runId,planDigest,executionMode,beforeFingerprint,afterFingerprint]=process.argv.slice(2);
const authorityRoot=`${label}.authority`; const outputRoot=path.join(evidenceRoot,authorityRoot);
for(const directory of ['compensations','native','journal-objects','journal-heads'])fs.mkdirSync(path.join(outputRoot,directory),{recursive:true,mode:0o700});
const withinRun=value=>{const resolved=fs.realpathSync(value),root=fs.realpathSync(runRoot);if(!resolved.startsWith(`${root}${path.sep}`))throw new Error('commit artifact escaped run root');return resolved;};
const copy=(sourcePath,destination)=>{const sourceFile=withinRun(sourcePath),target=path.join(outputRoot,destination);const bytes=fs.readFileSync(sourceFile);if(fs.existsSync(target)){if(!fs.readFileSync(target).equals(bytes))throw new Error('authority artifact collision');return;}fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});};
const commit=JSON.parse(fs.readFileSync(source));
if(commit.runId!==runId||commit.planDigest!==planDigest)throw new Error('commit identity mismatch');
fs.copyFileSync(source,path.join(outputRoot,'commit.json'));
copy(path.join(runRoot,'terminal-authority.json'),'terminal-authority.json');
for(const [field,name] of [['planArtifact','plan.json'],['journalObject','journal-object.json'],['journalHead','journal-head.json'],['events','events.ndjson'],['receipt','receipt.json']])copy(commit[field].path,name);
for(const name of fs.readdirSync(path.join(runRoot,'objects','sha256')).sort())copy(path.join(runRoot,'objects','sha256',name),`journal-objects/${name}`);
for(const name of fs.readdirSync(path.join(runRoot,'heads')).sort())copy(path.join(runRoot,'heads',name),`journal-heads/${name}`);
if(commit.compensationIndex){copy(commit.compensationIndex.path,'compensation-index.json');const index=JSON.parse(fs.readFileSync(commit.compensationIndex.path));for(const artifact of index.artifacts)copy(artifact.path,`compensations/${path.basename(artifact.path)}`);}
if(commit.nativeTransactionIndex){copy(commit.nativeTransactionIndex.path,'native-transaction-index.json');const index=JSON.parse(fs.readFileSync(commit.nativeTransactionIndex.path));for(const artifact of index.objects)copy(artifact.path,`native/${path.basename(artifact.path)}`);for(const transaction of index.transactions){copy(transaction.current.path,`native/${path.basename(transaction.current.path)}`);copy(transaction.record.path,`native/${path.basename(transaction.record.path)}`);}}
fs.writeFileSync(path.join(evidenceRoot,`${label}.json`),JSON.stringify({schemaVersion:2,runId,planDigest,authorityRoot,executionMode,beforeFingerprint,afterFingerprint})+'\n',{mode:0o600,flag:'wx'});
NODE
}
export_install_authority clean-install "$clean_run" "$v1_digest" online
export_install_authority upgrade "$source_run" "$v2_digest" online
cp "$CANARY_EVIDENCE_ROOT/upgrade.json" "$CANARY_EVIDENCE_ROOT/interrupted-resume.json"
node - "$CANARY_EVIDENCE_ROOT/interrupted-resume.json" "$interrupt_status" <<'NODE'
const fs=require('node:fs'); const file=process.argv[2]; const value=JSON.parse(fs.readFileSync(file)); value.interruptedRunId=value.runId; value.interruptStatus=Number(process.argv[3]); fs.writeFileSync(file,JSON.stringify(value)+'\n');
NODE
unchanged_run="$(find "$state/runs/$v2_digest" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' | sort -nr | head -1 | awk '{print $2}')"
export_install_authority unchanged-second-run "$unchanged_run" "$v2_digest" online "$before_unchanged" "$after_unchanged"

# Download and materialize the already-signed release-bound bundle while the
# canary is online. Execution happens later in a distinct root-created network
# namespace with every ambient capability removed from the non-root process.
offline_archive="$RUNNER_TEMP/offline-bundle.tar"
offline_unpack="$RUNNER_TEMP/offline-bundle-unpacked"
offline_entries="$RUNNER_TEMP/offline-bundle.entries"
mkdir -m 0700 "$offline_unpack"
curl "${curl_args[@]}" --max-filesize 1073741824 --output "$offline_archive" "$CANARY_OFFLINE_BUNDLE_URL"
printf '%s  %s\n' "$CANARY_OFFLINE_BUNDLE_SHA256" "$offline_archive" | sha256sum --check --strict >/dev/null
tar -tf "$offline_archive" >"$offline_entries"
[ "$(wc -l <"$offline_entries")" -le 10000 ] || { printf 'offline bundle archive contains too many entries\n' >&2; exit 1; }
[ -z "$(LC_ALL=C sort "$offline_entries" | uniq -d)" ] || { printf 'offline bundle archive contains duplicate paths\n' >&2; exit 1; }
if tar --numeric-owner -tvf "$offline_archive" | awk '$1 ~ /^[lhbcp]/ { special=1 } { size += $3 } END { exit !(special || size > 1073741824) }'; then
  printf 'offline bundle archive contains a link, special file, or oversized expansion\n' >&2; exit 1
fi
while IFS= read -r archive_path; do
  case "$archive_path" in
    ''|/*|./*|../*|*/../*|*/..|*/./*|*//*|*$'\n'*|*$'\r'*)
      printf 'offline bundle archive contains an unsafe path\n' >&2; exit 1 ;;
  esac
done <"$offline_entries"
tar --extract --file "$offline_archive" --directory "$offline_unpack" --no-same-owner --no-same-permissions
offline_bundle="$(find "$offline_unpack" -mindepth 1 -maxdepth 1 -type d -name '[a-f0-9]*' -print -quit)"
[ -n "$offline_bundle" ] && [ "$(find "$offline_unpack" -mindepth 1 -maxdepth 1 -print | wc -l)" -eq 1 ] || exit 1
offline_manifest_digest="$(basename "$offline_bundle")"
case "$offline_manifest_digest" in *[!a-f0-9]*|'') exit 1;; esac
[ "${#offline_manifest_digest}" -eq 64 ] || exit 1

offline_run="offline-${GITHUB_RUN_ID}"
offline_state="$HOME/.local/state/install.doctor/offline-engine"
offline_materialized="$RUNNER_TEMP/offline-materialized"
offline_invocation="$CANARY_EVIDENCE_ROOT/offline-invocation.json"
offline_isolation_raw="$RUNNER_TEMP/offline-isolation"
mkdir -m 0700 "$offline_state" "$offline_isolation_raw"
node - "$offline_bundle/manifest.json" "$offline_invocation" "$offline_bundle" "$offline_materialized" "$offline_state" "$offline_run" "$offline_manifest_digest" "$CANARY_OFFLINE_SIGNER_ID" "$CANARY_OFFLINE_SIGNER_PUBLIC_KEY" "$signer_id" "$signer_key" <<'NODE'
const fs=require('node:fs');const [manifestPath,output,bundleDirectory,materializedRoot,stateRoot,runId,manifestDigest,offlineKeyId,offlinePublicKey,releaseKeyId,releasePublicKey]=process.argv.slice(2);const manifest=JSON.parse(fs.readFileSync(manifestPath));if(manifest.signature?.keyId!==offlineKeyId)throw new Error('offline bundle signer differs from independently supplied offline authority');const expected={releaseId:manifest.releaseId,planDigest:manifest.planDigest,platform:manifest.platform,selectedTaskIds:manifest.selectedTaskIds,artifactIds:manifest.artifacts.map(item=>item.id).sort()};const trust={keyId:offlineKeyId,publicKey:offlinePublicKey};const releaseTrust={keyId:releaseKeyId,publicKey:releasePublicKey};const invocation={schemaVersion:2,command:'bundle-execute',runId,bundleDirectory,materializedRoot,stateRoot,trust,releaseTrust,expected,approvedManifestDigest:manifestDigest,approvedPlanDigest:manifest.planDigest,renderer:'ndjson',offline:true,networkPolicy:'deny'};fs.writeFileSync(output,JSON.stringify(invocation)+'\n',{mode:0o600,flag:'wx'});
NODE

parent_namespace="$(readlink /proc/self/ns/net)"
canary_uid="$(id -u)"; canary_gid="$(id -g)"
sudo unshare --net --mount-proc bash -s -- "$canary_uid" "$canary_gid" "$offline_isolation_raw" "$RUNNER_TEMP/engine.mjs" "$offline_invocation" <<'SH'
set -euo pipefail
uid="$1" gid="$2" evidence="$3" engine="$4" invocation="$5"
umask 022
date -u +%Y-%m-%dT%H:%M:%S.%3NZ >"$evidence/started-at"
readlink /proc/self/ns/net >"$evidence/namespace"
if awk 'NR>1 && $2 == "00000000" { found=1 } END { exit !found }' /proc/net/route; then printf true >"$evidence/default-route"; else printf false >"$evidence/default-route"; fi
find /sys/class/net -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort >"$evidence/interfaces"
set +e
getent hosts desktop.tools >/dev/null 2>&1; dns_status=$?
node -e 'const n=require("node:net");const s=n.connect({host:"1.1.1.1",port:443,timeout:500},()=>process.exit(0));s.on("error",()=>process.exit(1));s.on("timeout",()=>process.exit(1))'; tcp_status=$?
set -e
printf '%s\n' "$dns_status" >"$evidence/dns-status"; printf '%s\n' "$tcp_status" >"$evidence/tcp-status"
set +e
setpriv --reuid="$uid" --regid="$gid" --clear-groups --bounding-set=-all --no-new-privs -- \
  node "$engine" --input "$invocation" >"$evidence/execution.ndjson" 2>"$evidence/execution.stderr"
status=$?
set -e
date -u +%Y-%m-%dT%H:%M:%S.%3NZ >"$evidence/finished-at"
printf '%s\n' "$status" >"$evidence/exit-code"
chmod 0644 "$evidence"/*
exit "$status"
SH

offline_plan_digest="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1])).approvedPlanDigest)' "$offline_invocation")"
offline_commit="$(find "$offline_state/runs/$offline_plan_digest/$offline_run/commits" -type f -name '*.commit.json' -print -quit)"
[ -n "$offline_commit" ] || exit 1
online_state="$state"; state="$offline_state"
export_install_authority offline-execution "$offline_run" "$offline_plan_digest" offline
state="$online_state"

cp "$offline_bundle/manifest.json" "$CANARY_EVIDENCE_ROOT/offline-bundle.manifest.json"
cp "$offline_bundle/manifest.sig" "$CANARY_EVIDENCE_ROOT/offline-bundle.manifest.json.sig"
printf '%s %s\n' "$CANARY_OFFLINE_SIGNER_ID" "$CANARY_OFFLINE_SIGNER_PUBLIC_KEY" >"$CANARY_EVIDENCE_ROOT/offline-bundle.allowed-signers"
node - "$CANARY_EVIDENCE_ROOT/offline-execution.json" "$CANARY_EVIDENCE_ROOT/offline-network-isolation.json" "$offline_invocation" "$offline_isolation_raw" "$parent_namespace" "$offline_manifest_digest" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const [phasePath,isolationPath,invocationPath,raw,parentNamespaceId,manifestDigest]=process.argv.slice(2);const phase=JSON.parse(fs.readFileSync(phasePath));const invocationBytes=fs.readFileSync(invocationPath);const read=name=>fs.readFileSync(path.join(raw,name),'utf8').trim();const interfaces=read('interfaces').split('\n').filter(Boolean);const isolation={schemaVersion:1,kind:'linux-network-namespace',runId:phase.runId,planDigest:phase.planDigest,bundleManifestDigest:manifestDigest,invocationDigest:crypto.createHash('sha256').update(invocationBytes).digest('hex'),parentNamespaceId,executionNamespaceId:read('namespace'),defaultRoutePresent:read('default-route')==='true',loopbackOnly:interfaces.every(name=>name==='lo'),dnsProbe:Number(read('dns-status'))===0?'reachable':'denied',tcpProbe:Number(read('tcp-status'))===0?'reachable':'denied',startedAt:read('started-at'),finishedAt:read('finished-at'),exitCode:Number(read('exit-code'))};const receipt=JSON.parse(fs.readFileSync(path.join(path.dirname(phasePath),phase.authorityRoot,'receipt.json')));if(Date.parse(isolation.startedAt)>Date.parse(receipt.startedAt)||Date.parse(isolation.finishedAt)<Date.parse(receipt.finishedAt))throw new Error('network isolation does not bracket the committed receipt');fs.writeFileSync(isolationPath,JSON.stringify(isolation)+'\n',{mode:0o600,flag:'wx'});phase.offlineBundle={manifestPath:'offline-bundle.manifest.json',signaturePath:'offline-bundle.manifest.json.sig',allowedSignersPath:'offline-bundle.allowed-signers',signerId:JSON.parse(fs.readFileSync(path.join(path.dirname(phasePath),'offline-bundle.manifest.json'))).signature.keyId,manifestDigest};phase.networkIsolation={evidencePath:'offline-network-isolation.json',invocationPath:'offline-invocation.json'};fs.writeFileSync(phasePath,JSON.stringify(phase)+'\n');
NODE
rollback_commit="$(find "$state/rollback-runs/$rollback_digest/canary-${GITHUB_RUN_ID}/commits" -type f -name '*.json' -print -quit)"
node - "$rollback_commit" "$CANARY_EVIDENCE_ROOT" "$rollback_digest" <<'NODE'
const fs=require('node:fs');const path=require('node:path');const [source,evidenceRoot,planDigest]=process.argv.slice(2);const commit=JSON.parse(fs.readFileSync(source));const authorityRoot='config-rollback.authority',root=path.join(evidenceRoot,authorityRoot);fs.mkdirSync(path.join(root,'events'),{recursive:true,mode:0o700});fs.copyFileSync(source,path.join(root,'commit.json'));fs.copyFileSync(commit.plan.path,path.join(root,'plan.json'));fs.copyFileSync(commit.receipt.path,path.join(root,'receipt.json'));commit.events.forEach((event,index)=>fs.copyFileSync(event.path,path.join(root,'events',`${String(index).padStart(8,'0')}.json`)));fs.writeFileSync(path.join(evidenceRoot,'config-rollback.json'),JSON.stringify({schemaVersion:2,rollbackRunId:commit.rollbackRunId,planDigest,authorityRoot})+'\n',{mode:0o600,flag:'wx'});
NODE

observed_id="$(. /etc/os-release; printf '%s' "$ID")"; observed_version="$(. /etc/os-release; printf '%s' "$VERSION_ID")"
[ "$observed_id" = debian ] && [ "${observed_version%%.*}" = 12 ] || exit 1
observed_machine="$(uname -m)"; [ "$observed_machine" = x86_64 ] && [ -f /.dockerenv ] || exit 1
observed_os=Debian observed_version="${observed_version%%.*}" observed_arch=x64 observed_environment=container observed_role=debian

node - "$CANARY_REPORT" "$RELEASE_V2" "$source_commit" "$manifest_digest" "$observed_os" "$observed_version" "$observed_arch" "$observed_environment" "$observed_role" <<'NODE'
const fs = require('node:fs'); const [file, releaseId, sourceCommit, manifestDigest, os, version, arch, environment, role] = process.argv.slice(2);
const paths={cleanInstall:'clean-install.json',signedRelease:'signed-release.json',upgrade:'upgrade.json',interruptedResume:'interrupted-resume.json',unchangedSecondRun:'unchanged-second-run.json',offlineExecution:'offline-execution.json',configRollback:'config-rollback.json',interactiveTui:'interactive-tui.json'};
const phases=Object.fromEntries(Object.entries(paths).map(([name,path])=>[name,{result:'passed',path}]));
const observed={os,version,arch,environment,role};
fs.writeFileSync(file,`${JSON.stringify({schemaVersion:3,cellId:'debian-12-x64-container',observed,release:{releaseId,sourceCommit,manifestDigest},disposable:true,hermetic:false,phases})}\n`,{mode:0o600,flag:'wx'});
NODE
