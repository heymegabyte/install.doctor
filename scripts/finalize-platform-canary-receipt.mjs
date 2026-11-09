#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const [matrixFile, reportFile, evidenceRootArgument, outputFile] = process.argv.slice(2);
if (!matrixFile || !reportFile || !evidenceRootArgument || !outputFile) throw new Error('usage: finalize-platform-canary-receipt MATRIX REPORT EVIDENCE_ROOT OUTPUT');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw new Error('receipts require a GitHub-hosted runner');
const runId = process.env.GITHUB_RUN_ID ?? '';
const workflowCommit = process.env.GITHUB_SHA ?? '';
if (!/^[1-9][0-9]{0,19}$/.test(runId) || !/^[a-f0-9]{40}$/.test(workflowCommit)) throw new Error('invalid workflow identity');

const matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8'));
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
const exact = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} fields are invalid`);
};
const phaseNames = ['cleanInstall', 'signedRelease', 'upgrade', 'interruptedResume', 'unchangedSecondRun', 'offlineExecution', 'configRollback', 'interactiveTui', 'failureScenarios'];
exact(report, ['schemaVersion', 'cellId', 'observed', 'release', 'disposable', 'hermetic', 'phases'], 'report');
if (report.schemaVersion !== 3 || report.disposable !== true || report.hermetic !== false) throw new Error('report is not schema-v3 non-hermetic disposable-host evidence');
const cell = matrix.cells?.find(candidate => candidate.id === report.cellId);
if (!cell) throw new Error('unknown matrix cell');
exact(report.observed, ['os', 'version', 'arch', 'environment', 'role'], 'observed');
for (const key of ['os', 'version', 'arch', 'environment', 'role']) {
  if (report.observed[key] !== cell[key]) throw new Error(`observed ${key} does not match matrix cell`);
}
exact(report.release, ['releaseId', 'sourceCommit', 'manifestDigest'], 'release');
if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(report.release.releaseId)
  || !/^[a-f0-9]{40}$/.test(report.release.sourceCommit)
  || !/^[a-f0-9]{64}$/.test(report.release.manifestDigest)) throw new Error('invalid immutable release identity');
exact(report.phases, phaseNames, 'phases');

const root = fs.realpathSync(evidenceRootArgument);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonicalBytes = value => {
  const canonical = input => Array.isArray(input) ? input.map(canonical) : input !== null && typeof input === 'object'
    ? Object.fromEntries(Object.entries(input).sort(([left],[right]) => left.localeCompare(right)).map(([key,child]) => [key,canonical(child)])) : input;
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`);
};
const evidenceFile = (relative, label) => {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split('/').includes('..')) throw new Error(`${label} path is invalid`);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes evidence root`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 16_777_216) throw new Error(`${label} must be a bounded regular file`);
  return resolved;
};
const evidenceDirectory = (relative, label) => {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split('/').includes('..')) throw new Error(`${label} path is invalid`);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes evidence root`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
  return resolved;
};
const readJson = (relative, label) => JSON.parse(fs.readFileSync(evidenceFile(relative, label), 'utf8'));
const readBound = (relative, expectedDigest, label, parseJson = true) => {
  const file = evidenceFile(relative, label); const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== expectedDigest) throw new Error(`${label} digest mismatch`);
  return { bytes, value: parseJson ? JSON.parse(bytes.toString('utf8')) : undefined };
};
const canonicalIds = (values, label) => {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')
    || new Set(values).size !== values.length || values.some((value, index) => index > 0 && values[index - 1].localeCompare(value) >= 0)) {
    throw new Error(`${label} must contain unique sorted task identifiers`);
  }
  return values;
};
const basename = (value, label) => {
  if (typeof value !== 'string' || path.basename(value) !== value.split('/').at(-1)) throw new Error(`${label} path is invalid`);
  return path.basename(value);
};
const terminalTaskStatuses = new Set(['verified', 'inapplicable', 'pending', 'pending-reboot', 'interrupted', 'blocked', 'failed']);

