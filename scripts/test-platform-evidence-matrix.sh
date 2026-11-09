#!/usr/bin/env bash
# B09: platform claims must be machine-readable and evidence-backed.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MATRIX="$ROOT/scripts/platform-support-matrix.json"
VALIDATOR="$ROOT/scripts/validate-platform-support-matrix.mjs"
FINALIZER="$ROOT/scripts/finalize-platform-canary-receipt.mjs"
STAGER="$ROOT/scripts/stage-platform-promotion.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if node "$VALIDATOR" "$MATRIX"; then pass 'authoritative platform matrix validates'; else fail 'authoritative platform matrix is invalid'; fi

if node - "$MATRIX" <<'NODE'
const fs = require('node:fs');
const matrix = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const roles = new Set(matrix.cells.map(cell => cell.role));
for (const role of ['macos','ubuntu','debian','fedora','silverblue','alpine','arch','qubes-dom0','qubes-appvm','proxmox','coolify','wsl','container']) {
  if (!roles.has(role)) process.exit(1);
}
for (const cell of matrix.cells.filter(cell => cell.status === 'verified')) {
  if (!cell.evidence.some(item => item.kind === 'canary-receipt')) process.exit(2);
}
NODE
then
  pass 'all fleet roles are explicit and every present verified claim names canary evidence'
else
  fail 'fleet-role coverage is incomplete or fabricates verification'
fi

# Promotion without a current passing canary must fail.
node - "$MATRIX" "$TMP/no-canary.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.cells[0].status = 'verified';
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
if node "$VALIDATOR" "$TMP/no-canary.json" >/dev/null 2>&1; then fail 'verified claim without canary was accepted'; else pass 'verified claim requires a canary receipt'; fi

# Build one syntactically valid real-host receipt fixture. This proves the gate
# conditionally rather than permanently requiring the verified count to be zero.
mkdir -p "$TMP/evidence/receipts"
node - "$MATRIX" "$TMP/evidence/matrix.json" "$TMP/evidence/receipts/canary.json" <<'NODE'
const fs = require('node:fs'); const crypto = require('node:crypto');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cell = value.cells[0];
value.cells = [cell];
cell.status = 'verified';
cell.evidence = [{ kind: 'canary-receipt', path: 'receipts/canary.json' }];
const installPhase=(executionMode='online',mutatedTaskIds=['task.one'],interruptedTaskIds=[],planDigest='a'.repeat(64))=>({result:'passed',evidenceDigest:'e'.repeat(64),authorityDigest:'f'.repeat(64),runId:'run-one',planDigest,executionMode,selectedTaskIds:['task.one'],attemptedTaskIds:mutatedTaskIds,mutatedTaskIds,interruptedTaskIds,postconditions:{'task.one':'verified'},serviceRestoration:{requiredTaskIds:[],restoredTaskIds:[]},...(executionMode==='offline'?{offlineBundle:{manifestDigest:'1'.repeat(64),bundleSignerId:'bundle-key',invocationDigest:'2'.repeat(64),networkIsolation:{kind:'linux-network-namespace',parentNamespaceId:'net:[1]',executionNamespaceId:'net:[2]',startedAt:'2026-11-05T12:00:00.000Z',finishedAt:'2026-11-05T12:01:00.000Z'}}}:{})});
const receipt = {
  schemaVersion: 3, receiptId: 'test-real-host-canary', evidenceClass: 'real-host-canary', scope: 'full-lifecycle', cellId: cell.id,
  tuple: Object.fromEntries(['os','version','arch','environment','role'].map(key => [key, cell[key]])),
  release: { releaseId: 'release-test', sourceCommit: 'a'.repeat(40), manifestDigest: 'b'.repeat(64) }, result: 'passed',
  recordedAt: new Date().toISOString(),
  coverage: ['stage-zero','plan','apply','verify','unchanged-reapply','interrupted-resume','config-rollback','headless','interactive-tui','offline'],
  proof: { provider: 'github-actions', runnerEnvironment: 'github-hosted', disposable: true, hermetic: false,
    workflowCommit: 'c'.repeat(40), workflowRunId: '12345', evidenceDigest: 'd'.repeat(64),
    phases: {cleanInstall:installPhase(),signedRelease:{result:'passed',evidenceDigest:'e'.repeat(64)},upgrade:installPhase(),interruptedResume:installPhase('online',['task.one'],['task.one']),unchangedSecondRun:installPhase('online',[]),offlineExecution:installPhase('offline',[],[],'b'.repeat(64)),configRollback:{result:'passed',evidenceDigest:'e'.repeat(64),authorityDigest:'f'.repeat(64),rollbackRunId:'rollback-one',planDigest:'c'.repeat(64),restoredTaskIds:['task.one']},interactiveTui:{result:'passed',evidenceDigest:'e'.repeat(64),releaseId:'release-test',sourceCommit:'a'.repeat(40),manifestDigest:'b'.repeat(64),directUser:{transcriptDigest:'1'.repeat(64),runsListDigest:'2'.repeat(64),planArtifactDigest:'3'.repeat(64),journalHeadDigest:'4'.repeat(64),journalObjectDigest:'5'.repeat(64),exitStatus:130,altScreenEntered:true,terminalRestored:true,desktopToolsIdentity:true,workerAttribution:true,runId:'direct-run',planDigest:'6'.repeat(64),resumeCandidate:true,completionTranscriptDigest:'d'.repeat(64),completionAuthorityDigest:'e'.repeat(64),completionExitStatus:0,completionAltScreenEntered:true,completionTerminalRestored:true,completionDesktopToolsIdentity:true,completionRunId:'direct-run',completionPlanDigest:'6'.repeat(64),completionStatus:'success'},rootHandoff:{transcriptDigest:'7'.repeat(64),runsListDigest:'8'.repeat(64),planArtifactDigest:'9'.repeat(64),journalHeadDigest:'a'.repeat(64),journalObjectDigest:'b'.repeat(64),exitStatus:130,altScreenEntered:true,terminalRestored:true,desktopToolsIdentity:true,workerAttribution:true,runId:'root-run',planDigest:'c'.repeat(64),resumeCandidate:true,completionTranscriptDigest:'d'.repeat(64),completionAuthorityDigest:'e'.repeat(64),completionExitStatus:0,completionAltScreenEntered:true,completionTerminalRestored:true,completionDesktopToolsIdentity:true,completionRunId:'root-run',completionPlanDigest:'c'.repeat(64),completionStatus:'success'}}} },
  promotion:{schemaVersion:1,verifier:'independent-offline-authority',canaryDigest:'1'.repeat(64),promotionDigest:'2'.repeat(64),verifiedAt:new Date().toISOString(),bindings:{requestDigest:'3'.repeat(64),requestAuthorityDelegationDigest:'4'.repeat(64),requestAttestationDigest:'5'.repeat(64),delegationDigest:'6'.repeat(64),manifestDigest:'7'.repeat(64),ciEvidenceDigest:'8'.repeat(64),journalRevision:2,journalDigest:'9'.repeat(64),journalCommitDigest:'a'.repeat(64),networkIsolationDigest:'b'.repeat(64)}}
};
const canonical=input=>Array.isArray(input)?input.map(canonical):input!==null&&typeof input==='object'?Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):input;
receipt.promotion.promotionDigest=crypto.createHash('sha256').update(`${JSON.stringify(canonical(receipt.promotion.bindings))}\n`).digest('hex');
fs.writeFileSync(process.argv[3], JSON.stringify(value)); fs.writeFileSync(process.argv[4], JSON.stringify(receipt));
NODE
if node "$VALIDATOR" "$TMP/evidence/matrix.json" "$TMP/evidence" >/dev/null; then pass 'fresh tuple-bound real-host receipt can conditionally support verification'; else fail 'valid conditional real-host receipt was rejected'; fi

