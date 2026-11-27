import { createCipheriv, createDecipheriv, KeyObject, randomBytes } from 'node:crypto';
import { chmod, lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_EVENT_BYTES = 1_048_576;
const MAX_RECORDING_BYTES = 1_073_741_824;

/** @param {string} message @returns {never} */
function fail(message, code = 65) {
  throw Object.assign(new Error(message), { exitCode: code });
}

/** @param {unknown} value @param {string} label */
function identifier(value, label) {
  if (typeof value !== 'string' || !identifierPattern.test(value)) fail(`${label} is invalid`);
  return value;
}

/** @param {unknown} value @param {string} label */
function timestamp(value, label) {
  if (typeof value !== 'string' || !isoPattern.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} is invalid`);
  return value;
}

/** @param {unknown} value @param {string[]} keys @param {string} label @returns {asserts value is Record<string, unknown>} */
function exact(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} has an invalid shape`);
}

/** @param {unknown} value */
function encryptionKey(value) {
  if (!(value instanceof KeyObject) || value.type !== 'secret' || value.symmetricKeySize !== 32) {
    fail('recording encryption requires an in-memory 256-bit secret KeyObject', 78);
  }
  return value;
}

/** @param {unknown} value */
function recordingPath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) fail('recording path must be absolute');
  if (!value.endsWith('.cast.enc')) fail('recording path must end in .cast.enc');
  return resolve(value);
}

/** @param {unknown} value */
function validateConsent(value) {
  exact(value, ['actorId', 'approvedAt', 'recordOutput', 'recordInput'], 'recording consent');
  const actorId = identifier(value.actorId, 'consenting actor');
  const approvedAt = timestamp(value.approvedAt, 'consent timestamp');
  if (value.recordOutput !== true || value.recordInput !== false) fail('recording requires explicit output-only consent', 77);
  return { actorId, approvedAt, recordOutput: value.recordOutput, recordInput: value.recordInput };
}

/** @param {unknown} value */
function validatePolicy(value) {
  exact(value, ['retainUntil', 'maxBytes', 'allowExport', 'allowDelete'], 'recording policy');
  const retainUntil = timestamp(value.retainUntil, 'retention deadline');
  if (typeof value.maxBytes !== 'number' || !Number.isSafeInteger(value.maxBytes) || value.maxBytes < 1024 || value.maxBytes > MAX_RECORDING_BYTES) fail('recording maxBytes is invalid');
  if (typeof value.allowExport !== 'boolean' || typeof value.allowDelete !== 'boolean') fail('recording policy decisions must be booleans');
  return { ...value, retainUntil, maxBytes: value.maxBytes, allowExport: value.allowExport, allowDelete: value.allowDelete };
}

/** @param {unknown} value */
function validateTrigger(value) {
  exact(value, ['kind', 'parentSessionId', 'outbox'], 'recording trigger');
  if (typeof value.kind !== 'string' || !['local', 'browser', 'scheduled', 'child', 'offline'].includes(value.kind)) fail('recording trigger kind is invalid');
  if (value.kind === 'child') identifier(value.parentSessionId, 'parent session id');
  else if (value.parentSessionId !== null) fail('only child recordings may name a parent session');
  if ((value.kind === 'offline') !== (value.outbox === true)) fail('only offline recordings require the durable outbox');
  return value;
}

/** @param {unknown} values */
function validateForbiddenValues(values) {
  if (!Array.isArray(values) || values.length > 256 || values.some(value => typeof value !== 'string' || value.length < 8 || value.length > 16_384)) {
    fail('recording forbidden values must be bounded nontrivial strings');
  }
  if (new Set(values).size !== values.length) fail('recording forbidden values must be unique');
  return /** @type {string[]} */ ([...values]);
}

/** @param {string} path @param {unknown} value */
async function atomicStatus(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

/** @param {KeyObject} key @param {string} sessionId @param {number} sequence @param {string} plaintext */
function encryptLine(key, sessionId, sequence, plaintext) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`${sessionId}:${sequence}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    sequence,
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

/** @param {KeyObject} key @param {string} sessionId @param {unknown} envelope */
function decryptLine(key, sessionId, envelope) {
  exact(envelope, ['sequence', 'nonce', 'ciphertext', 'tag'], 'encrypted recording event');
  if (typeof envelope.sequence !== 'number' || !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0) fail('encrypted recording sequence is invalid');
  try {
    if (typeof envelope.nonce !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') fail('recording authentication failed', 77);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64url'));
    decipher.setAAD(Buffer.from(`${sessionId}:${envelope.sequence}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    fail('recording authentication failed', 77);
  }
}