const validateInstallAuthority = (phase, label, expectedMode) => {
  exact(phase, expectedMode === 'offline'
    ? ['schemaVersion', 'runId', 'planDigest', 'authorityRoot', 'executionMode', 'beforeFingerprint', 'afterFingerprint', 'offlineBundle', 'networkIsolation']
    : ['schemaVersion', 'runId', 'planDigest', 'authorityRoot', 'executionMode', 'beforeFingerprint', 'afterFingerprint'], label);
  if (phase.schemaVersion !== 2 || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(phase.runId)
    || !/^[a-f0-9]{64}$/.test(phase.planDigest) || phase.executionMode !== expectedMode
    || !/^[a-z0-9][a-z0-9._/-]{0,255}$/.test(phase.authorityRoot)
    || path.isAbsolute(phase.authorityRoot) || phase.authorityRoot.split('/').includes('..')) throw new Error(`${label} identity is invalid`);
  const authority = relative => `${phase.authorityRoot}/${relative}`;
  const commitBytes = fs.readFileSync(evidenceFile(authority('commit.json'), `${label} commit`));
  const commit = JSON.parse(commitBytes.toString('utf8'));
  exact(commit, ['schemaVersion','runId','planDigest','planArtifact','journalObject','journalHead','events','receipt','compensationIndex','nativeTransactionIndex','evidencePaths'], `${label} commit`);
  if (commit.schemaVersion !== 1 || commit.runId !== phase.runId || commit.planDigest !== phase.planDigest) throw new Error(`${label} commit identity mismatch`);
  const terminalAuthority = readJson(authority('terminal-authority.json'), `${label} terminal authority`);
  exact(terminalAuthority, ['schemaVersion','runId','planDigest','commit'], `${label} terminal authority`);
  exact(terminalAuthority.commit, ['path','sha256'], `${label} terminal authority commit`);
  if (terminalAuthority.schemaVersion !== 1 || terminalAuthority.runId !== phase.runId || terminalAuthority.planDigest !== phase.planDigest
    || terminalAuthority.commit.sha256 !== sha256(commitBytes)) throw new Error(`${label} terminal authority does not bind the exported commit`);
  const fixed = [
    ['planArtifact', 'plan.json'], ['journalObject', 'journal-object.json'], ['journalHead', 'journal-head.json'],
    ['events', 'events.ndjson'], ['receipt', 'receipt.json'],
  ];
  const artifacts = {};
  for (const [field, file] of fixed) {
    exact(commit[field], ['path','sha256'], `${label} commit.${field}`);
    artifacts[field] = readBound(authority(file), commit[field].sha256, `${label} ${field}`, field !== 'events');
  }
  const plan = artifacts.planArtifact.value;
  const journalObject = artifacts.journalObject.value;
  const journalHead = artifacts.journalHead.value;
  const receipt = artifacts.receipt.value;
  if (plan.digest !== phase.planDigest || receipt.runId !== phase.runId || receipt.planDigest !== phase.planDigest || receipt.status !== 'success') {
    throw new Error(`${label} plan or receipt identity is invalid`);
  }
  const selectedTaskIds = canonicalIds(plan.selectedTaskIds, `${label} selectedTaskIds`);
  const planTasks = Array.isArray(plan.tasks) ? new Map(plan.tasks.map(task => [task.id, task])) : new Map();
  if (planTasks.size !== plan.tasks?.length || selectedTaskIds.some(taskId => !planTasks.has(taskId))) {
    throw new Error(`${label} plan does not contain every selected task exactly once`);
  }
  if (expectedMode === 'offline' && selectedTaskIds.some(taskId => {
    const task = planTasks.get(taskId); return task.network !== 'none' || task.resources?.network !== false;
  })) {
    throw new Error(`${label} offline plan contains a network-capable selected task`);
  }
  let offlineBundleProof;
  if (expectedMode === 'offline') {
    exact(phase.offlineBundle, ['manifestPath','signaturePath','allowedSignersPath','signerId','manifestDigest'], `${label} offline bundle`);
    const manifestPath = evidenceFile(phase.offlineBundle.manifestPath, `${label} bundle manifest`);
    const manifestBytes = fs.readFileSync(manifestPath); const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (!manifestBytes.equals(canonicalBytes(manifest)) || sha256(manifestBytes) !== phase.offlineBundle.manifestDigest
      || manifest.schemaVersion !== 2 || manifest.releaseId !== report.release.releaseId || manifest.planDigest !== phase.planDigest
      || manifest.containsSecrets !== false || manifest.signature?.keyId !== phase.offlineBundle.signerId
      || manifest.signature?.namespace !== 'install.doctor.offline-bundle' || manifest.signature?.algorithm !== 'sshsig-ed25519'
      || JSON.stringify(manifest.selectedTaskIds) !== JSON.stringify(selectedTaskIds)) throw new Error(`${label} signed offline bundle identity mismatch`);
    execFileSync('ssh-keygen', ['-Y','verify','-f',evidenceFile(phase.offlineBundle.allowedSignersPath,`${label} bundle allowed signers`),
      '-I',phase.offlineBundle.signerId,'-n','install.doctor.offline-bundle','-s',evidenceFile(phase.offlineBundle.signaturePath,`${label} bundle signature`)],
    { input: manifestBytes, stdio: ['pipe','ignore','ignore'] });
    exact(phase.networkIsolation, ['evidencePath','invocationPath'], `${label} network isolation`);
    const invocationBytes = fs.readFileSync(evidenceFile(phase.networkIsolation.invocationPath, `${label} offline invocation`));
    const invocation = JSON.parse(invocationBytes.toString('utf8'));
    if (invocation.schemaVersion !== 2 || invocation.command !== 'bundle-execute' || invocation.runId !== phase.runId
      || invocation.approvedManifestDigest !== phase.offlineBundle.manifestDigest || invocation.approvedPlanDigest !== phase.planDigest
      || invocation.offline !== true || invocation.networkPolicy !== 'deny') throw new Error(`${label} offline invocation identity mismatch`);
    const isolation = readJson(phase.networkIsolation.evidencePath, `${label} network isolation evidence`);
    exact(isolation, ['schemaVersion','kind','runId','planDigest','bundleManifestDigest','invocationDigest','parentNamespaceId','executionNamespaceId',
      'defaultRoutePresent','loopbackOnly','dnsProbe','tcpProbe','startedAt','finishedAt','exitCode'], `${label} network isolation evidence`);
    if (isolation.schemaVersion !== 1 || isolation.kind !== 'linux-network-namespace' || isolation.runId !== phase.runId
      || isolation.planDigest !== phase.planDigest || isolation.bundleManifestDigest !== phase.offlineBundle.manifestDigest
      || isolation.invocationDigest !== sha256(invocationBytes) || !/^net:\[[1-9][0-9]*\]$/.test(isolation.parentNamespaceId)
      || !/^net:\[[1-9][0-9]*\]$/.test(isolation.executionNamespaceId) || isolation.parentNamespaceId === isolation.executionNamespaceId
      || isolation.defaultRoutePresent !== false || isolation.loopbackOnly !== true || isolation.dnsProbe !== 'denied'
      || isolation.tcpProbe !== 'denied' || isolation.exitCode !== 0) throw new Error(`${label} execution lacks structural network-denial evidence`);
    const isolationStart = Date.parse(isolation.startedAt), isolationFinish = Date.parse(isolation.finishedAt);
    if (!Number.isFinite(isolationStart) || !Number.isFinite(isolationFinish) || isolationStart > Date.parse(receipt.startedAt)
      || isolationFinish < Date.parse(receipt.finishedAt) || isolationStart >= isolationFinish) throw new Error(`${label} network isolation does not cover the committed execution interval`);
    offlineBundleProof = { manifestDigest: phase.offlineBundle.manifestDigest, bundleSignerId: phase.offlineBundle.signerId,
      invocationDigest: isolation.invocationDigest, networkIsolation: { kind: isolation.kind, parentNamespaceId: isolation.parentNamespaceId,
        executionNamespaceId: isolation.executionNamespaceId, startedAt: isolation.startedAt, finishedAt: isolation.finishedAt } };
  }
  if (journalHead.journalDigest !== commit.journalObject.sha256 || journalObject.journal?.runId !== phase.runId
    || journalObject.journal?.planDigest !== phase.planDigest) throw new Error(`${label} journal authority mismatch`);
  if (journalHead.generation !== journalObject.generation || journalHead.previousDigest !== journalObject.previousDigest) {
    throw new Error(`${label} journal head does not bind the committed object`);
  }
  const objectDirectory = evidenceDirectory(authority('journal-objects'), `${label} journal objects`);
  const headDirectory = evidenceDirectory(authority('journal-heads'), `${label} journal heads`);
  const objectNames = fs.readdirSync(objectDirectory).sort(); const headNames = fs.readdirSync(headDirectory).sort();
  if (objectNames.length !== journalObject.generation || headNames.length !== journalObject.generation) throw new Error(`${label} journal history is incomplete`);
  const objects = new Map();
  for (const name of objectNames) {
    const match = /^([a-f0-9]{64})\.json$/.exec(name); if (!match) throw new Error(`${label} journal object name is invalid`);
    const bytes = fs.readFileSync(path.join(objectDirectory, name)); if (sha256(bytes) !== match[1]) throw new Error(`${label} journal object filename digest mismatch`);
    const value = JSON.parse(bytes.toString('utf8')); if (value.journal?.runId !== phase.runId || value.journal?.planDigest !== phase.planDigest) throw new Error(`${label} journal history identity mismatch`);
    objects.set(match[1], value);
  }
  const heads = new Map();
  for (const name of headNames) {
    const match = /^(\d{16})-([a-f0-9]{64})\.json$/.exec(name); if (!match) throw new Error(`${label} journal head name is invalid`);
    const value = JSON.parse(fs.readFileSync(path.join(headDirectory, name), 'utf8')); const generation = Number(match[1]);
    if (value.generation !== generation || value.journalDigest !== match[2] || !objects.has(value.journalDigest)) throw new Error(`${label} journal head is invalid`);
    heads.set(generation, value);
  }
  let chainDigest = commit.journalObject.sha256; const journalHistory = [];
  for (let generation = journalObject.generation; generation >= 1; generation -= 1) {
    const object = objects.get(chainDigest); const head = heads.get(generation);
    if (!object || object.generation !== generation || head?.journalDigest !== chainDigest || head.previousDigest !== object.previousDigest) throw new Error(`${label} journal chain is broken`);
    journalHistory.push(object.journal); chainDigest = object.previousDigest;
  }
  if (chainDigest !== null || journalHistory.length !== objects.size) throw new Error(`${label} journal chain does not terminate at its genesis`);
  const journalEntries = new Map((journalObject.journal.entries ?? []).map(entry => [entry.taskId, entry]));
  if (journalEntries.size !== selectedTaskIds.length || selectedTaskIds.some(taskId => !journalEntries.has(taskId))) {
    throw new Error(`${label} journal does not cover the exact selected task closure`);
  }
  const eventLines = artifacts.events.bytes.toString('utf8').split('\n').filter(Boolean);
  const events = eventLines.map(line => JSON.parse(line));
  if (events.length === 0 || events.some((event, index) => event.sequence !== index || event.runId !== phase.runId)) {
    throw new Error(`${label} event stream identity or sequence is invalid`);
  }
  const terminalRun = events.filter(event => event.kind === 'run-status' && ['redirected','success','failed','cancelled','rejected'].includes(event.status));
  if (terminalRun.length !== 1 || terminalRun[0] !== events.at(-1) || terminalRun[0].status !== 'success') {
    throw new Error(`${label} lifecycle does not have one successful terminal boundary`);
  }
  const outcomes = new Map(); const attempted = new Set(); const mutated = new Set(); const queued = new Set();
  for (const event of events) {
    if (event.kind !== 'task-status') continue;
    if (!selectedTaskIds.includes(event.taskId)) throw new Error(`${label} lifecycle contains an unselected task`);
    if (event.status === 'queued') queued.add(event.taskId);
    if (event.status === 'running') attempted.add(event.taskId);
    if (terminalTaskStatuses.has(event.status)) outcomes.set(event.taskId, event.status);
  }
  if (queued.size !== selectedTaskIds.length || outcomes.size !== selectedTaskIds.length) throw new Error(`${label} lifecycle does not cover every selected task`);
  for (const taskId of selectedTaskIds) {
    const status = outcomes.get(taskId);
    if (!['verified','inapplicable'].includes(status) || journalEntries.get(taskId)?.status !== status) {
      throw new Error(`${label} task postcondition is not committed success: ${taskId}`);
    }
  }
  const counts = { verified: 0, inapplicable: 0, skipped: 0, blocked: 0, pending: 0, failed: 0 };
  for (const status of outcomes.values()) counts[status] += 1;
  if (JSON.stringify(receipt.taskCounts) !== JSON.stringify(counts)) throw new Error(`${label} receipt counts are not derived from terminal events`);

  const requiredServiceRestoration = new Set(); const restoredServices = new Set();
  const compensationDirectory = evidenceDirectory(authority('compensations'), `${label} compensations`);
  if (commit.compensationIndex !== null) {
    exact(commit.compensationIndex, ['path','sha256'], `${label} compensation index`);
    const index = readBound(authority('compensation-index.json'), commit.compensationIndex.sha256, `${label} compensation index`).value;
    if (index.schemaVersion !== 1 || !Array.isArray(index.artifacts)) throw new Error(`${label} compensation index is invalid`);
    const indexedCompensations = index.artifacts.map(artifact => basename(artifact.path, `${label} compensation artifact`)).sort();
    if (JSON.stringify(indexedCompensations) !== JSON.stringify(fs.readdirSync(compensationDirectory).sort())) throw new Error(`${label} compensation directory does not match its committed index`);
    for (const artifact of index.artifacts) {
      const taskId = artifact.taskId; const name = basename(artifact.path, `${label} compensation artifact`);
      const persisted = readBound(authority(`compensations/${name}`), artifact.sha256, `${label} compensation ${taskId}`).value;
      if (!selectedTaskIds.includes(taskId) || persisted.record?.taskId !== taskId || persisted.record?.state !== 'available' || !attempted.has(taskId)) {
        throw new Error(`${label} compensation is not tied to a committed mutation: ${taskId}`);
      }
      mutated.add(taskId);
      // A configuration compensation snapshot proves that the prior service
      // state is recoverable; successful apply intentionally leaves the new
      // desired state active. It is not evidence that a restoration occurred.
    }
  } else if (fs.readdirSync(compensationDirectory).length !== 0) {
    throw new Error(`${label} unindexed compensation evidence is present`);
  }
  const nativeDirectory = evidenceDirectory(authority('native'), `${label} native transactions`);
  if (commit.nativeTransactionIndex !== null) {
    exact(commit.nativeTransactionIndex, ['path','sha256'], `${label} native transaction index`);
    const index = readBound(authority('native-transaction-index.json'), commit.nativeTransactionIndex.sha256, `${label} native transaction index`).value;
    if (index.schemaVersion !== 1 || !Array.isArray(index.transactions) || !Array.isArray(index.objects)) throw new Error(`${label} native transaction index is invalid`);
    const indexedNative = [...new Set([
      ...index.objects.map(item => basename(item.path, `${label} native object`)),
      ...index.transactions.flatMap(item => [basename(item.current.path, `${label} native current`), basename(item.record.path, `${label} native record`)]),
    ])].sort();
    if (JSON.stringify(indexedNative) !== JSON.stringify(fs.readdirSync(nativeDirectory).sort())) throw new Error(`${label} native transaction directory does not match its committed index`);
    for (const item of index.objects) readBound(authority(`native/${basename(item.path, `${label} native object`)}`), item.sha256, `${label} native object`);
    for (const transaction of index.transactions) {
      const taskId = transaction.rootPackageKey;
      const head = readBound(authority(`native/${basename(transaction.current.path, `${label} native current`)}`), transaction.current.sha256, `${label} native current`).value;
      const record = readBound(authority(`native/${basename(transaction.record.path, `${label} native record`)}`), transaction.record.sha256, `${label} native record`).value;
      if (!selectedTaskIds.includes(taskId) || !attempted.has(taskId) || head.transactionId !== transaction.transactionId
        || head.recordDigest !== transaction.record.sha256 || record.transactionId !== transaction.transactionId
        || record.rootPackageKey !== taskId || record.runId !== phase.runId || record.planDigest !== phase.planDigest
        || record.phase !== 'completed' || record.failure !== null || record.packages?.some(pkg => pkg.phase !== 'configured')) {
        throw new Error(`${label} native transaction is not committed completed mutation evidence: ${taskId}`);
      }
      mutated.add(taskId);
      if ((record.serviceSnapshots?.length ?? 0) > 0) { requiredServiceRestoration.add(taskId); restoredServices.add(taskId); }
    }
  } else if (fs.readdirSync(nativeDirectory).length !== 0) {
    throw new Error(`${label} unindexed native transaction evidence is present`);
  }
  const attemptedTaskIds = [...attempted].sort(); const mutatedTaskIds = [...mutated].sort();
  const interruptedTaskIds = [...new Set(journalHistory.flatMap(journal => (journal.entries ?? [])
    .filter(entry => entry.status === 'interrupted').map(entry => entry.taskId)))].sort();
  return {
    schemaVersion: 2, runId: phase.runId, planDigest: phase.planDigest, executionMode: expectedMode,
    selectedTaskIds, attemptedTaskIds, mutatedTaskIds, interruptedTaskIds,
    postconditions: Object.fromEntries(selectedTaskIds.map(taskId => [taskId, outcomes.get(taskId)])),
    serviceRestoration: { requiredTaskIds: [...requiredServiceRestoration].sort(), restoredTaskIds: [...restoredServices].sort() },
    beforeFingerprint: phase.beforeFingerprint, afterFingerprint: phase.afterFingerprint,
    authorityDigest: sha256(commitBytes), ...(offlineBundleProof ? { offlineBundle: offlineBundleProof } : {}),
  };
};