if node "$STAGER" "$MATRIX" "$TMP/evidence/receipts/canary.json" "$TMP/promotion-candidate" >/dev/null \
  && test "$(node -e 'const m=require(process.argv[1]);process.stdout.write(m.cells[0].status)' "$TMP/promotion-candidate/scripts/platform-support-matrix.json")" = verified \
  && test -f "$TMP/promotion-candidate/.agent/evidence/platform-canaries/macos-14-arm64-native/test-real-host-canary.json"; then
  pass 'independent receipt stages a validated source-reviewable promotion candidate'
else
  fail 'independent receipt did not stage a valid promotion candidate'
fi

node - "$TMP/evidence/receipts/canary.json" "$TMP/unsupported-receipt.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.cellId = 'alpine-3-19-x64-container';
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
if node "$STAGER" "$MATRIX" "$TMP/unsupported-receipt.json" "$TMP/unsupported-candidate" >/dev/null 2>&1; then
  fail 'promotion stager silently changed an unsupported support policy'
else
  pass 'unsupported cell promotion requires an explicit source-reviewed support change'
fi

reject_mutation() {
  local name="$1" expression="$2"
  cp -R "$TMP/evidence" "$TMP/$name"
  node - "$TMP/$name/receipts/canary.json" "$expression" <<'NODE'
const fs = require('node:fs'); const file = process.argv[2]; const value = JSON.parse(fs.readFileSync(file, 'utf8'));
Function('value', process.argv[3])(value); fs.writeFileSync(file, JSON.stringify(value));
NODE
  if node "$VALIDATOR" "$TMP/$name/matrix.json" "$TMP/$name" >/dev/null 2>&1; then fail "$name receipt was accepted"; else pass "$name receipt is rejected"; fi
}
reject_mutation stale "value.recordedAt='2000-01-01T00:00:00.000Z'"
reject_mutation wrong-tuple "value.tuple.arch='wrong'"
reject_mutation wrong-release "value.release.manifestDigest='0'"
reject_mutation incomplete-coverage "value.coverage=value.coverage.slice(0,-1)"
reject_mutation wrong-scope "value.scope='unit-test'"
reject_mutation hermetic "value.evidenceClass='hermetic'"
reject_mutation hermetic-proof "value.proof.hermetic=true"
reject_mutation missing-upgrade-proof "delete value.proof.phases.upgrade"
reject_mutation missing-interactive-tui-proof "delete value.proof.phases.interactiveTui"
reject_mutation tampered-direct-tui-digest "value.proof.phases.interactiveTui.directUser.transcriptDigest='0'"
reject_mutation unrestored-root-tui "value.proof.phases.interactiveTui.rootHandoff.terminalRestored=false"
reject_mutation reused-tui-run "value.proof.phases.interactiveTui.rootHandoff.runId=value.proof.phases.interactiveTui.directUser.runId"
reject_mutation missing-tui-completion "delete value.proof.phases.interactiveTui.directUser.completionStatus"
reject_mutation failed-tui-completion "value.proof.phases.interactiveTui.rootHandoff.completionExitStatus=1"
reject_mutation foreign-tui-completion "value.proof.phases.interactiveTui.directUser.completionRunId='foreign-run'"
reject_mutation missing-offline-authority "delete value.proof.phases.offlineExecution.authorityDigest"
reject_mutation caller-mutation-claim "value.proof.phases.unchangedSecondRun.mutatedTaskIds=['task.one']"
reject_mutation self-authored-unpromoted "value.schemaVersion=2;delete value.promotion"
reject_mutation forged-promotion-shape "value.promotion.bindings.networkIsolationDigest='not-a-digest'"

