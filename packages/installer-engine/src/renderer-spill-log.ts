import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';

const runIdentifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const byteLimit = z.number().int().min(1).max(16_777_216);

export class RendererSpillLogIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RendererSpillLogIntegrityError';
  }
}

export interface ProtectedRendererSpillLogOptions {
  readonly stateRoot: string;
  readonly runId: string;
  readonly maxBytes?: number;
}

export interface ProtectedRendererSpillLog {
  readonly path: string;
  readonly maxBytes: number;
  readonly bytesWritten: number;
  readonly closed: boolean;
  append(chunk: string): boolean;
  close(): void;
}

function ensureWithin(parent: string, child: string): void {
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  if (child !== parent && !child.startsWith(prefix)) {
    throw new RendererSpillLogIntegrityError('renderer spill path escapes its protected root');
  }
}

function validateProtectedDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new RendererSpillLogIntegrityError(`renderer spill path is not a real directory: ${path}`);
  }
  if (process.platform !== 'win32') {
    if ((metadata.mode & 0o077) !== 0) {
      throw new RendererSpillLogIntegrityError(`renderer spill directory is not private: ${path}`);
    }
    if (process.geteuid?.() !== metadata.uid) {
      throw new RendererSpillLogIntegrityError(`renderer spill directory is not owned by the effective user: ${path}`);
    }
  }
}

function validateProtectedFile(path: string, descriptor: number, expectedSize: number): void {
  const descriptorMetadata = fstatSync(descriptor);
  const pathMetadata = lstatSync(path);
  for (const metadata of [descriptorMetadata, pathMetadata]) {
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new RendererSpillLogIntegrityError('renderer spill artifact is not a regular file');
    }
    if (process.platform !== 'win32') {
      if ((metadata.mode & 0o077) !== 0 || metadata.nlink !== 1) {
        throw new RendererSpillLogIntegrityError('renderer spill artifact has unsafe permissions or links');
      }
      if (process.geteuid?.() !== metadata.uid) {
        throw new RendererSpillLogIntegrityError('renderer spill artifact is not owned by the effective user');
      }
    }
  }
  if (descriptorMetadata.dev !== pathMetadata.dev || descriptorMetadata.ino !== pathMetadata.ino) {
    throw new RendererSpillLogIntegrityError('renderer spill artifact pathname no longer identifies the open file');
  }
  if (descriptorMetadata.size !== expectedSize || pathMetadata.size !== expectedSize) {
    throw new RendererSpillLogIntegrityError('renderer spill artifact changed outside its owning writer');
  }
}

export function createProtectedRendererSpillLog(options: ProtectedRendererSpillLogOptions): ProtectedRendererSpillLog {
  const stateRoot = resolve(z.string().min(1).max(4096).parse(options.stateRoot));
  const runId = runIdentifier.parse(options.runId);
  const maxBytes = byteLimit.parse(options.maxBytes ?? 1_048_576);
  const spillRoot = resolve(stateRoot, 'renderer-spill');
  const runRoot = resolve(spillRoot, runId);
  const path = join(runRoot, 'output.log');
  ensureWithin(stateRoot, path);

  for (const directory of [stateRoot, spillRoot, runRoot]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    validateProtectedDirectory(directory);
  }

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const descriptor = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_APPEND | noFollow,
    0o600,
  );
  let bytesWritten = 0;
  let closed = false;
  try {
    validateProtectedFile(path, descriptor, bytesWritten);
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }

  return {
    path,
    maxBytes,
    get bytesWritten() { return bytesWritten; },
    get closed() { return closed; },
    append(chunk) {
      if (closed) throw new RendererSpillLogIntegrityError('renderer spill log is closed');
      const bytes = Buffer.from(z.string().parse(chunk), 'utf8');
      validateProtectedFile(path, descriptor, bytesWritten);
      if (bytesWritten + bytes.byteLength > maxBytes) return false;
      let offset = 0;
      while (offset < bytes.byteLength) {
        const count = writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
        if (count <= 0) throw new RendererSpillLogIntegrityError('renderer spill append made no forward progress');
        offset += count;
      }
      bytesWritten += bytes.byteLength;
      return true;
    },
    close() {
      if (closed) return;
      try {
        validateProtectedFile(path, descriptor, bytesWritten);
        fsyncSync(descriptor);
      } finally {
        closed = true;
        closeSync(descriptor);
      }
    },
  };
}