const phaseProof = {}; const structured = {};
for (const name of phaseNames) {
  const phase = report.phases[name]; exact(phase, ['result', 'path'], `phases.${name}`);
  if (phase.result !== 'passed') throw new Error(`invalid ${name} result`);
  const resolved = evidenceFile(phase.path, `${name} evidence`); const bytes = fs.readFileSync(resolved);
  phaseProof[name] = { result: 'passed', evidenceDigest: sha256(bytes) };
  structured[name] = JSON.parse(bytes.toString('utf8'));
}
const signed = structured.signedRelease;
exact(signed, ['schemaVersion','releaseId','sourceCommit','manifestDigest','signerId','manifestPath','signaturePath','allowedSignersPath'], 'signedRelease');
if (signed.schemaVersion !== 1 || signed.releaseId !== report.release.releaseId || signed.sourceCommit !== report.release.sourceCommit
  || signed.manifestDigest !== report.release.manifestDigest || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(signed.signerId)) throw new Error('signed release identity mismatch');
const manifest = evidenceFile(signed.manifestPath, 'signed manifest');
if (sha256(fs.readFileSync(manifest)) !== signed.manifestDigest) throw new Error('signed manifest digest mismatch');
const manifestText = fs.readFileSync(manifest, 'utf8');
if (!manifestText.split('\n').includes(`release_id=${signed.releaseId}`) || !manifestText.split('\n').includes(`source_commit=${signed.sourceCommit}`)) throw new Error('manifest metadata mismatch');
execFileSync('ssh-keygen', ['-Y','verify','-f',evidenceFile(signed.allowedSignersPath,'allowed signers'),'-I',signed.signerId,'-n','install.doctor.release','-s',evidenceFile(signed.signaturePath,'manifest signature')], { input: fs.readFileSync(manifest), stdio: ['pipe','ignore','ignore'] });