# A hermetic receipt may document best-effort behavior but can never promote.
node - "$TMP/evidence/matrix.json" "$TMP/hermetic-matrix.json" <<'NODE'
const fs = require('node:fs'); const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
value.cells[0].evidence = [{ kind: 'hermetic-receipt', path: 'scripts/test-platform-evidence-matrix.sh', assertion: 'Hermetic test only; not real-host evidence.' }];
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
if node "$VALIDATOR" "$TMP/hermetic-matrix.json" "$ROOT" >/dev/null 2>&1; then fail 'hermetic evidence promoted a verified cell'; else pass 'hermetic evidence cannot promote verified support'; fi

# Unsupported cells must remain actionable.
node - "$MATRIX" "$TMP/no-remediation.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cell = value.cells.find(candidate => candidate.status === 'unsupported');
cell.remediation = '';
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
if node "$VALIDATOR" "$TMP/no-remediation.json" >/dev/null 2>&1; then fail 'unsupported cell without remediation was accepted'; else pass 'unsupported cells require exact remediation'; fi

# Referenced fixture/workflow evidence must really exist.
node - "$MATRIX" "$TMP/missing-evidence.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cell = value.cells.find(candidate => candidate.status === 'best-effort');
cell.evidence[0].path = 'scripts/does-not-exist.fixture';
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
if node "$VALIDATOR" "$TMP/missing-evidence.json" >/dev/null 2>&1; then fail 'missing evidence path was accepted'; else pass 'evidence paths must exist'; fi