/** @typedef {{ sessionId: string, policy: ReturnType<typeof validatePolicy> }} RecordingHeader */
/** @typedef {(text: string) => string | Promise<string>} OutputSanitizer */

export class EncryptedCastWriter {
  #handle;
  #key;
  #header;
  #statusPath;
  #sanitize;
  #sequence = 0;
  #lastSeconds = 0;
  #bytes = 0;
  #closed = false;
  #accepting = true;
  #pending = Promise.resolve();
  /** @type {unknown} */
  #failure;
  /** @type {'complete' | 'incomplete' | undefined} */
  #terminalRequest;
  /** @type {'complete' | 'incomplete' | undefined} */
  #terminalState;

  /** @param {{
   * path: string, sessionId: string, createdAt: string, cols: number, rows: number,
   * consent: unknown, policy: unknown, trigger: unknown, key: unknown, forbiddenValues: unknown,
   * sanitizeOutput: OutputSanitizer | null,
   * }} input */
  static async create(input) {
    exact(input, ['path', 'sessionId', 'createdAt', 'cols', 'rows', 'consent', 'policy', 'trigger', 'key', 'forbiddenValues', 'sanitizeOutput'], 'recording initialization');
    const path = recordingPath(input.path);
    identifier(input.sessionId, 'session id');
    timestamp(input.createdAt, 'recording creation timestamp');
    validateConsent(input.consent);
    const policy = validatePolicy(input.policy);
    validateTrigger(input.trigger);
    const forbiddenValues = validateForbiddenValues(input.forbiddenValues);
    const key = encryptionKey(input.key);
    if (typeof input.sanitizeOutput !== 'function') fail('recording requires an explicit output sanitizer', 78);
    if (!Number.isSafeInteger(input.cols) || input.cols < 1 || input.cols > 1000 || !Number.isSafeInteger(input.rows) || input.rows < 1 || input.rows > 1000) fail('recording geometry is invalid');
    const header = {
      schemaVersion: 1,
      format: 'asciicast-v3+aes-256-gcm',
      algorithm: 'aes-256-gcm',
      sessionId: input.sessionId,
      createdAt: input.createdAt,
      consent: input.consent,
      policy,
      trigger: input.trigger,
      captures: ['output', 'resize', 'marker', 'exit'],
      excludes: ['keyboard-input', 'environment', 'known-credentials'],
    };
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
      const headerLine = `${JSON.stringify(header)}\n`;
      await handle.writeFile(headerLine);
      await handle.sync();
      const writer = new EncryptedCastWriter(handle, key, header, `${path}.status.json`, input.sanitizeOutput, forbiddenValues, Buffer.byteLength(headerLine));
      await writer.#writePlaintext(`${JSON.stringify({ version: 3, term: { cols: input.cols, rows: input.rows }, timestamp: Math.floor(Date.parse(input.createdAt) / 1000) })}\n`);
      await atomicStatus(writer.#statusPath, { schemaVersion: 1, sessionId: input.sessionId, state: 'recording', captureComplete: false, reason: 'exit-event-not-recorded' });
      return writer;
    } catch (error) {
      await handle?.close().catch(() => {});
      throw error;
    }
  }

  /**
   * @param {import('node:fs/promises').FileHandle} handle
   * @param {KeyObject} key
   * @param {RecordingHeader} header
   * @param {string} statusPath
   * @param {OutputSanitizer} sanitize
   * @param {string[]} forbiddenValues
   * @param {number} initialBytes
   */
  constructor(handle, key, header, statusPath, sanitize, forbiddenValues, initialBytes) {
    this.#handle = handle;
    this.#key = key;
    this.#header = header;
    this.#statusPath = statusPath;
    this.#sanitize = sanitize;
    this.forbiddenValues = forbiddenValues;
    this.#bytes = initialBytes;
  }