const interactiveTui = structured.interactiveTui;
exact(interactiveTui, ['schemaVersion','release','directUser','rootHandoff'], 'interactiveTui');
exact(interactiveTui.release, ['releaseId','sourceCommit','manifestDigest'], 'interactiveTui.release');
if (interactiveTui.schemaVersion !== 1
  || interactiveTui.release.releaseId !== report.release.releaseId
  || interactiveTui.release.sourceCommit !== report.release.sourceCommit
  || interactiveTui.release.manifestDigest !== report.release.manifestDigest) {
  throw new Error('interactive TUI release identity mismatch');
}
const validateInteractiveSession = (session, label) => {
  exact(session, ['transcriptPath','transcriptDigest','exitStatus','runsListPath','runsListDigest','authorityRoot','runId','planDigest','completion'], label);
  exact(session.completion, ['transcriptPath','transcriptDigest','exitStatus','authority','authorityDigest'], `${label}.completion`);
  if (session.exitStatus !== 130 || !/^[a-f0-9]{64}$/.test(session.transcriptDigest)
    || !/^[a-f0-9]{64}$/.test(session.runsListDigest) || !/^[a-f0-9]{64}$/.test(session.planDigest)
    || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(session.runId)) throw new Error(`${label} identity is invalid`);
  const transcriptBytes = fs.readFileSync(evidenceFile(session.transcriptPath, `${label} transcript`));
  if (sha256(transcriptBytes) !== session.transcriptDigest) throw new Error(`${label} transcript digest mismatch`);
  const transcript = transcriptBytes.toString('utf8');
  const visibleTranscript = transcript.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
  const assertions = {
    altScreenEntered: transcript.includes('\u001b[?1049h') && transcript.includes('\u001b[?25l'),
    terminalRestored: transcript.includes('\u001b[?25h\u001b[?1049l'),
    desktopToolsIdentity: visibleTranscript.includes('DESKTOP TOOLS'),
    workerAttribution: /Workers\s+\d+ active\s+\d+ waiting\s+\d+\/\d+ done/u.test(visibleTranscript),
  };
  if (Object.values(assertions).some(value => value !== true)) throw new Error(`${label} transcript lacks required TUI lifecycle evidence`);
  const runsListBytes = fs.readFileSync(evidenceFile(session.runsListPath, `${label} runs-list evidence`));
  if (sha256(runsListBytes) !== session.runsListDigest) throw new Error(`${label} runs-list digest mismatch`);
  const runsList = JSON.parse(runsListBytes.toString('utf8'));
  exact(runsList, ['schemaVersion','runs'], `${label}.runsList`);
  if (runsList.schemaVersion !== 1 || !Array.isArray(runsList.runs)) throw new Error(`${label} runs-list is invalid`);
  const matches = runsList.runs.filter(run => run?.runId === session.runId && run?.planDigest === session.planDigest);
  if (matches.length !== 1) throw new Error(`${label} runs-list lacks one exact interrupted run`);
  const summary = matches[0];
  exact(summary, ['schemaVersion','runId','planDigest','releaseId','desiredRevision','updatedAt','journalRevision','authority','resumeCandidate','taskCounts'], `${label}.runSummary`);
  exact(summary.taskCounts, ['running','verified','inapplicable','blocked','failed','interrupted'], `${label}.runSummary.taskCounts`);
  if (summary.schemaVersion !== 1 || summary.releaseId !== report.release.releaseId || summary.authority !== 'uncommitted'
    || summary.resumeCandidate !== true || !Number.isSafeInteger(summary.journalRevision) || summary.journalRevision < 1
    || !Number.isFinite(Date.parse(summary.updatedAt)) || !Number.isSafeInteger(summary.taskCounts.interrupted)
    || summary.taskCounts.interrupted < 1) throw new Error(`${label} runs-list does not prove resumable interruption`);
  const authorityState = evidenceDirectory(session.authorityRoot, `${label} uncommitted authority`);
  const authorityDirectory = path.join(authorityState, 'runs', session.planDigest, session.runId);
  const authorityStat = fs.lstatSync(authorityDirectory);
  if (!authorityStat.isDirectory() || authorityStat.isSymbolicLink()) throw new Error(`${label} run authority is unsafe`);
  const planPath = path.join(authorityDirectory, 'plan.json');
  const headPath = path.join(authorityDirectory, 'journal-head.json');
  const objectPath = path.join(authorityDirectory, 'journal-object.json');
  for (const [artifactPath, artifactLabel] of [[planPath,'plan'],[headPath,'journal head'],[objectPath,'journal object']]) {
    const stat = fs.lstatSync(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16_777_216) throw new Error(`${label} ${artifactLabel} is unsafe`);
  }
  const planBytes = fs.readFileSync(planPath); const plan = JSON.parse(planBytes.toString('utf8'));
  const headBytes = fs.readFileSync(headPath); const head = JSON.parse(headBytes.toString('utf8'));
  const objectBytes = fs.readFileSync(objectPath); const object = JSON.parse(objectBytes.toString('utf8'));
  exact(head, ['schemaVersion','generation','previousDigest','journalDigest'], `${label}.journalHead`);
  exact(object, ['schemaVersion','generation','previousDigest','journal'], `${label}.journalObject`);
  if (plan.digest !== session.planDigest || head.schemaVersion !== 1 || object.schemaVersion !== 1
    || head.generation !== object.generation || head.previousDigest !== object.previousDigest
    || head.journalDigest !== sha256(objectBytes) || object.journal?.runId !== session.runId
    || object.journal?.planDigest !== session.planDigest || object.journal?.releaseId !== report.release.releaseId
    || object.journal?.desiredRevision !== summary.desiredRevision || object.journal?.updatedAt !== summary.updatedAt
    || object.journal?.revision !== summary.journalRevision) throw new Error(`${label} uncommitted journal authority is inconsistent`);
  const counts = { running: 0, verified: 0, inapplicable: 0, blocked: 0, failed: 0, interrupted: 0 };
  if (!Array.isArray(object.journal?.entries)) throw new Error(`${label} journal entries are missing`);
  for (const entry of object.journal.entries) if (Object.hasOwn(counts, entry?.status)) counts[entry.status] += 1;
  if (JSON.stringify(counts) !== JSON.stringify(summary.taskCounts) || counts.interrupted < 1) throw new Error(`${label} runs-list counts differ from journal authority`);
  const commits = path.join(authorityDirectory, 'commits');
  const commitStat = fs.lstatSync(commits);
  if (!commitStat.isDirectory() || commitStat.isSymbolicLink() || fs.readdirSync(commits).length !== 0
    || fs.existsSync(path.join(authorityState, 'owner.json'))) throw new Error(`${label} run is committed or actively owned`);
  if (session.completion.exitStatus !== 0 || !/^[a-f0-9]{64}$/.test(session.completion.transcriptDigest)
    || !/^[a-f0-9]{64}$/.test(session.completion.authorityDigest)) throw new Error(`${label} completion identity is invalid`);
  const completionTranscriptBytes = fs.readFileSync(evidenceFile(session.completion.transcriptPath, `${label} completion transcript`));
  if (sha256(completionTranscriptBytes) !== session.completion.transcriptDigest) throw new Error(`${label} completion transcript digest mismatch`);
  const completionTranscript = completionTranscriptBytes.toString('utf8');
  const visibleCompletion = completionTranscript.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
  const completionAssertions = {
    completionAltScreenEntered: completionTranscript.includes('\u001b[?1049h') && completionTranscript.includes('\u001b[?25l'),
    completionTerminalRestored: completionTranscript.includes('\u001b[?25h\u001b[?1049l'),
    completionDesktopToolsIdentity: visibleCompletion.includes('DESKTOP TOOLS'),
  };
  if (Object.values(completionAssertions).some(value => value !== true)) throw new Error(`${label} completion transcript lacks required TUI lifecycle evidence`);
  const completionProof = validateInstallAuthority(session.completion.authority, `${label}.completion.authority`, 'online');
  if (completionProof.runId !== session.runId || completionProof.planDigest !== session.planDigest
    || completionProof.authorityDigest !== session.completion.authorityDigest) throw new Error(`${label} completion does not commit the interrupted run authority`);
  return { transcriptDigest: session.transcriptDigest, runsListDigest: session.runsListDigest,
    planArtifactDigest: sha256(planBytes), journalHeadDigest: sha256(headBytes), journalObjectDigest: sha256(objectBytes),
    exitStatus: session.exitStatus, ...assertions, runId: session.runId, planDigest: session.planDigest, resumeCandidate: true,
    completionTranscriptDigest: session.completion.transcriptDigest, completionAuthorityDigest: completionProof.authorityDigest,
    completionExitStatus: session.completion.exitStatus, ...completionAssertions, completionRunId: completionProof.runId,
    completionPlanDigest: completionProof.planDigest, completionStatus: 'success' };
};
const directTui = validateInteractiveSession(interactiveTui.directUser, 'interactiveTui.directUser');
const rootTui = validateInteractiveSession(interactiveTui.rootHandoff, 'interactiveTui.rootHandoff');
if (directTui.runId === rootTui.runId) throw new Error('interactive TUI sessions must prove distinct interrupted runs');
phaseProof.interactiveTui = { ...phaseProof.interactiveTui, releaseId: report.release.releaseId,
  sourceCommit: report.release.sourceCommit, manifestDigest: report.release.manifestDigest,
  directUser: directTui, rootHandoff: rootTui };