# Receipt creation is fail-closed and validates structured authority evidence.
mkdir -p "$TMP/finalizer/raw"
ssh-keygen -q -t ed25519 -N '' -f "$TMP/finalizer/key"
printf 'schema_version=5\nrelease_id=release-test\nsource_commit=%040d\nkey_id=test-signer\n' 0 >"$TMP/finalizer/raw/release.manifest"
ssh-keygen -Y sign -q -f "$TMP/finalizer/key" -n install.doctor.release "$TMP/finalizer/raw/release.manifest"
printf 'test-signer %s\n' "$(cat "$TMP/finalizer/key.pub")" >"$TMP/finalizer/raw/release.allowed-signers"
node - "$TMP/finalizer/raw" "$TMP/finalizer/report.json" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'); const [root,reportFile]=process.argv.slice(2); const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=fs.readFileSync(path.join(root,'release.manifest')); const manifestDigest=hash(manifest); const sourceCommit='0'.repeat(40);
fs.writeFileSync(path.join(root,'signed-release.json'),JSON.stringify({schemaVersion:1,releaseId:'release-test',sourceCommit,manifestDigest,signerId:'test-signer',manifestPath:'release.manifest',signaturePath:'release.manifest.sig',allowedSignersPath:'release.allowed-signers'}));
const write=(file,value)=>{const bytes=Buffer.from(JSON.stringify(value));fs.writeFileSync(file,bytes);return {path:'/fixture',sha256:hash(bytes)}};
const install=(name,runId,planDigest,mutated,executionMode,interrupted=false,beforeFingerprint='',afterFingerprint='')=>{
  const authorityRoot=`${name}.authority`,dir=path.join(root,authorityRoot);
  for(const child of ['journal-objects','journal-heads','compensations','native'])fs.mkdirSync(path.join(dir,child),{recursive:true});
  const task={id:'task.one',network:'none',resources:{network:false}};
  const plan={digest:planDigest,selectedTaskIds:['task.one'],tasks:[task]};
  const planArtifact=write(path.join(dir,'plan.json'),plan);
  let previousDigest=null,generation=0;
  if(interrupted){
    generation=1;
    const value={schemaVersion:1,generation,previousDigest:null,journal:{runId,planDigest,entries:[{taskId:'task.one',status:'interrupted'}]}};
    const bytes=Buffer.from(JSON.stringify(value)),digest=hash(bytes);
    fs.writeFileSync(path.join(dir,'journal-objects',`${digest}.json`),bytes);
    fs.writeFileSync(path.join(dir,'journal-heads',`${String(generation).padStart(16,'0')}-${digest}.json`),JSON.stringify({schemaVersion:1,generation,previousDigest:null,journalDigest:digest}));
    previousDigest=digest;
  }
  generation+=1;
  const journal={runId,planDigest,entries:[{taskId:'task.one',status:'verified'}]};
  const objectValue={schemaVersion:1,generation,previousDigest,journal},objectBytes=Buffer.from(JSON.stringify(objectValue)),objectDigest=hash(objectBytes);
  fs.writeFileSync(path.join(dir,'journal-objects',`${objectDigest}.json`),objectBytes);
  const headValue={schemaVersion:1,generation,previousDigest,journalDigest:objectDigest},headBytes=Buffer.from(JSON.stringify(headValue));
  fs.writeFileSync(path.join(dir,'journal-heads',`${String(generation).padStart(16,'0')}-${objectDigest}.json`),headBytes);
  fs.writeFileSync(path.join(dir,'journal-object.json'),objectBytes);fs.writeFileSync(path.join(dir,'journal-head.json'),headBytes);
  const journalObject={path:'/fixture',sha256:objectDigest},journalHead={path:'/fixture',sha256:hash(headBytes)};
  const events=[];const push=value=>events.push({sequence:events.length,runId,...value});
  push({kind:'task-status',taskId:'task.one',status:'queued'});if(mutated)push({kind:'task-status',taskId:'task.one',status:'running'});
  push({kind:'task-status',taskId:'task.one',status:'verified'});push({kind:'run-status',status:'success'});
  const eventBytes=Buffer.from(events.map(value=>JSON.stringify(value)).join('\n')+'\n');fs.writeFileSync(path.join(dir,'events.ndjson'),eventBytes);
  const eventArtifact={path:'/fixture',sha256:hash(eventBytes)};
  const receipt={runId,planDigest,status:'success',startedAt:'2026-11-05T12:00:10.000Z',finishedAt:'2026-11-05T12:00:50.000Z',taskCounts:{verified:1,inapplicable:0,skipped:0,blocked:0,pending:0,failed:0}};
  const receiptArtifact=write(path.join(dir,'receipt.json'),receipt);
  let compensationIndex=null;
  if(mutated){
    const persisted={record:{taskId:'task.one',state:'available'},serviceSnapshot:null};
    const persistedBytes=Buffer.from(JSON.stringify(persisted)),persistedDigest=hash(persistedBytes),artifactName=`${persistedDigest}.json`;
    fs.writeFileSync(path.join(dir,'compensations',artifactName),persistedBytes);
    const index={schemaVersion:1,artifacts:[{taskId:'task.one',path:`/fixture/${artifactName}`,sha256:persistedDigest}]};
    const indexBytes=Buffer.from(JSON.stringify(index));fs.writeFileSync(path.join(dir,'compensation-index.json'),indexBytes);
    compensationIndex={path:'/fixture',sha256:hash(indexBytes)};
  }
  const commit={schemaVersion:1,runId,planDigest,planArtifact,journalObject,journalHead,events:eventArtifact,receipt:receiptArtifact,compensationIndex,nativeTransactionIndex:null,evidencePaths:[]};
  const commitBytes=Buffer.from(JSON.stringify(commit));fs.writeFileSync(path.join(dir,'commit.json'),commitBytes);
  fs.writeFileSync(path.join(dir,'terminal-authority.json'),JSON.stringify({schemaVersion:1,runId,planDigest,commit:{path:'/fixture',sha256:hash(commitBytes)}}));
  const phase={schemaVersion:2,runId,planDigest,authorityRoot,executionMode,beforeFingerprint,afterFingerprint};
  fs.writeFileSync(path.join(root,`${name}.json`),JSON.stringify(phase));return phase;
};
const clean=install('clean-install','clean-run','a'.repeat(64),true,'online'); const upgrade=install('upgrade','upgrade-run','b'.repeat(64),true,'online',true); const unchanged=install('unchanged-second-run','unchanged-run','b'.repeat(64),false,'online',false,'c'.repeat(64),'c'.repeat(64)); const offline=install('offline-execution','offline-run','d'.repeat(64),false,'offline');
const canonical=input=>Array.isArray(input)?input.map(canonical):input!==null&&typeof input==='object'?Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,canonical(value)])):input;
const bundleManifest={schemaVersion:2,releaseId:'release-test',planDigest:offline.planDigest,graphDigest:'9'.repeat(64),platform:{os:'linux',arch:'x64',environment:'container'},selectedTaskIds:['task.one'],createdAt:'2026-11-05T11:00:00.000Z',expiresAt:'2026-11-06T11:00:00.000Z',containsSecrets:false,signature:{keyId:'test-signer',algorithm:'sshsig-ed25519',namespace:'install.doctor.offline-bundle',detached:true},artifacts:[{id:'engine'}]};
const bundleBytes=Buffer.from(JSON.stringify(canonical(bundleManifest))+'\n'),bundleManifestDigest=hash(bundleBytes);fs.writeFileSync(path.join(root,'offline-bundle.manifest.json'),bundleBytes);
const invocation={schemaVersion:2,command:'bundle-execute',runId:offline.runId,approvedManifestDigest:bundleManifestDigest,approvedPlanDigest:offline.planDigest,offline:true,networkPolicy:'deny'};const invocationBytes=Buffer.from(JSON.stringify(invocation));fs.writeFileSync(path.join(root,'offline-invocation.json'),invocationBytes);
const isolation={schemaVersion:1,kind:'linux-network-namespace',runId:offline.runId,planDigest:offline.planDigest,bundleManifestDigest,invocationDigest:hash(invocationBytes),parentNamespaceId:'net:[1]',executionNamespaceId:'net:[2]',defaultRoutePresent:false,loopbackOnly:true,dnsProbe:'denied',tcpProbe:'denied',startedAt:'2026-11-05T12:00:00.000Z',finishedAt:'2026-11-05T12:01:00.000Z',exitCode:0};fs.writeFileSync(path.join(root,'offline-network-isolation.json'),JSON.stringify(isolation));
Object.assign(offline,{offlineBundle:{manifestPath:'offline-bundle.manifest.json',signaturePath:'offline-bundle.manifest.json.sig',allowedSignersPath:'release.allowed-signers',signerId:'test-signer',manifestDigest:bundleManifestDigest},networkIsolation:{evidencePath:'offline-network-isolation.json',invocationPath:'offline-invocation.json'}});
fs.writeFileSync(path.join(root,'offline-execution.json'),JSON.stringify(offline));
fs.writeFileSync(path.join(root,'clean-install.json'),JSON.stringify(clean)); fs.writeFileSync(path.join(root,'upgrade.json'),JSON.stringify(upgrade)); fs.writeFileSync(path.join(root,'unchanged-second-run.json'),JSON.stringify(unchanged)); fs.writeFileSync(path.join(root,'interrupted-resume.json'),JSON.stringify({...upgrade,interruptedRunId:'upgrade-run',interruptStatus:124}));
const rollbackRoot='config-rollback.authority',rollbackDir=path.join(root,rollbackRoot);fs.mkdirSync(path.join(rollbackDir,'events'),{recursive:true});const rollbackPlan={digest:'e'.repeat(64),taskOrder:['task.one']};const rollbackPlanArtifact=write(path.join(rollbackDir,'plan.json'),rollbackPlan);const rollbackEvents=[{sequence:0,kind:'rollback-run-started'},{sequence:1,kind:'rollback-plan-approved'},{sequence:2,kind:'rollback-task-started',taskId:'task.one'},{sequence:3,kind:'rollback-task-restored',taskId:'task.one'},{sequence:4,kind:'rollback-run-finished',status:'succeeded'}];const rollbackEventArtifacts=rollbackEvents.map((event,index)=>write(path.join(rollbackDir,'events',`${String(index).padStart(8,'0')}.json`),event));const rr={status:'succeeded',completed:true};const rollbackReceiptArtifact=write(path.join(rollbackDir,'receipt.json'),rr);const rollbackCommit={schemaVersion:1,rollbackRunId:'rollback-run',planDigest:rollbackPlan.digest,plan:rollbackPlanArtifact,events:rollbackEventArtifacts,receipt:rollbackReceiptArtifact,evidencePaths:[]};fs.writeFileSync(path.join(rollbackDir,'commit.json'),JSON.stringify(rollbackCommit));fs.writeFileSync(path.join(root,'config-rollback.json'),JSON.stringify({schemaVersion:2,rollbackRunId:'rollback-run',planDigest:rollbackPlan.digest,authorityRoot:rollbackRoot}));
const tuiSession=(name,runId,planDigest)=>{const transcriptPath=`${name}.typescript`,runsListPath=`${name}.runs-list.json`,authorityRoot=`${name}.uncommitted`;const transcript=Buffer.from('\u001b[?1049h\u001b[?25l\u001b[1;36mDESKTOP TOOLS\u001b[0m\n\u001b[2mWorkers\u001b[0m  1 active  2 waiting  3/6 done\n\u001b[?25h\u001b[?1049l');fs.writeFileSync(path.join(root,transcriptPath),transcript);const authority=path.join(root,authorityRoot,'runs',planDigest,runId);fs.mkdirSync(path.join(authority,'commits'),{recursive:true});const planBytes=Buffer.from(JSON.stringify({digest:planDigest,selectedTaskIds:['task.one']}));fs.writeFileSync(path.join(authority,'plan.json'),planBytes);const updatedAt='2026-11-05T12:00:30.000Z',desiredRevision='revision-one';const journal={runId,planDigest,releaseId:'release-test',desiredRevision,updatedAt,revision:2,entries:[{taskId:'task.one',status:'interrupted'}]};const object={schemaVersion:1,generation:2,previousDigest:'f'.repeat(64),journal};const objectBytes=Buffer.from(JSON.stringify(object));fs.writeFileSync(path.join(authority,'journal-object.json'),objectBytes);const head={schemaVersion:1,generation:2,previousDigest:object.previousDigest,journalDigest:hash(objectBytes)};const headBytes=Buffer.from(JSON.stringify(head));fs.writeFileSync(path.join(authority,'journal-head.json'),headBytes);const summary={schemaVersion:1,runId,planDigest,releaseId:'release-test',desiredRevision,updatedAt,journalRevision:2,authority:'uncommitted',resumeCandidate:true,taskCounts:{running:0,verified:0,inapplicable:0,blocked:0,failed:0,interrupted:1}};const runsListBytes=Buffer.from(JSON.stringify({schemaVersion:1,runs:[summary]}));fs.writeFileSync(path.join(root,runsListPath),runsListBytes);const completionAuthority=install(`${name}-completion`,runId,planDigest,true,'online');const completionTranscriptPath=`${name}-resumed.typescript`,completionTranscript=Buffer.from('\u001b[?1049h\u001b[?25lDESKTOP TOOLS\n\u001b[?25h\u001b[?1049l');fs.writeFileSync(path.join(root,completionTranscriptPath),completionTranscript);const completion={transcriptPath:completionTranscriptPath,transcriptDigest:hash(completionTranscript),exitStatus:0,authority:completionAuthority,authorityDigest:hash(fs.readFileSync(path.join(root,completionAuthority.authorityRoot,'commit.json')))};return{transcriptPath,transcriptDigest:hash(transcript),exitStatus:130,runsListPath,runsListDigest:hash(runsListBytes),authorityRoot,runId,planDigest,completion}};
const interactiveTui={schemaVersion:1,release:{releaseId:'release-test',sourceCommit,manifestDigest},directUser:tuiSession('direct-user-tui','direct-run','1'.repeat(64)),rootHandoff:tuiSession('root-handoff-tui','root-run','2'.repeat(64))};fs.writeFileSync(path.join(root,'interactive-tui.json'),JSON.stringify(interactiveTui));
const scenarioIds=['denial','expiry','replay','profile-race','provider-outage','hosted-service-outage','recording-failure','telemetry-timeout'];const failureScenarios={schemaVersion:1,releaseId:'release-test',sourceCommit,runtime:process.version,runnerDigest:'8'.repeat(64),scenarios:scenarioIds.map(id=>{const testName=`fixture proof for ${id}`,transcriptPath=`failure-scenarios.${id}.tap`,transcript=Buffer.from(`✔ ${testName}\n`);fs.writeFileSync(path.join(root,transcriptPath),transcript);return{id,source:`packages/fixture/${id}.test.mjs`,sourceDigest:'7'.repeat(64),testName,exitStatus:0,transcriptPath,transcriptDigest:hash(transcript)}})};fs.writeFileSync(path.join(root,'failure-scenarios.json'),JSON.stringify(failureScenarios));
const paths={cleanInstall:'clean-install.json',signedRelease:'signed-release.json',upgrade:'upgrade.json',interruptedResume:'interrupted-resume.json',unchangedSecondRun:'unchanged-second-run.json',offlineExecution:'offline-execution.json',configRollback:'config-rollback.json',interactiveTui:'interactive-tui.json',failureScenarios:'failure-scenarios.json'}; const phases=Object.fromEntries(Object.entries(paths).map(([name,path])=>[name,{result:'passed',path}])); fs.writeFileSync(reportFile,JSON.stringify({schemaVersion:3,cellId:'macos-14-arm64-native',observed:{os:'macOS',version:'14',arch:'arm64',environment:'native',role:'macos'},release:{releaseId:'release-test',sourceCommit,manifestDigest},disposable:true,hermetic:false,phases}));
NODE
ssh-keygen -Y sign -q -f "$TMP/finalizer/key" -n install.doctor.offline-bundle "$TMP/finalizer/raw/offline-bundle.manifest.json"
if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12345 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc \
  node "$FINALIZER" "$MATRIX" "$TMP/finalizer/report.json" "$TMP/finalizer/raw" "$TMP/finalizer/receipt.json" \
  && node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1])); process.exit(r.schemaVersion===2&&r.proof.hermetic===false&&Object.keys(r.proof.phases).length===9&&r.proof.phases.failureScenarios.scenarioIds.length===8&&r.proof.phases.interactiveTui.directUser.terminalRestored===true&&r.proof.phases.interactiveTui.rootHandoff.resumeCandidate===true&&r.proof.phases.cleanInstall.mutatedTaskIds.length===1&&r.proof.phases.unchangedSecondRun.mutatedTaskIds.length===0?0:1)' "$TMP/finalizer/receipt.json"; then
  pass 'GitHub-hosted non-hermetic phase evidence finalizes to a digest-bound receipt'
