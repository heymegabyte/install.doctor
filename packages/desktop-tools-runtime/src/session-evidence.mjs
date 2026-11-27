import { chmod, lstat, mkdir, open, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** @param {string} message @param {number} [code] @returns {never} */
function fail(message, code = 65) {
  throw Object.assign(new Error(message), { exitCode: code });
}

/** @param {unknown} value @param {string[]} keys @param {string} label @returns {asserts value is Record<string, unknown>} */
function exactObject(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} has an invalid shape`);
  }
}

/** @param {unknown} value @param {string} label */
function identifier(value, label) {
  if (typeof value !== 'string' || !identifierPattern.test(value)) fail(`${label} is invalid`);
  return value;
}

/** @param {unknown} value @param {string} label */
function digest(value, label) {
  if (typeof value !== 'string' || !digestPattern.test(value)) fail(`${label} is invalid`);
  return value;
}

/** @param {unknown} value @param {string} label */
function timestamp(value, label) {
  if (typeof value !== 'string' || !timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} is invalid`);
  return value;
}

/** @param {unknown} values @param {string} label */
function sortedIdentifiers(values, label) {
  if (!Array.isArray(values) || values.length > 128) fail(`${label} is invalid`);
  /** @type {unknown[]} */
  const identifiers = values;
  const parsed = identifiers.map(value => identifier(value, label));
  if (parsed.some((value, index) => index > 0 && (parsed[index - 1] ?? '') >= value)) fail(`${label} must be sorted and unique`);
  return parsed;
}

/** @param {unknown} value @returns {unknown} */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

/** @param {unknown} pathInput */
export async function loadSessionContext(pathInput) {
  if (typeof pathInput !== 'string' || !isAbsolute(pathInput) || pathInput.includes('\0')) fail('session context must be an absolute path');
  const path = resolve(pathInput);
  /** @type {unknown} */
  let value;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > 65_536) {
      fail('session context must be one bounded regular file');
    }
    const bytes = await readFile(path, 'utf8');
    value = JSON.parse(bytes);
  } catch (error) {
    if (error && typeof error === 'object' && 'exitCode' in error && error.exitCode) throw error;
    fail('session context must be readable valid JSON');
  }
  exactObject(value, ['schemaVersion', 'sessionId', 'runId', 'parentSessionId', 'parentRunId', 'createdAt', 'machine', 'actor', 'authorization'], 'session context');
  exactObject(value.machine, ['id', 'fingerprint'], 'machine binding');
  exactObject(value.actor, ['id'], 'actor binding');
  exactObject(value.authorization, ['id', 'scopes', 'expiresAt'], 'authorization binding');
  if (value.schemaVersion !== 1) fail('unsupported session context version');
  const session = {
    schemaVersion: value.schemaVersion,
    sessionId: identifier(value.sessionId, 'session id'),
    runId: identifier(value.runId, 'run id'),
    parentSessionId: value.parentSessionId === null ? null : identifier(value.parentSessionId, 'parent session id'),
    parentRunId: value.parentRunId === null ? null : identifier(value.parentRunId, 'parent run id'),
    createdAt: timestamp(value.createdAt, 'session creation timestamp'),
    machine: { id: identifier(value.machine.id, 'machine id'), fingerprint: digest(value.machine.fingerprint, 'machine fingerprint') },
    actor: { id: identifier(value.actor.id, 'actor id') },
    authorization: {
      id: identifier(value.authorization.id, 'authorization id'),
      scopes: sortedIdentifiers(value.authorization.scopes, 'authorization scopes'),
      expiresAt: timestamp(value.authorization.expiresAt, 'authorization expiry'),
    },
  };
  if (Date.parse(session.authorization.expiresAt) <= Date.parse(session.createdAt)) fail('authorization must outlive session creation');
  // Canonicalization only reorders the validated object's keys.
  return /** @type {typeof session} */ (canonical(session));
}

/** @param {string} path @param {string} bytes */
async function durableExclusiveWrite(path, bytes) {
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8').catch(() => '') !== bytes) fail('session evidence collision', 73);
  } finally {
    await handle?.close();
  }
}

/** @typedef {Awaited<ReturnType<typeof loadSessionContext>>} SessionContext */
/** @param {string} stateDirectory @param {SessionContext} session */
export async function persistSessionContext(stateDirectory, session) {
  const directory = join(stateDirectory, 'config', 'sessions');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, `${session.sessionId}.json`);
  await durableExclusiveWrite(path, `${JSON.stringify(canonical(session))}\n`);
  return path;
}

/**
 * @param {{
 *   stateDirectory: string, session: SessionContext,
 *   promptBinding: { context: { profile: unknown, release: unknown, promptVersion: string, promptDigest: string, contextDigest: string } },
 *   runtime: unknown, skills: unknown, tools: unknown,
 * }} input
 */
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
  const eventPath = join(stateDirectory, 'history', `${session.sessionId}.events.ndjson`);
  const bytes = `${JSON.stringify(header)}\n`;
  // History is deliberately written first. If recording initialization fails, the
  // durable History row remains captureComplete=false and launch is denied.
  await durableExclusiveWrite(historyPath, bytes);
  await durableExclusiveWrite(recordingPath, bytes);
  await durableExclusiveWrite(eventPath, `${JSON.stringify(canonical({
    schemaVersion: 1, sequence: 0, at: session.createdAt, sessionId: session.sessionId, runId: session.runId,
    authorizationId: session.authorization.id,
    producer: { kind: 'supervisor', id: 'desktop-tools-supervisor', parentId: null },
    kind: 'session-status', status: 'started',
  }))}\n`);
  return Object.freeze({ historyPath, recordingPath, eventPath, captureComplete: false });
}
