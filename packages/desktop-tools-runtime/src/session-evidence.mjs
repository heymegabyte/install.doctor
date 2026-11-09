import { chmod, lstat, mkdir, open, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(message, code = 65) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function exactObject(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} has an invalid shape`);
  }
}

function identifier(value, label) {
  if (typeof value !== 'string' || !identifierPattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !digestPattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} is invalid`);
  return value;
}

function sortedIdentifiers(values, label) {
  if (!Array.isArray(values) || values.length > 128) fail(`${label} is invalid`);
  const parsed = values.map(value => identifier(value, label));
  if (parsed.some((value, index) => index > 0 && parsed[index - 1] >= value)) fail(`${label} must be sorted and unique`);
  return parsed;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export async function loadSessionContext(pathInput) {
  if (typeof pathInput !== 'string' || !isAbsolute(pathInput) || pathInput.includes('\0')) fail('session context must be an absolute path');
  const path = resolve(pathInput);
  let value;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > 65_536) {
      fail('session context must be one bounded regular file');
    }
    const bytes = await readFile(path, 'utf8');
    value = JSON.parse(bytes);
  } catch (error) {
    if (error?.exitCode) throw error;
    fail('session context must be readable valid JSON');
  }
  exactObject(value, ['schemaVersion', 'sessionId', 'runId', 'parentSessionId', 'parentRunId', 'createdAt', 'machine', 'actor', 'authorization'], 'session context');
  exactObject(value.machine, ['id', 'fingerprint'], 'machine binding');
  exactObject(value.actor, ['id'], 'actor binding');
  exactObject(value.authorization, ['id', 'scopes', 'expiresAt'], 'authorization binding');
  if (value.schemaVersion !== 1) fail('unsupported session context version');
  for (const [label, child] of [
    ['session id', value.sessionId], ['run id', value.runId], ['machine id', value.machine.id],
    ['actor id', value.actor.id], ['authorization id', value.authorization.id],
  ]) identifier(child, label);
  for (const [label, child] of [['parent session id', value.parentSessionId], ['parent run id', value.parentRunId]]) {
    if (child !== null) identifier(child, label);
  }
  digest(value.machine.fingerprint, 'machine fingerprint');
  sortedIdentifiers(value.authorization.scopes, 'authorization scopes');
  timestamp(value.createdAt, 'session creation timestamp');
  timestamp(value.authorization.expiresAt, 'authorization expiry');
  if (Date.parse(value.authorization.expiresAt) <= Date.parse(value.createdAt)) fail('authorization must outlive session creation');
  return canonical(value);
}

async function durableExclusiveWrite(path, bytes) {
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8').catch(() => '') !== bytes) fail('session evidence collision', 73);
  } finally {
    await handle?.close();
  }
}

export async function persistSessionContext(stateDirectory, session) {
  const directory = join(stateDirectory, 'config', 'sessions');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, `${session.sessionId}.json`);
  await durableExclusiveWrite(path, `${JSON.stringify(canonical(session))}\n`);
  return path;
}

export async function initializeSessionEvidence(input) {
  const { stateDirectory, session, promptBinding, runtime, skills, tools } = input;
  const header = canonical({
    schemaVersion: 1,
    evidenceState: 'headers-persisted',
    captureComplete: false,
    sessionId: session.sessionId,
    runId: session.runId,
    parentSessionId: session.parentSessionId,
    parentRunId: session.parentRunId,
    createdAt: session.createdAt,
    profile: promptBinding.context.profile,
    machine: session.machine,
    actor: session.actor,
    authorization: session.authorization,
    release: promptBinding.context.release,
    prompt: {
      version: promptBinding.context.promptVersion,
      digest: promptBinding.context.promptDigest,
      contextDigest: promptBinding.context.contextDigest,
    },
    runtime,
    skills,
    tools,
    recording: {
      state: 'incomplete',
      incompleteReason: 'consent-key-and-capture-stream-not-attached',
    },
  });
  const historyPath = join(stateDirectory, 'history', `${session.sessionId}.json`);
  const recordingPath = join(stateDirectory, 'recordings', `${session.sessionId}.header.json`);
  const bytes = `${JSON.stringify(header)}\n`;
  // History is deliberately written first. If recording initialization fails, the
  // durable History row remains captureComplete=false and launch is denied.
  await durableExclusiveWrite(historyPath, bytes);
  await durableExclusiveWrite(recordingPath, bytes);
  return Object.freeze({ historyPath, recordingPath, captureComplete: false });
}