else fail 'valid real-host phase evidence did not finalize'; fi
cp "$TMP/finalizer/report.json" "$TMP/finalizer/wrong-tuple.json"
node -e 'const fs=require("node:fs"),f=process.argv[1],v=JSON.parse(fs.readFileSync(f));v.observed.arch="x64";fs.writeFileSync(f,JSON.stringify(v))' "$TMP/finalizer/wrong-tuple.json"
if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12346 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc node "$FINALIZER" "$MATRIX" "$TMP/finalizer/wrong-tuple.json" "$TMP/finalizer/raw" "$TMP/finalizer/rejected.json" >/dev/null 2>&1; then fail 'mismatched observed tuple finalized'; else pass 'observed tuple mismatch is rejected'; fi
reject_structured_mutation() {
  local label="$1" file="$2" expression="$3"
  cp "$TMP/finalizer/raw/$file" "$TMP/finalizer/raw/$file.backup"
  node -e 'const fs=require("node:fs"),f=process.argv[1],v=JSON.parse(fs.readFileSync(f));Function("v",process.argv[2])(v);fs.writeFileSync(f,JSON.stringify(v))' "$TMP/finalizer/raw/$file" "$expression"
  rm -f "$TMP/finalizer/rejected.json"
  if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12346 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc node "$FINALIZER" "$MATRIX" "$TMP/finalizer/report.json" "$TMP/finalizer/raw" "$TMP/finalizer/rejected.json" >/dev/null 2>&1; then fail "$label authority mutation finalized"; else pass "$label authority mutation is rejected"; fi
  mv "$TMP/finalizer/raw/$file.backup" "$TMP/finalizer/raw/$file"
}
reject_structured_mutation signed-release signed-release.json 'v.manifestDigest="f".repeat(64)'
reject_structured_mutation clean-receipt clean-install.authority/receipt.json 'v.status="failed"'
reject_structured_mutation resume-identity interrupted-resume.json 'v.interruptedRunId="different-run"'
reject_structured_mutation unchanged-mutation unchanged-second-run.json 'v.mutationCount=1'
reject_structured_mutation rollback-receipt config-rollback.authority/receipt.json 'v.completed=false'
reject_structured_mutation tui-release interactive-tui.json 'v.release.manifestDigest="f".repeat(64)'
reject_structured_mutation tui-transcript-digest interactive-tui.json 'v.directUser.transcriptDigest="f".repeat(64)'
reject_structured_mutation tui-exit-status interactive-tui.json 'v.rootHandoff.exitStatus=0'
reject_structured_mutation tui-resume-authority root-handoff-tui.runs-list.json 'v.runs[0].authority="committed";v.runs[0].resumeCandidate=false'
reject_structured_mutation tui-journal-identity root-handoff-tui.uncommitted/runs/2222222222222222222222222222222222222222222222222222222222222222/root-run/journal-object.json 'v.journal.runId="foreign-run"'
reject_structured_mutation tui-completion-exit interactive-tui.json 'v.directUser.completion.exitStatus=1'
reject_structured_mutation tui-completion-run interactive-tui.json 'v.rootHandoff.completion.authority.runId="foreign-run"'
reject_structured_mutation tui-completion-commit root-handoff-tui-completion.authority/receipt.json 'v.status="failed"'
reject_structured_mutation failure-matrix failure-scenarios.json 'v.scenarios=v.scenarios.filter(s=>s.id!=="expiry")'

