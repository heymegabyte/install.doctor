#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matrixPath = path.resolve(process.argv[2] ?? path.join(repositoryRoot, 'scripts/platform-support-matrix.json'));
const evidenceRoot = path.resolve(process.argv[3] ?? repositoryRoot);
const errors = [];
const allowedStatuses = new Set(['verified', 'best-effort', 'unsupported']);
const allowedKinds = new Set(['workflow-definition', 'fixture-definition', 'hermetic-receipt', 'canary-receipt']);
const requiredCoverage = ['stage-zero', 'plan', 'apply', 'verify', 'unchanged-reapply', 'interrupted-resume', 'config-rollback', 'headless', 'interactive-tui', 'offline'];
const canonicalDigest = value => {
  const canonical = input => Array.isArray(input) ? input.map(canonical) : input !== null && typeof input === 'object'
    ? Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)])) : input;
  return crypto.createHash('sha256').update(`${JSON.stringify(canonical(value))}\n`).digest('hex');
};

const report = (location, message) => errors.push(`${location}: ${message}`);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const exactKeys = (value, allowed, location) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    report(location, 'must be an object');
    return false;
  }
  for (const key of Object.keys(value)) if (!allowed.has(key)) report(location, `unknown field ${key}`);
  return true;
};
const safeEvidencePath = (relativePath, location) => {
  if (!nonempty(relativePath) || path.isAbsolute(relativePath) || relativePath.split('/').includes('..')) {
    report(location, 'must be a safe repository-relative file path'); return null;
  }
  const resolved = path.resolve(evidenceRoot, relativePath);
  if (resolved !== evidenceRoot && !resolved.startsWith(`${evidenceRoot}${path.sep}`)) { report(location, 'escapes the evidence root'); return null; }
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) { report(location, 'must reference a regular nonsymlink file'); return null; }
  } catch { report(location, `does not exist: ${relativePath}`); return null; }
  return resolved;
};

