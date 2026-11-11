#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  if (!args[index + 1]) throw new Error(`${flag} requires a value`);
  return args[index + 1];
};
const manifestPath = resolve(root, valueAfter('--manifest') ?? 'config/desktop-tools-program.json');
const outputArg = valueAfter('--output');
const outputPath = outputArg ? resolve(root, outputArg) : undefined;

const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields must be exactly ${expected.join(', ')}`);
  }
  return value;
};
const nonempty = (value, label) => {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) throw new Error(`${label} must be a non-empty trimmed string`);
  return value;
};
const stringArray = (value, label, { allowEmpty = false } = {}) => {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  const result = value.map((item, index) => nonempty(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return result;
};
const assertUnique = (items, key, label) => {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item[key])) throw new Error(`duplicate ${label}: ${item[key]}`);
    seen.add(item[key]);
  }
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const repoPath = (path) => {
  const absolute = resolve(root, path);
  if (relative(root, absolute).startsWith('..') || isAbsolute(relative(root, absolute))) throw new Error(`path escapes repository: ${path}`);
  return absolute;
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
exactKeys(manifest, ['schemaVersion', 'programId', 'horizons', 'admissionGates', 'authorities', 'completionEvidence', 'initiatives'], 'program manifest');
if (manifest.schemaVersion !== 2) throw new Error('unsupported program manifest schemaVersion');
if (manifest.programId !== 'desktop-tools-50-initiative-program') throw new Error('unexpected programId');
if (!Array.isArray(manifest.horizons) || manifest.horizons.length !== 5) throw new Error('program must declare exactly five horizons');
if (!Array.isArray(manifest.admissionGates) || manifest.admissionGates.length === 0) throw new Error('program must declare admission gates');
if (!Array.isArray(manifest.authorities) || manifest.authorities.length === 0) throw new Error('program must declare authorities');
if (!Array.isArray(manifest.completionEvidence)) throw new Error('program completionEvidence must be an array');
if (!Array.isArray(manifest.initiatives) || manifest.initiatives.length !== 50) throw new Error('program must declare exactly I01-I50');

const horizonIds = new Set();
for (const [index, horizon] of manifest.horizons.entries()) {
  exactKeys(horizon, ['id', 'name', 'dependsOn'], `horizons[${index}]`);
  if (horizon.id !== `H${index + 1}`) throw new Error(`horizon order must be H1-H5; found ${horizon.id}`);
  nonempty(horizon.name, `horizons[${index}].name`);
  stringArray(horizon.dependsOn, `horizons[${index}].dependsOn`, { allowEmpty: true });
  for (const dependency of horizon.dependsOn) {
    if (!horizonIds.has(dependency)) throw new Error(`${horizon.id} depends on unknown or later horizon ${dependency}`);
  }
  horizonIds.add(horizon.id);
}

const initiativeIds = new Set(manifest.initiatives.map(({ id }) => id));
const validGateStatuses = new Set(['PASS', 'BLOCKED', 'UNVERIFIED']);
for (const [index, gate] of manifest.admissionGates.entries()) {
  exactKeys(gate, ['id', 'requiredFor', 'evidence', 'status', 'reason'], `admissionGates[${index}]`);
  nonempty(gate.id, `admissionGates[${index}].id`);
  stringArray(gate.requiredFor, `admissionGates[${index}].requiredFor`, { allowEmpty: true });
  stringArray(gate.evidence, `admissionGates[${index}].evidence`, { allowEmpty: true });
  if (!validGateStatuses.has(gate.status)) throw new Error(`invalid admission status for ${gate.id}`);
  nonempty(gate.reason, `admissionGates[${index}].reason`);
  if (gate.status === 'PASS' && gate.evidence.length === 0) throw new Error(`${gate.id} cannot PASS without evidence`);
  for (const id of gate.requiredFor) if (!initiativeIds.has(id)) throw new Error(`${gate.id} references unknown initiative ${id}`);
}
assertUnique(manifest.admissionGates, 'id', 'admission gate');

const completionDimensions = ['code', 'deployment', 'host', 'verification'];
const evidenceClasses = new Map([
  ['code', new Set(['source-attestation'])],
  ['deployment', new Set(['deployment-receipt'])],
  ['host', new Set(['host-receipt'])],
  ['verification', new Set(['test-receipt', 'independent-review'])],
]);
const completionEvidence = [];
for (const [index, evidence] of manifest.completionEvidence.entries()) {
  exactKeys(evidence, ['id', 'initiativeId', 'dimension', 'evidenceClass', 'path', 'sha256', 'target',
    'observedAt', 'expiresAt'], `completionEvidence[${index}]`);
  nonempty(evidence.id, `completionEvidence[${index}].id`);
  if (!initiativeIds.has(evidence.initiativeId)) throw new Error(`${evidence.id} references unknown initiative ${evidence.initiativeId}`);
  if (!completionDimensions.includes(evidence.dimension)) throw new Error(`${evidence.id} has invalid evidence dimension`);
  if (!evidenceClasses.get(evidence.dimension).has(evidence.evidenceClass)) {
    throw new Error(`${evidence.id} has invalid class for ${evidence.dimension} evidence`);
  }
  nonempty(evidence.path, `${evidence.id}.path`);
  if (!/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new Error(`${evidence.id}.sha256 must be a SHA-256 digest`);
  nonempty(evidence.target, `${evidence.id}.target`);
  if (Number.isNaN(Date.parse(evidence.observedAt))) throw new Error(`${evidence.id}.observedAt must be an RFC 3339 instant`);
  if (evidence.expiresAt !== null && Number.isNaN(Date.parse(evidence.expiresAt))) {
    throw new Error(`${evidence.id}.expiresAt must be null or an RFC 3339 instant`);
  }
  const evidencePath = repoPath(evidence.path);
  if (!existsSync(evidencePath) || !lstatSync(evidencePath).isFile() || lstatSync(evidencePath).isSymbolicLink()) {
    throw new Error(`${evidence.id} evidence must be an existing regular non-symlink file`);
  }
  if (evidence.expiresAt !== null && Date.parse(evidence.expiresAt) <= Date.parse(evidence.observedAt)) {
    throw new Error(`${evidence.id}.expiresAt must follow observedAt`);
  }
  if (/^(?:openspec\/|docs\/|config\/)/.test(evidence.path)) {
    throw new Error(`${evidence.id} cannot use planning, documentation, or generated configuration as completion evidence`);
  }
  const bytes = readFileSync(evidencePath);
  if (createHash('sha256').update(bytes).digest('hex') !== evidence.sha256) throw new Error(`${evidence.id} evidence digest mismatch`);
  let receipt;
  try { receipt = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`${evidence.id} evidence must be a JSON receipt`); }
  exactKeys(receipt, ['schemaVersion', 'evidenceId', 'initiativeId', 'dimension', 'evidenceClass', 'target',
    'result', 'observedAt', 'expiresAt'], `${evidence.id} receipt`);
  if (receipt.schemaVersion !== 1 || receipt.evidenceId !== evidence.id || receipt.initiativeId !== evidence.initiativeId
    || receipt.dimension !== evidence.dimension || receipt.evidenceClass !== evidence.evidenceClass
    || receipt.target !== evidence.target || receipt.observedAt !== evidence.observedAt
    || receipt.expiresAt !== evidence.expiresAt || receipt.result !== 'verified') {
    throw new Error(`${evidence.id} receipt does not exactly match its verified completion claim`);
  }
  completionEvidence.push(evidence);
}
assertUnique(completionEvidence, 'id', 'completion evidence');

const authorityKinds = new Set(['desired', 'observed', 'transitional']);
for (const [index, authority] of manifest.authorities.entries()) {
  exactKeys(authority, ['domain', 'kind', 'authority', 'evidencePaths', 'status'], `authorities[${index}]`);
  nonempty(authority.domain, `authorities[${index}].domain`);
  if (!authorityKinds.has(authority.kind)) throw new Error(`invalid authority kind for ${authority.domain}`);
  nonempty(authority.authority, `authorities[${index}].authority`);
  stringArray(authority.evidencePaths, `authorities[${index}].evidencePaths`);
  nonempty(authority.status, `authorities[${index}].status`);
}
assertUnique(manifest.authorities, 'domain', 'authority domain');
const desiredState = manifest.authorities.find(({ domain }) => domain === 'desired-state');
const observedState = manifest.authorities.find(({ domain }) => domain === 'observed-state');
if (desiredState?.kind !== 'desired' || observedState?.kind !== 'observed' || desiredState.authority === observedState.authority) {
  throw new Error('desired-state and observed-state must have distinct explicit authorities');
}

const activeChangesDir = join(root, 'openspec', 'changes');
const changeNames = new Set(readdirSync(activeChangesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
const validInitiativeStatuses = new Set(['planned', 'in-progress', 'blocked', 'complete']);
for (const [index, initiative] of manifest.initiatives.entries()) {
  exactKeys(initiative, ['id', 'title', 'capability', 'ownerChange', 'horizon', 'implementationFiles', 'verificationFiles', 'hostTargets', 'status'], `initiatives[${index}]`);
  const expectedId = `I${String(index + 1).padStart(2, '0')}`;
  if (initiative.id !== expectedId) throw new Error(`initiative order must be I01-I50; found ${initiative.id}`);
  nonempty(initiative.title, `${initiative.id}.title`);
  nonempty(initiative.capability, `${initiative.id}.capability`);
  nonempty(initiative.ownerChange, `${initiative.id}.ownerChange`);
  if (!changeNames.has(initiative.ownerChange)) throw new Error(`${initiative.id} owner change does not exist: ${initiative.ownerChange}`);
  if (!horizonIds.has(initiative.horizon)) throw new Error(`${initiative.id} has unknown horizon ${initiative.horizon}`);
  stringArray(initiative.implementationFiles, `${initiative.id}.implementationFiles`);
  stringArray(initiative.verificationFiles, `${initiative.id}.verificationFiles`);
  stringArray(initiative.hostTargets, `${initiative.id}.hostTargets`);
  if (!validInitiativeStatuses.has(initiative.status)) throw new Error(`${initiative.id} has invalid status`);
}
assertUnique(manifest.initiatives, 'id', 'initiative');

const now = Date.now();
const evidenceByInitiative = new Map(manifest.initiatives.map(({ id }) => [id, []]));
for (const evidence of completionEvidence) evidenceByInitiative.get(evidence.initiativeId).push(evidence);
for (const initiative of manifest.initiatives) {
  if (initiative.status !== 'complete') continue;
  const current = evidenceByInitiative.get(initiative.id).filter(({ expiresAt }) => expiresAt === null || Date.parse(expiresAt) > now);
  const missing = completionDimensions.filter((dimension) => !current.some((evidence) => evidence.dimension === dimension));
  if (missing.length > 0) {
    throw new Error(`${initiative.id} cannot be complete without current ${missing.join(', ')} evidence`);
  }
}

const changeProgress = (changeName) => {
  const taskPath = join(activeChangesDir, changeName, 'tasks.md');
  if (!existsSync(taskPath)) return { complete: 0, total: 0, state: 'no-task-ledger', tasksDigest: null };
  const text = readFileSync(taskPath, 'utf8');
  const tracked = [...text.matchAll(/^- \[([ xX])\] /gm)];
  const complete = tracked.filter((match) => match[1].toLowerCase() === 'x').length;
  return {
    complete,
    total: tracked.length,
    state: tracked.length > 0 && complete === tracked.length ? 'complete' : 'in-progress',
    tasksDigest: createHash('sha256').update(text).digest('hex'),
  };
};
const ownerNames = [...new Set(manifest.initiatives.map(({ ownerChange }) => ownerChange))].sort();
const owners = ownerNames.map((change) => ({ change, ...changeProgress(change) }));
const gatesByInitiative = new Map(manifest.initiatives.map(({ id }) => [id, []]));
for (const gate of manifest.admissionGates) for (const id of gate.requiredFor) gatesByInitiative.get(id).push(gate);

const initiatives = manifest.initiatives.map((initiative) => {
  const gates = gatesByInitiative.get(initiative.id);
  const blockedBy = gates.filter(({ status }) => status === 'BLOCKED').map(({ id }) => id).sort();
  const unverifiedBy = gates.filter(({ status }) => status === 'UNVERIFIED').map(({ id }) => id).sort();
  const effectiveStatus = blockedBy.length > 0 ? 'BLOCKED' : unverifiedBy.length > 0 ? 'UNVERIFIED' : initiative.status;
  const pathEvidence = (paths) => paths.map((path) => ({ path, present: existsSync(repoPath(path)) }));
  const receipts = evidenceByInitiative.get(initiative.id).map((evidence) => ({ ...evidence,
    current: evidence.expiresAt === null || Date.parse(evidence.expiresAt) > now }));
  const evidenceDimensions = Object.fromEntries(completionDimensions.map((dimension) => {
    const matching = receipts.filter((evidence) => evidence.dimension === dimension);
    return [dimension, {
      status: matching.some(({ current }) => current) ? 'VERIFIED' : matching.length > 0 ? 'STALE' : 'MISSING',
      evidenceIds: matching.map(({ id }) => id).sort(),
    }];
  }));
  return {
    ...initiative,
    effectiveStatus,
    blockedBy,
    unverifiedBy,
    implementationEvidence: pathEvidence(initiative.implementationFiles),
    verificationEvidence: pathEvidence(initiative.verificationFiles),
    completionEvidence: evidenceDimensions,
    completionEligible: completionDimensions.every((dimension) => evidenceDimensions[dimension].status === 'VERIFIED'),
  };
});

const horizonReports = manifest.horizons.map((horizon) => {
  const rows = initiatives.filter(({ horizon: id }) => id === horizon.id);
  const dependenciesComplete = horizon.dependsOn.every((dependency) => {
    const dependencyRows = initiatives.filter(({ horizon: id }) => id === dependency);
    return dependencyRows.length > 0 && dependencyRows.every(({ effectiveStatus }) => effectiveStatus === 'complete');
  });
  const ready = rows.filter(({ effectiveStatus }) => !['BLOCKED', 'complete'].includes(effectiveStatus)).map(({ id }) => id);
  return {
    ...horizon,
    status: rows.every(({ effectiveStatus }) => effectiveStatus === 'complete') ? 'complete' : dependenciesComplete ? 'active' : 'waiting-on-dependency',
    ready,
    blocked: rows.filter(({ effectiveStatus }) => effectiveStatus === 'BLOCKED').map(({ id }) => id),
    unverified: rows.filter(({ effectiveStatus }) => effectiveStatus === 'UNVERIFIED').map(({ id }) => id),
    workInProgress: rows.filter(({ status }) => status === 'in-progress').map(({ id }) => id),
  };
});

const reportCore = {
  schemaVersion: 2,
  programId: manifest.programId,
  manifestDigest: digest(manifest),
  authorities: manifest.authorities,
  admissionGates: manifest.admissionGates,
  owners,
  horizons: horizonReports,
  initiatives,
  summary: {
    initiatives: initiatives.length,
    owners: owners.length,
    blocked: initiatives.filter(({ effectiveStatus }) => effectiveStatus === 'BLOCKED').length,
    unverified: initiatives.filter(({ effectiveStatus }) => effectiveStatus === 'UNVERIFIED').length,
    inProgress: initiatives.filter(({ status }) => status === 'in-progress').length,
    complete: initiatives.filter(({ effectiveStatus }) => effectiveStatus === 'complete').length,
  },
};
const report = { ...reportCore, reportDigest: digest(reportCore) };
const output = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output, { mode: 0o644 });
}
process.stdout.write(outputArg ? `${JSON.stringify({ output: relative(root, outputPath), ...report.summary })}\n` : output);