cp "$TMP/finalizer/raw/direct-user-tui.typescript" "$TMP/finalizer/raw/direct-user-tui.typescript.backup"
printf 'DESKTOP TOOLS\nWorkers  1 active  2 waiting  3/6 done\n' > "$TMP/finalizer/raw/direct-user-tui.typescript"
rm -f "$TMP/finalizer/rejected.json"
if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12346 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc node "$FINALIZER" "$MATRIX" "$TMP/finalizer/report.json" "$TMP/finalizer/raw" "$TMP/finalizer/rejected.json" >/dev/null 2>&1; then
  fail 'TUI transcript without terminal lifecycle finalized'
else pass 'TUI transcript without terminal lifecycle is rejected'; fi
mv "$TMP/finalizer/raw/direct-user-tui.typescript.backup" "$TMP/finalizer/raw/direct-user-tui.typescript"

printf '{"active":true}\n' > "$TMP/finalizer/raw/direct-user-tui.uncommitted/owner.json"
rm -f "$TMP/finalizer/rejected.json"
if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12346 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc node "$FINALIZER" "$MATRIX" "$TMP/finalizer/report.json" "$TMP/finalizer/raw" "$TMP/finalizer/rejected.json" >/dev/null 2>&1; then
  fail 'actively owned TUI interruption finalized'