const validateCanaryReceipt = (receiptPath, cell, location) => {
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); }
  catch (error) { report(location, `receipt is unreadable JSON: ${error.message}`); return false; }
  exactKeys(receipt, new Set(['schemaVersion', 'receiptId', 'evidenceClass', 'scope', 'cellId', 'tuple', 'release', 'result', 'recordedAt', 'coverage', 'proof', 'promotion']), location);
  if (receipt.schemaVersion !== 3) report(`${location}.schemaVersion`, 'must equal 3; self-authored canary receipts cannot promote support');
  exactKeys(receipt.promotion, new Set(['schemaVersion','verifier','canaryDigest','promotionDigest','bindings','verifiedAt']), `${location}.promotion`);
  if (receipt.promotion?.schemaVersion !== 1 || receipt.promotion?.verifier !== 'independent-offline-authority') report(`${location}.promotion`, 'must be minted by the independent offline-authority verifier');
  for (const field of ['canaryDigest','promotionDigest']) if (!/^[a-f0-9]{64}$/.test(receipt.promotion?.[field] ?? '')) report(`${location}.promotion.${field}`, 'must be a SHA-256 digest');
  const requiredBindings = ['requestDigest','requestAuthorityDelegationDigest','requestAttestationDigest','delegationDigest','manifestDigest','ciEvidenceDigest','journalRevision','journalDigest','journalCommitDigest','networkIsolationDigest'];
  exactKeys(receipt.promotion?.bindings, new Set(requiredBindings), `${location}.promotion.bindings`);
  for (const field of requiredBindings.filter(field => field !== 'journalRevision')) if (!/^[a-f0-9]{64}$/.test(receipt.promotion?.bindings?.[field] ?? '')) report(`${location}.promotion.bindings.${field}`, 'must be a SHA-256 digest');
  if (!Number.isInteger(receipt.promotion?.bindings?.journalRevision) || receipt.promotion.bindings.journalRevision < 0) report(`${location}.promotion.bindings.journalRevision`, 'must be a nonnegative journal revision');
  if (receipt.promotion?.promotionDigest !== canonicalDigest(receipt.promotion?.bindings)) report(`${location}.promotion.promotionDigest`, 'must canonically bind every independently verified authority');
  if (!Number.isFinite(Date.parse(receipt.promotion?.verifiedAt))) report(`${location}.promotion.verifiedAt`, 'must be a timestamp');
  if (!nonempty(receipt.receiptId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(receipt.receiptId ?? '')) report(`${location}.receiptId`, 'must be lowercase kebab-case');
  if (receipt.evidenceClass !== 'real-host-canary') report(`${location}.evidenceClass`, 'must equal real-host-canary; hermetic evidence cannot promote support');
  if (receipt.scope !== 'full-lifecycle') report(`${location}.scope`, 'must equal full-lifecycle');
  if (receipt.cellId !== cell.id) report(`${location}.cellId`, 'must match the matrix cell');
  exactKeys(receipt.tuple, new Set(['os', 'version', 'arch', 'environment', 'role']), `${location}.tuple`);
  for (const key of ['os', 'version', 'arch', 'environment', 'role']) if (receipt.tuple?.[key] !== cell[key]) report(`${location}.tuple.${key}`, 'must exactly match the matrix tuple');
  exactKeys(receipt.release, new Set(['releaseId', 'sourceCommit', 'manifestDigest']), `${location}.release`);
  if (!nonempty(receipt.release?.releaseId)) report(`${location}.release.releaseId`, 'must identify the tested immutable release');
  if (!/^[a-f0-9]{40}$/.test(receipt.release?.sourceCommit ?? '')) report(`${location}.release.sourceCommit`, 'must be a 40-character lowercase Git commit');
  if (!/^[a-f0-9]{64}$/.test(receipt.release?.manifestDigest ?? '')) report(`${location}.release.manifestDigest`, 'must be a SHA-256 digest');
  if (receipt.result !== 'passed') report(`${location}.result`, 'must equal passed');
  const recordedAt = Date.parse(receipt.recordedAt);
  if (typeof receipt.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.recordedAt) || !Number.isFinite(recordedAt)) report(`${location}.recordedAt`, 'must be a canonical UTC ISO timestamp');
  const maxAge = matrix.verifiedMaxAgeDays * 86_400_000;
  if (Number.isFinite(recordedAt) && (Date.now() - recordedAt > maxAge || recordedAt - Date.now() > 300_000)) report(`${location}.recordedAt`, 'is stale or in the future');
  if (JSON.stringify(receipt.coverage) !== JSON.stringify(requiredCoverage)) report(`${location}.coverage`, 'must exactly match canonical full-lifecycle coverage');
  exactKeys(receipt.proof, new Set(['provider', 'runnerEnvironment', 'disposable', 'hermetic', 'workflowCommit', 'workflowRunId', 'evidenceDigest', 'phases']), `${location}.proof`);
  if (receipt.proof?.provider !== 'github-actions') report(`${location}.proof.provider`, 'must equal github-actions');
  if (receipt.proof?.runnerEnvironment !== 'github-hosted') report(`${location}.proof.runnerEnvironment`, 'must equal github-hosted');
  if (receipt.proof?.disposable !== true) report(`${location}.proof.disposable`, 'must equal true');
  if (receipt.proof?.hermetic !== false) report(`${location}.proof.hermetic`, 'must equal false; container or fixture output cannot promote support');
  if (!/^[a-f0-9]{40}$/.test(receipt.proof?.workflowCommit ?? '')) report(`${location}.proof.workflowCommit`, 'must be a 40-character lowercase Git commit');
  if (!/^[1-9][0-9]{0,19}$/.test(receipt.proof?.workflowRunId ?? '')) report(`${location}.proof.workflowRunId`, 'must be a decimal GitHub run id');
  if (!/^[a-f0-9]{64}$/.test(receipt.proof?.evidenceDigest ?? '')) report(`${location}.proof.evidenceDigest`, 'must bind the redacted raw evidence bundle');
  const phases = ['cleanInstall', 'signedRelease', 'upgrade', 'interruptedResume', 'unchangedSecondRun', 'offlineExecution', 'configRollback', 'interactiveTui'];
  exactKeys(receipt.proof?.phases, new Set(phases), `${location}.proof.phases`);
  for (const phase of phases) {
    const value = receipt.proof?.phases?.[phase];
    const authorityFields = phase === 'signedRelease'
      ? new Set(['result', 'evidenceDigest'])
      : phase === 'interactiveTui'
        ? new Set(['result','evidenceDigest','releaseId','sourceCommit','manifestDigest','directUser','rootHandoff'])
      : phase === 'configRollback'
        ? new Set(['result', 'evidenceDigest', 'authorityDigest', 'rollbackRunId', 'planDigest', 'restoredTaskIds'])
        : new Set(['result', 'evidenceDigest', 'authorityDigest', 'runId', 'planDigest', 'executionMode', 'selectedTaskIds', 'attemptedTaskIds', 'mutatedTaskIds', 'interruptedTaskIds', 'postconditions', 'serviceRestoration', ...(phase === 'offlineExecution' ? ['offlineBundle'] : [])]);
    exactKeys(value, authorityFields, `${location}.proof.phases.${phase}`);
    if (value?.result !== 'passed') report(`${location}.proof.phases.${phase}.result`, 'must equal passed');
    if (!/^[a-f0-9]{64}$/.test(value?.evidenceDigest ?? '')) report(`${location}.proof.phases.${phase}.evidenceDigest`, 'must bind phase evidence');
    if (phase === 'signedRelease') continue;
    if (phase === 'interactiveTui') {
      if (value?.releaseId !== receipt.release?.releaseId || value?.sourceCommit !== receipt.release?.sourceCommit
        || value?.manifestDigest !== receipt.release?.manifestDigest) report(`${location}.proof.phases.${phase}`, 'must bind the exact promoted release');
      const sessionKeys = new Set(['transcriptDigest','runsListDigest','planArtifactDigest','journalHeadDigest','journalObjectDigest','exitStatus','altScreenEntered','terminalRestored','desktopToolsIdentity','workerAttribution','runId','planDigest','resumeCandidate']);
      for (const sessionName of ['directUser','rootHandoff']) {
        const session = value?.[sessionName];
        exactKeys(session, sessionKeys, `${location}.proof.phases.${phase}.${sessionName}`);
        for (const field of ['transcriptDigest','runsListDigest','planArtifactDigest','journalHeadDigest','journalObjectDigest','planDigest']) if (!/^[a-f0-9]{64}$/.test(session?.[field] ?? '')) report(`${location}.proof.phases.${phase}.${sessionName}.${field}`, 'must be a SHA-256 digest');
        if (!nonempty(session?.runId) || session?.exitStatus !== 130 || session?.altScreenEntered !== true
          || session?.terminalRestored !== true || session?.desktopToolsIdentity !== true
          || session?.workerAttribution !== true || session?.resumeCandidate !== true) {
          report(`${location}.proof.phases.${phase}.${sessionName}`, 'must prove cancelled, restored, attributable, resumable interactive execution');
        }
      }
      if (value?.directUser?.runId === value?.rootHandoff?.runId) report(`${location}.proof.phases.${phase}`, 'must bind distinct direct-user and root-handoff runs');
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(value?.authorityDigest ?? '')) report(`${location}.proof.phases.${phase}.authorityDigest`, 'must bind committed authority evidence');
    if (phase === 'configRollback') {
      if (!nonempty(value?.rollbackRunId) || !/^[a-f0-9]{64}$/.test(value?.planDigest ?? '')) report(`${location}.proof.phases.${phase}`, 'must identify the committed rollback run and plan');
      if (!Array.isArray(value?.restoredTaskIds) || value.restoredTaskIds.some((taskId, index) => !nonempty(taskId) || (index > 0 && value.restoredTaskIds[index - 1].localeCompare(taskId) >= 0))) report(`${location}.proof.phases.${phase}.restoredTaskIds`, 'must enumerate unique sorted restored tasks');
      continue;
    }
    if (!nonempty(value?.runId) || !/^[a-f0-9]{64}$/.test(value?.planDigest ?? '')) report(`${location}.proof.phases.${phase}`, 'must identify the committed install run and plan');
    const selected = new Set(value?.selectedTaskIds ?? []); const attempted = new Set(value?.attemptedTaskIds ?? []);
    if ((value?.attemptedTaskIds ?? []).some(taskId => !selected.has(taskId))) report(`${location}.proof.phases.${phase}.attemptedTaskIds`, 'must be selected tasks');
    if ((value?.mutatedTaskIds ?? []).some(taskId => !selected.has(taskId) || !attempted.has(taskId))) report(`${location}.proof.phases.${phase}.mutatedTaskIds`, 'must be selected attributable attempts');
    if ((value?.interruptedTaskIds ?? []).some(taskId => !selected.has(taskId))) report(`${location}.proof.phases.${phase}.interruptedTaskIds`, 'must be selected tasks');
    if (value?.executionMode !== (phase === 'offlineExecution' ? 'offline' : 'online')) report(`${location}.proof.phases.${phase}.executionMode`, 'does not match the phase execution mode');
    for (const field of ['selectedTaskIds', 'attemptedTaskIds', 'mutatedTaskIds', 'interruptedTaskIds']) {
      const ids = value?.[field];
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id, index) => !nonempty(id) || (index > 0 && ids[index - 1].localeCompare(id) >= 0))) {
        report(`${location}.proof.phases.${phase}.${field}`, 'must be unique sorted task identifiers');
      }
    }
    exactKeys(value?.postconditions, new Set(value?.selectedTaskIds ?? []), `${location}.proof.phases.${phase}.postconditions`);
    for (const taskId of value?.selectedTaskIds ?? []) if (!['verified','inapplicable'].includes(value?.postconditions?.[taskId])) report(`${location}.proof.phases.${phase}.postconditions.${taskId}`, 'must be a successful terminal postcondition');
    exactKeys(value?.serviceRestoration, new Set(['requiredTaskIds','restoredTaskIds']), `${location}.proof.phases.${phase}.serviceRestoration`);
    const required = value?.serviceRestoration?.requiredTaskIds; const restored = value?.serviceRestoration?.restoredTaskIds;
    if (!Array.isArray(required) || !Array.isArray(restored) || JSON.stringify(required) !== JSON.stringify(restored)) report(`${location}.proof.phases.${phase}.serviceRestoration`, 'must prove every required service restoration');
    for (const [field, ids] of [['requiredTaskIds', required], ['restoredTaskIds', restored]]) if (Array.isArray(ids)
      && ids.some((taskId, index) => !selected.has(taskId) || (index > 0 && ids[index - 1].localeCompare(taskId) >= 0))) report(`${location}.proof.phases.${phase}.serviceRestoration.${field}`, 'must contain unique sorted selected task identifiers');
    if (['cleanInstall','upgrade'].includes(phase) && value?.mutatedTaskIds?.length === 0) report(`${location}.proof.phases.${phase}.mutatedTaskIds`, 'must contain a committed attributable mutation');
    if (phase === 'unchangedSecondRun' && value?.mutatedTaskIds?.length !== 0) report(`${location}.proof.phases.${phase}.mutatedTaskIds`, 'must prove zero committed mutations');
    if (phase === 'interruptedResume' && value?.interruptedTaskIds?.length === 0) report(`${location}.proof.phases.${phase}.interruptedTaskIds`, 'must prove an interrupted journal state');
    if (phase === 'offlineExecution') {
      exactKeys(value?.offlineBundle, new Set(['manifestDigest','bundleSignerId','invocationDigest','networkIsolation']), `${location}.proof.phases.${phase}.offlineBundle`);
      if (!/^[a-f0-9]{64}$/.test(value?.offlineBundle?.manifestDigest ?? '') || !nonempty(value?.offlineBundle?.bundleSignerId)
        || !/^[a-f0-9]{64}$/.test(value?.offlineBundle?.invocationDigest ?? '')) report(`${location}.proof.phases.${phase}.offlineBundle`, 'must identify the signed bundle and invocation');
      exactKeys(value?.offlineBundle?.networkIsolation, new Set(['kind','parentNamespaceId','executionNamespaceId','startedAt','finishedAt']), `${location}.proof.phases.${phase}.offlineBundle.networkIsolation`);
      const isolation = value?.offlineBundle?.networkIsolation;
      if (isolation?.kind !== 'linux-network-namespace' || !/^net:\[[1-9][0-9]*\]$/.test(isolation?.parentNamespaceId ?? '')
        || !/^net:\[[1-9][0-9]*\]$/.test(isolation?.executionNamespaceId ?? '') || isolation?.parentNamespaceId === isolation?.executionNamespaceId
        || !Number.isFinite(Date.parse(isolation?.startedAt)) || !Number.isFinite(Date.parse(isolation?.finishedAt))) report(`${location}.proof.phases.${phase}.offlineBundle.networkIsolation`, 'must prove a distinct bounded network namespace');
    }
  }
  if (receipt.proof?.phases?.offlineExecution?.planDigest === receipt.proof?.phases?.upgrade?.planDigest) report(`${location}.proof.phases.offlineExecution.planDigest`, 'must differ from the online upgrade plan');
  return true;
};