const clean = validateInstallAuthority(structured.cleanInstall, 'cleanInstall', 'online');
const upgrade = validateInstallAuthority(structured.upgrade, 'upgrade', 'online');
const resumed = structured.interruptedResume;
for (const key of ['interruptedRunId','interruptStatus']) if (!(key in resumed)) throw new Error('interruptedResume fields are invalid');
const resumedBase = Object.fromEntries(Object.entries(resumed).filter(([key]) => !['interruptedRunId','interruptStatus'].includes(key)));
const resumeProof = validateInstallAuthority(resumedBase, 'interruptedResume', 'online');
if (resumed.interruptedRunId !== upgrade.runId || resumed.runId !== upgrade.runId || ![124,143].includes(resumed.interruptStatus)) throw new Error('interrupted run was not the committed upgrade run');
if (resumeProof.interruptedTaskIds.length === 0) throw new Error('interrupted resume has no committed interrupted journal state');
if (clean.planDigest === upgrade.planDigest || clean.mutatedTaskIds.length === 0 || upgrade.mutatedTaskIds.length === 0) throw new Error('clean install and upgrade require committed mutations under different plans');
const unchanged = validateInstallAuthority(structured.unchangedSecondRun, 'unchangedSecondRun', 'online');
if (unchanged.mutatedTaskIds.length !== 0 || !/^[a-f0-9]{64}$/.test(unchanged.beforeFingerprint)
  || unchanged.beforeFingerprint !== unchanged.afterFingerprint) throw new Error('unchanged second run is not a committed zero-mutation postcondition');