else pass 'actively owned TUI interruption is rejected'; fi
rm -f "$TMP/finalizer/raw/direct-user-tui.uncommitted/owner.json"

printf '{"committed":true}\n' > "$TMP/finalizer/raw/root-handoff-tui.uncommitted/runs/2222222222222222222222222222222222222222222222222222222222222222/root-run/commits/commit.json"
rm -f "$TMP/finalizer/rejected.json"
if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12346 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc node "$FINALIZER" "$MATRIX" "$TMP/finalizer/report.json" "$TMP/finalizer/raw" "$TMP/finalizer/rejected.json" >/dev/null 2>&1; then
  fail 'committed TUI run finalized as resumable'
else pass 'committed TUI run cannot masquerade as resumable'; fi
rm -f "$TMP/finalizer/raw/root-handoff-tui.uncommitted/runs/2222222222222222222222222222222222222222222222222222222222222222/root-run/commits/commit.json"

# A running event is only an attempt. Even internally consistent terminal
# authority cannot promote it to an actual mutation without committed effect
# evidence from compensation or a completed native transaction.
cp -R "$TMP/finalizer/raw" "$TMP/finalizer/attempt-only"
node - "$TMP/finalizer/attempt-only/clean-install.authority" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const root=process.argv[2],hash=value=>crypto.createHash('sha256').update(value).digest('hex');const commitFile=path.join(root,'commit.json'),commit=JSON.parse(fs.readFileSync(commitFile));commit.compensationIndex=null;fs.rmSync(path.join(root,'compensation-index.json'));for(const name of fs.readdirSync(path.join(root,'compensations')))fs.rmSync(path.join(root,'compensations',name));const bytes=Buffer.from(JSON.stringify(commit));fs.writeFileSync(commitFile,bytes);const terminal=JSON.parse(fs.readFileSync(path.join(root,'terminal-authority.json')));terminal.commit.sha256=hash(bytes);fs.writeFileSync(path.join(root,'terminal-authority.json'),JSON.stringify(terminal));
NODE
rm -f "$TMP/finalizer/rejected.json"
if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12346 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc node "$FINALIZER" "$MATRIX" "$TMP/finalizer/report.json" "$TMP/finalizer/attempt-only" "$TMP/finalizer/rejected.json" >/dev/null 2>&1; then
  fail 'apply attempt without committed mutation evidence finalized'