let matrix;
try {
  matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
} catch (error) {
  console.error(`platform matrix unreadable: ${error.message}`);
  process.exit(1);
}

exactKeys(matrix, new Set(['schemaVersion', 'verifiedMaxAgeDays', 'requiredVerifiedCoverage', 'cells']), '$');
if (matrix.schemaVersion !== 1) report('$.schemaVersion', 'must equal 1');
if (!Number.isInteger(matrix.verifiedMaxAgeDays) || matrix.verifiedMaxAgeDays < 1) report('$.verifiedMaxAgeDays', 'must be a positive integer');
if (JSON.stringify(matrix.requiredVerifiedCoverage) !== JSON.stringify(requiredCoverage)) report('$.requiredVerifiedCoverage', 'must contain the complete lifecycle coverage contract in canonical order');
if (!Array.isArray(matrix.cells) || matrix.cells.length === 0) report('$.cells', 'must be a non-empty array');

const ids = new Set();
for (const [index, cell] of (Array.isArray(matrix.cells) ? matrix.cells : []).entries()) {
  const location = `$.cells[${index}]`;
  exactKeys(cell, new Set(['id', 'os', 'version', 'arch', 'environment', 'role', 'status', 'evidence', 'limitation', 'remediation']), location);
  for (const field of ['id', 'os', 'version', 'arch', 'environment', 'role', 'limitation', 'remediation']) {
    if (!nonempty(cell[field])) report(`${location}.${field}`, 'must be a non-empty string');
  }
  if (nonempty(cell.id) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cell.id)) report(`${location}.id`, 'must be a lowercase kebab-case identifier');
  if (ids.has(cell.id)) report(`${location}.id`, `duplicate id ${cell.id}`);
  ids.add(cell.id);
  if (!allowedStatuses.has(cell.status)) report(`${location}.status`, 'must be verified, best-effort, or unsupported');
  if (!Array.isArray(cell.evidence)) report(`${location}.evidence`, 'must be an array');

  const canaries = [];
  for (const [evidenceIndex, evidence] of (Array.isArray(cell.evidence) ? cell.evidence : []).entries()) {
    const evidenceLocation = `${location}.evidence[${evidenceIndex}]`;
    const allowed = evidence?.kind === 'canary-receipt' ? new Set(['kind', 'path']) : new Set(['kind', 'path', 'assertion']);
    exactKeys(evidence, allowed, evidenceLocation);
    if (!allowedKinds.has(evidence?.kind)) report(`${evidenceLocation}.kind`, 'is not a supported evidence kind');
    const resolvedEvidence = safeEvidencePath(evidence?.path, `${evidenceLocation}.path`);
    if (evidence?.kind === 'canary-receipt') {
      canaries.push(evidence);
      if (resolvedEvidence !== null) validateCanaryReceipt(resolvedEvidence, cell, `${evidenceLocation}.receipt`);
    } else if (!nonempty(evidence?.assertion)) {
      report(`${evidenceLocation}.assertion`, 'must explain what the definition proves—and what it does not');
    }
  }

  if (cell.status === 'best-effort' && cell.evidence.length === 0) report(`${location}.evidence`, 'best-effort claims require an existing fixture or workflow definition');
  if (cell.status === 'verified' && canaries.length === 0) report(`${location}.status`, 'verified claims require a fresh, passing, complete canary receipt');
}

if (errors.length > 0) {
  console.error(`platform matrix rejected (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`platform matrix valid: ${matrix.cells.length} explicit cells; ${matrix.cells.filter(cell => cell.status === 'verified').length} verified`);