const offline = validateInstallAuthority(structured.offlineExecution, 'offlineExecution', 'offline');
if (offline.planDigest === upgrade.planDigest) throw new Error('offline execution did not produce a distinct desired-state-bound plan');
for (const proof of [clean, upgrade, resumeProof, unchanged, offline]) {
  phaseProof[proof === clean ? 'cleanInstall' : proof === upgrade ? 'upgrade' : proof === resumeProof ? 'interruptedResume' : proof === unchanged ? 'unchangedSecondRun' : 'offlineExecution'] = {
    ...phaseProof[proof === clean ? 'cleanInstall' : proof === upgrade ? 'upgrade' : proof === resumeProof ? 'interruptedResume' : proof === unchanged ? 'unchangedSecondRun' : 'offlineExecution'],
    authorityDigest: proof.authorityDigest, runId: proof.runId, planDigest: proof.planDigest,
    executionMode: proof.executionMode, selectedTaskIds: proof.selectedTaskIds,
    attemptedTaskIds: proof.attemptedTaskIds, mutatedTaskIds: proof.mutatedTaskIds, interruptedTaskIds: proof.interruptedTaskIds,
    postconditions: proof.postconditions, serviceRestoration: proof.serviceRestoration,
  };
}

const rollback = structured.configRollback;
exact(rollback, ['schemaVersion','rollbackRunId','planDigest','authorityRoot'], 'configRollback');
if (rollback.schemaVersion !== 2 || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(rollback.rollbackRunId) || !/^[a-f0-9]{64}$/.test(rollback.planDigest)) throw new Error('rollback identity is invalid');
const rollbackAuthority = relative => `${rollback.authorityRoot}/${relative}`;
const rollbackCommitBytes = fs.readFileSync(evidenceFile(rollbackAuthority('commit.json'), 'rollback commit'));
const rollbackCommit = JSON.parse(rollbackCommitBytes.toString('utf8'));
if (rollbackCommit.rollbackRunId !== rollback.rollbackRunId || rollbackCommit.planDigest !== rollback.planDigest) throw new Error('rollback commit identity mismatch');
const rollbackPlan = readBound(rollbackAuthority('plan.json'), rollbackCommit.plan.sha256, 'rollback plan').value;
const rollbackReceipt = readBound(rollbackAuthority('receipt.json'), rollbackCommit.receipt.sha256, 'rollback receipt').value;
const rollbackEvents = rollbackCommit.events.map((artifact, index) => readBound(rollbackAuthority(`events/${String(index).padStart(8,'0')}.json`), artifact.sha256, `rollback event ${index}`).value);
if (rollbackPlan.digest !== rollback.planDigest || rollbackReceipt.completed !== true || rollbackReceipt.status !== 'succeeded'
  || rollbackEvents.at(-1)?.kind !== 'rollback-run-finished' || rollbackEvents.at(-1)?.status !== 'succeeded') throw new Error('rollback is not committed successful lifecycle evidence');