  get input() { return undefined; }
  get statusPath() { return this.#statusPath; }

  /** @param {string} plaintext */
  async #writePlaintext(plaintext) {
    if (this.#closed) fail('recording is closed');
    if (Buffer.byteLength(plaintext) > MAX_EVENT_BYTES) fail('recording event exceeds its byte bound');
    const line = `${JSON.stringify(encryptLine(this.#key, this.#header.sessionId, this.#sequence, plaintext))}\n`;
    if (this.#bytes + Buffer.byteLength(line) > this.#header.policy.maxBytes) fail('recording exceeds its retained byte bound', 75);
    await this.#handle.writeFile(line);
    await this.#handle.sync();
    this.#bytes += Buffer.byteLength(line);
    this.#sequence += 1;
  }

  /** @param {number} seconds */
  #relative(seconds) {
    if (!Number.isFinite(seconds) || seconds < this.#lastSeconds) fail('recording timestamp is invalid');
    return seconds - this.#lastSeconds;
  }

  /** @param {() => Promise<void>} operation */
  #enqueue(operation) {
    if (!this.#accepting) return Promise.reject(Object.assign(new Error('recording is closed'), { exitCode: 65 }));
    const result = this.#pending.then(async () => {
      if (this.#failure) throw this.#failure;
      try {
        return await operation();
      } catch (error) {
        // Once an accepted event is lost, this capture can no longer truthfully
        // become complete. Preserve the first cause until markIncomplete closes it.
        this.#failure = error;
        throw error;
      }
    });
    this.#pending = result.catch(() => {});
    return result;
  }

  /** @param {number} seconds @param {'o' | 'r' | 'm' | 'x'} code @param {string} data */
  async #event(seconds, code, data) {
    const delta = this.#relative(seconds);
    await this.#writePlaintext(`${JSON.stringify([delta, code, data])}\n`);
    // Advance time only after the authenticated event is durably appended. A
    // sanitizer, capacity, or storage failure must not create a hidden gap.
    this.#lastSeconds = seconds;
  }

