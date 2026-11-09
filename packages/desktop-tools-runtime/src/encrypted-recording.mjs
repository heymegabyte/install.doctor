import { createCipheriv, createDecipheriv, KeyObject, randomBytes } from 'node:crypto';
import { chmod, lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_EVENT_BYTES = 1_048_576;
const MAX_RECORDING_BYTES = 1_073_741_824;

function fail(message, code = 65) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !identifierPattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !isoPattern.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} is invalid`);
  return value;
}

function exact(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(`${label} has an invalid shape`);
}

function encryptionKey(value) {
  if (!(value instanceof KeyObject) || value.type !== 'secret' || value.symmetricKeySize !== 32) {
    fail('recording encryption requires an in-memory 256-bit secret KeyObject', 78);
  }
  return value;
}

function recordingPath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) fail('recording path must be absolute');
  if (!value.endsWith('.cast.enc')) fail('recording path must end in .cast.enc');
  return resolve(value);
}

function validateConsent(value) {
  exact(value, ['actorId', 'approvedAt', 'recordOutput', 'recordInput'], 'recording consent');
  identifier(value.actorId, 'consenting actor');
  timestamp(value.approvedAt, 'consent timestamp');
  if (value.recordOutput !== true || value.recordInput !== false) fail('recording requires explicit output-only consent', 77);
  return value;
}

function validatePolicy(value) {
  exact(value, ['retainUntil', 'maxBytes', 'allowExport', 'allowDelete'], 'recording policy');
  timestamp(value.retainUntil, 'retention deadline');
  if (!Number.isSafeInteger(value.maxBytes) || value.maxBytes < 1024 || value.maxBytes > MAX_RECORDING_BYTES) fail('recording maxBytes is invalid');
  if (typeof value.allowExport !== 'boolean' || typeof value.allowDelete !== 'boolean') fail('recording policy decisions must be booleans');
  return value;
}

async function atomicStatus(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

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

function decryptLine(key, sessionId, envelope) {
  exact(envelope, ['sequence', 'nonce', 'ciphertext', 'tag'], 'encrypted recording event');
  if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0) fail('encrypted recording sequence is invalid');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64url'));
    decipher.setAAD(Buffer.from(`${sessionId}:${envelope.sequence}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    fail('recording authentication failed', 77);
  }
}

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
  #failure;
  #terminalRequest;
  #terminalState;

  static async create(input) {
    exact(input, ['path', 'sessionId', 'createdAt', 'cols', 'rows', 'consent', 'policy', 'key', 'sanitizeOutput'], 'recording initialization');
    const path = recordingPath(input.path);
    identifier(input.sessionId, 'session id');
    timestamp(input.createdAt, 'recording creation timestamp');
    validateConsent(input.consent);
    validatePolicy(input.policy);
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
      policy: input.policy,
      captures: ['output', 'resize', 'marker', 'exit'],
      excludes: ['keyboard-input', 'environment'],
    };
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
      const headerLine = `${JSON.stringify(header)}\n`;
      await handle.writeFile(headerLine);
      await handle.sync();
      const writer = new EncryptedCastWriter(handle, key, header, `${path}.status.json`, input.sanitizeOutput, Buffer.byteLength(headerLine));
      await writer.#writePlaintext(`${JSON.stringify({ version: 3, term: { cols: input.cols, rows: input.rows }, timestamp: Math.floor(Date.parse(input.createdAt) / 1000) })}\n`);
      await atomicStatus(writer.#statusPath, { schemaVersion: 1, sessionId: input.sessionId, state: 'recording', captureComplete: false, reason: 'exit-event-not-recorded' });
      return writer;
    } catch (error) {
      await handle?.close().catch(() => {});
      throw error;
    }
  }

  constructor(handle, key, header, statusPath, sanitize, initialBytes) {
    this.#handle = handle;
    this.#key = key;
    this.#header = header;
    this.#statusPath = statusPath;
    this.#sanitize = sanitize;
    this.#bytes = initialBytes;
  }

  get input() { return undefined; }
  get statusPath() { return this.#statusPath; }

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

  #relative(seconds) {
    if (!Number.isFinite(seconds) || seconds < this.#lastSeconds) fail('recording timestamp is invalid');
    return seconds - this.#lastSeconds;
  }

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

  async #event(seconds, code, data) {
    const delta = this.#relative(seconds);
    await this.#writePlaintext(`${JSON.stringify([delta, code, data])}\n`);
    // Advance time only after the authenticated event is durably appended. A
    // sanitizer, capacity, or storage failure must not create a hidden gap.
    this.#lastSeconds = seconds;
  }

  output(seconds, value) {
    if (typeof value !== 'string') fail('recording output must be text');
    return this.#enqueue(async () => {
      const sanitized = await this.#sanitize(value);
      if (typeof sanitized !== 'string') fail('output sanitizer returned an invalid result', 78);
      await this.#event(seconds, 'o', sanitized);
    });
  }

  resize(seconds, cols, rows) {
    if (!Number.isSafeInteger(cols) || cols < 1 || cols > 1000 || !Number.isSafeInteger(rows) || rows < 1 || rows > 1000) fail('recording geometry is invalid');
    return this.#enqueue(() => this.#event(seconds, 'r', `${cols}x${rows}`));
  }

  marker(seconds, label) {
    identifier(label, 'recording marker');
    return this.#enqueue(() => this.#event(seconds, 'm', label));
  }

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

async function readEnvelope(pathInput, maxBytes = MAX_RECORDING_BYTES) {
  const path = recordingPath(pathInput);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > maxBytes) fail('encrypted recording file is unsafe');
  const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
  const header = JSON.parse(lines.shift());
  exact(header, ['schemaVersion', 'format', 'algorithm', 'sessionId', 'createdAt', 'consent', 'policy', 'captures', 'excludes'], 'encrypted recording header');
  if (header.schemaVersion !== 1 || header.format !== 'asciicast-v3+aes-256-gcm' || header.algorithm !== 'aes-256-gcm') fail('unsupported encrypted recording format');
  identifier(header.sessionId, 'session id');
  validateConsent(header.consent);
  validatePolicy(header.policy);
  return { path, header, events: lines.map(line => JSON.parse(line)) };
}

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

export async function previewRetention(input) {
  exact(input, ['path', 'now'], 'retention preview');
  timestamp(input.now, 'retention evaluation timestamp');
  const value = await readEnvelope(input.path);
  return Object.freeze({ sessionId: value.header.sessionId, expired: Date.parse(input.now) >= Date.parse(value.header.policy.retainUntil), retainUntil: value.header.policy.retainUntil, action: 'preview-only' });
}

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