const restored = rollbackEvents.filter(event => event.kind === 'rollback-task-restored').map(event => event.taskId);
if (JSON.stringify(restored) !== JSON.stringify(rollbackPlan.taskOrder)) throw new Error('rollback did not restore its exact committed task order');
phaseProof.configRollback = { ...phaseProof.configRollback, authorityDigest: sha256(rollbackCommitBytes),
  rollbackRunId: rollback.rollbackRunId, planDigest: rollback.planDigest, restoredTaskIds: restored };

const failureScenarios = structured.failureScenarios;
exact(failureScenarios, ['schemaVersion','releaseId','sourceCommit','runtime','runnerDigest','scenarios'], 'failureScenarios');
const requiredFailureScenarios = ['denial','expiry','hosted-service-outage','profile-race','provider-outage','recording-failure','replay','rollback-modified-target','telemetry-timeout'];
if (failureScenarios.schemaVersion !== 1 || failureScenarios.releaseId !== report.release.releaseId
  || failureScenarios.sourceCommit !== report.release.sourceCommit || !/^v\d+\.\d+\.\d+/u.test(failureScenarios.runtime)
  || !/^[a-f0-9]{64}$/u.test(failureScenarios.runnerDigest) || !Array.isArray(failureScenarios.scenarios)) {
  throw new Error('failure scenario matrix identity is invalid');
}
const failureIds = failureScenarios.scenarios.map(item => item?.id).sort();
if (JSON.stringify(failureIds) !== JSON.stringify(requiredFailureScenarios)) throw new Error('failure scenario matrix coverage is incomplete');
for (const scenario of failureScenarios.scenarios) {
  exact(scenario, ['id','source','sourceDigest','testName','exitStatus','transcriptPath','transcriptDigest'], `failureScenarios.${scenario.id}`);
  if (!requiredFailureScenarios.includes(scenario.id) || scenario.exitStatus !== 0
    || !scenario.source.startsWith('packages/') || scenario.source.includes('..')
    || !/^[a-f0-9]{64}$/u.test(scenario.sourceDigest) || !/^[a-f0-9]{64}$/u.test(scenario.transcriptDigest)
    || typeof scenario.testName !== 'string' || scenario.testName.length < 10) throw new Error(`invalid failure scenario proof: ${scenario.id}`);
  const transcript = fs.readFileSync(evidenceFile(scenario.transcriptPath, `failureScenarios.${scenario.id}.transcript`));
  if (sha256(transcript) !== scenario.transcriptDigest || !transcript.toString('utf8').includes(scenario.testName)) {
    throw new Error(`failure scenario transcript is invalid: ${scenario.id}`);
  }
}
phaseProof.failureScenarios = { ...phaseProof.failureScenarios, releaseId: failureScenarios.releaseId,
  sourceCommit: failureScenarios.sourceCommit, runtime: failureScenarios.runtime, scenarioIds: failureIds };

const evidenceDigest = sha256(JSON.stringify(phaseProof));
const receipt = {
  schemaVersion: 2, receiptId: `canary-${cell.id}-${runId}`, evidenceClass: 'real-host-canary', scope: 'full-lifecycle', cellId: cell.id,
  tuple: report.observed, release: report.release, result: 'passed', recordedAt: new Date().toISOString(),
  coverage: matrix.requiredVerifiedCoverage,
  proof: { provider: 'github-actions', runnerEnvironment: 'github-hosted', disposable: true, hermetic: false,
    workflowCommit, workflowRunId: runId, evidenceDigest, phases: phaseProof },
};
fs.writeFileSync(outputFile, `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: 'wx' });