  /** @param {number} seconds @param {string} value */
  output(seconds, value) {
    if (typeof value !== 'string') fail('recording output must be text');
    return this.#enqueue(async () => {
      const sanitized = await this.#sanitize(value);
      if (typeof sanitized !== 'string') fail('output sanitizer returned an invalid result', 78);
      if (this.forbiddenValues.some(secret => sanitized.includes(secret))) fail('sanitized output still contains a forbidden secret value', 77);
      await this.#event(seconds, 'o', sanitized);
    });
  }

  /** @param {number} seconds @param {number} cols @param {number} rows */
  resize(seconds, cols, rows) {
    if (!Number.isSafeInteger(cols) || cols < 1 || cols > 1000 || !Number.isSafeInteger(rows) || rows < 1 || rows > 1000) fail('recording geometry is invalid');
    return this.#enqueue(() => this.#event(seconds, 'r', `${cols}x${rows}`));
  }

  /** @param {number} seconds @param {string} label */
  marker(seconds, label) {
    identifier(label, 'recording marker');
    return this.#enqueue(() => this.#event(seconds, 'm', label));
  }

  /** @param {number} seconds @param {number} exitCode */
  finish(seconds, exitCode) {
    if (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255) fail('recording exit code is invalid');
    if (!this.#accepting) return Promise.reject(Object.assign(new Error('recording is closed'), { exitCode: 65 }));
    this.#accepting = false;
    this.#terminalRequest = 'complete';
    const result = this.#pending.then(async () => {
      if (this.#failure) throw this.#failure;
      try {
        await this.#event(seconds, 'x', String(exitCode));
        this.#closed = true;
        await this.#handle.close();
        await atomicStatus(this.#statusPath, { schemaVersion: 1, sessionId: this.#header.sessionId, state: 'complete', captureComplete: true, reason: null });
        this.#terminalState = 'complete';
      } catch (error) {
        this.#failure = error;
        throw error;
      }
    });
    this.#pending = result.catch(() => {});
    return result;
  }

  /** @param {string} reason */
  async markIncomplete(reason) {
    identifier(reason, 'incomplete capture reason');
    if (this.#terminalState || this.#terminalRequest === 'incomplete') fail('recording already has a terminal state');
    const waitsForFailedFinish = this.#terminalRequest === 'complete';
    if (!waitsForFailedFinish) this.#terminalRequest = 'incomplete';
    this.#accepting = false;
    await this.#pending;
    if (this.#terminalState === 'complete') fail('completed recording cannot be marked incomplete');
    if (waitsForFailedFinish && !this.#failure) fail('completed recording cannot be marked incomplete');
    if (!this.#closed) { this.#closed = true; await this.#handle.close(); }
    await atomicStatus(this.#statusPath, { schemaVersion: 1, sessionId: this.#header.sessionId, state: 'incomplete', captureComplete: false, reason });
    this.#terminalState = 'incomplete';
  }
}

/** @param {string} pathInput */
async function readEnvelope(pathInput, maxBytes = MAX_RECORDING_BYTES) {
  const path = recordingPath(pathInput);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > maxBytes) fail('encrypted recording file is unsafe');
  const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
  const firstLine = lines.shift();
  if (!firstLine) fail('encrypted recording header is missing');
  /** @type {unknown} */
  const header = JSON.parse(firstLine);
  exact(header, ['schemaVersion', 'format', 'algorithm', 'sessionId', 'createdAt', 'consent', 'policy', 'trigger', 'captures', 'excludes'], 'encrypted recording header');
  if (header.schemaVersion !== 1 || header.format !== 'asciicast-v3+aes-256-gcm' || header.algorithm !== 'aes-256-gcm') fail('unsupported encrypted recording format');
  const sessionId = identifier(header.sessionId, 'session id');
  const consent = validateConsent(header.consent);
  const policy = validatePolicy(header.policy);
  validateTrigger(header.trigger);
  return { path, header: { sessionId, consent, policy }, events: lines.map(line => JSON.parse(line)) };
}

/** @param {{path: string, key: KeyObject, authorization: {actorId: string, approvedAt: string, purpose: string}}} input */
export async function exportRecording(input) {
  exact(input, ['path', 'key', 'authorization'], 'recording export request');
  const key = encryptionKey(input.key);
  const value = await readEnvelope(input.path);
  exact(input.authorization, ['actorId', 'approvedAt', 'purpose'], 'recording export authorization');
  identifier(input.authorization.actorId, 'export actor');
  timestamp(input.authorization.approvedAt, 'export approval timestamp');
  identifier(input.authorization.purpose, 'export purpose');
  if (!value.header.policy.allowExport || input.authorization.actorId !== value.header.consent.actorId) fail('recording export is not authorized', 77);
  return value.events.map((event, index) => {
    if (event.sequence !== index) fail('recording sequence gap detected', 73);
    return decryptLine(key, value.header.sessionId, event);
  }).join('');
}

/** @param {{path: string, now: string}} input */
export async function previewRetention(input) {
  exact(input, ['path', 'now'], 'retention preview');
  timestamp(input.now, 'retention evaluation timestamp');
  const value = await readEnvelope(input.path);
  return Object.freeze({ sessionId: value.header.sessionId, expired: Date.parse(input.now) >= Date.parse(value.header.policy.retainUntil), retainUntil: value.header.policy.retainUntil, action: 'preview-only' });
}

/** @param {{path: string, authorization: {actorId: string, approvedAt: string, reason: string}}} input */
export async function deleteRecording(input) {
  exact(input, ['path', 'authorization'], 'recording deletion request');
  const value = await readEnvelope(input.path);
  exact(input.authorization, ['actorId', 'approvedAt', 'reason'], 'recording deletion authorization');
  identifier(input.authorization.actorId, 'deletion actor');
  timestamp(input.authorization.approvedAt, 'deletion approval timestamp');
  identifier(input.authorization.reason, 'deletion reason');
  if (!value.header.policy.allowDelete || input.authorization.actorId !== value.header.consent.actorId) fail('recording deletion is not authorized', 77);
  await rm(value.path);
  await rm(`${value.path}.status.json`, { force: true });
  return Object.freeze({ sessionId: value.header.sessionId, deleted: true });
}