else pass 'apply attempts cannot masquerade as committed mutations'; fi

# Offline coverage is bound to the committed selected plan, not a caller label.
cp -R "$TMP/finalizer/raw" "$TMP/finalizer/networked-offline"
node - "$TMP/finalizer/networked-offline/offline-execution.authority" <<'NODE'
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const root=process.argv[2],hash=value=>crypto.createHash('sha256').update(value).digest('hex');const planFile=path.join(root,'plan.json'),plan=JSON.parse(fs.readFileSync(planFile));plan.tasks[0].network='required';plan.tasks[0].resources.network=true;const planBytes=Buffer.from(JSON.stringify(plan));fs.writeFileSync(planFile,planBytes);const commitFile=path.join(root,'commit.json'),commit=JSON.parse(fs.readFileSync(commitFile));commit.planArtifact.sha256=hash(planBytes);const commitBytes=Buffer.from(JSON.stringify(commit));fs.writeFileSync(commitFile,commitBytes);const terminal=JSON.parse(fs.readFileSync(path.join(root,'terminal-authority.json')));terminal.commit.sha256=hash(commitBytes);fs.writeFileSync(path.join(root,'terminal-authority.json'),JSON.stringify(terminal));
NODE
rm -f "$TMP/finalizer/rejected.json"
if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12346 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc node "$FINALIZER" "$MATRIX" "$TMP/finalizer/report.json" "$TMP/finalizer/networked-offline" "$TMP/finalizer/rejected.json" >/dev/null 2>&1; then
  fail 'offline phase with a network-capable selected task finalized'
else pass 'offline phase rejects network-capable selected tasks'; fi

cp -R "$TMP/finalizer/raw" "$TMP/finalizer/reachable-offline"
node - "$TMP/finalizer/reachable-offline/offline-network-isolation.json" <<'NODE'
const fs=require('node:fs'),file=process.argv[2],value=JSON.parse(fs.readFileSync(file));value.defaultRoutePresent=true;value.loopbackOnly=false;value.tcpProbe='reachable';fs.writeFileSync(file,JSON.stringify(value));
NODE
rm -f "$TMP/finalizer/rejected.json"
if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12346 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc node "$FINALIZER" "$MATRIX" "$TMP/finalizer/report.json" "$TMP/finalizer/reachable-offline" "$TMP/finalizer/rejected.json" >/dev/null 2>&1; then
  fail 'offline-policy run with reachable network finalized'
else pass 'offline-policy run with reachable network is rejected'; fi

rm -f "$TMP/finalizer/raw/upgrade.json" "$TMP/finalizer/rejected.json"
if GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted GITHUB_RUN_ID=12346 GITHUB_SHA=cccccccccccccccccccccccccccccccccccccccc \
  node "$FINALIZER" "$MATRIX" "$TMP/finalizer/report.json" "$TMP/finalizer/raw" "$TMP/finalizer/rejected.json" >/dev/null 2>&1; then
  fail 'missing raw upgrade evidence finalized'
else pass 'missing structured phase evidence cannot mint a receipt'; fi

printf 'platform-evidence-matrix: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
