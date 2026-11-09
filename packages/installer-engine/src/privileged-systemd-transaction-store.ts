import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { NativeSystemdTransactionRecordSchema } from './native-systemd-transaction-record.js';
import type { NativeSystemdTransactionPersistence, NativeSystemdTransactionRecord } from './native-systemd-transaction-record.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const GenerationSchema = z.strictObject({
  schemaVersion: z.literal(1), sequence: z.number().int().positive().max(10_000),
  previousDigest: digest.nullable(), record: NativeSystemdTransactionRecordSchema,
});
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function bytes(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(canonical(value))}\n`, 'utf8'); }
function hash(value: Buffer): string { return createHash('sha256').update('desktop-tools:systemd-transaction:v1\0').update(value).digest('hex'); }
async function assertPrivateDirectory(path: string, ownerUid: number): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== ownerUid || (info.mode & 0o077) !== 0) {
    throw new Error('systemd transaction directory is not private to its owner');
  }
}
async function writeExclusive(path: string, content: Buffer): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  const directory = await open(resolve(path, '..'), constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await directory.sync(); } finally { await directory.close(); }
}
async function readProtected(path: string, ownerUid: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== ownerUid
    || (before.mode & 0o177) !== 0 || before.size < 1 || before.size > 1_048_576) throw new Error('systemd transaction generation is unsafe');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error('systemd transaction generation changed while opening');
    const content = await handle.readFile();
    const after = await handle.stat();
    if (content.length !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('systemd transaction generation changed while reading');
    return content;
  } finally { await handle.close(); }
}

export async function createPrivilegedSystemdTransactionPersistence(input: {
  root: string; ownerUid?: number; runId: string; hostId: string; planDigest: string;
}): Promise<NativeSystemdTransactionPersistence & { evidenceDigest(): Promise<string> }> {
  const ownerUid = input.ownerUid ?? 0;
  const root = resolve(input.root);
  if (!isAbsolute(input.root) || root === resolve(root, '..') || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.runId)
    || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.hostId) || !/^[a-f0-9]{64}$/.test(input.planDigest)) {
    throw new Error('systemd transaction persistence authority is malformed');
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertPrivateDirectory(root, ownerUid);
  const readChain = async (transactionId: string) => {
    if (!/^[a-f0-9]{64}$/.test(transactionId)) throw new Error('systemd transaction identifier is malformed');
    const directory = join(root, transactionId);
    try { await assertPrivateDirectory(directory, ownerUid); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const names = (await readdir(directory)).sort();
    if (names.length > 10_000 || names.some(name => !/^\d{5}-[a-f0-9]{64}\.json$/.test(name))) throw new Error('systemd transaction generations are malformed');
    const result: Array<{ generation: z.infer<typeof GenerationSchema>; digest: string }> = [];
    for (const [index, name] of names.entries()) {
      const content = await readProtected(join(directory, name), ownerUid);
      const contentDigest = hash(content);
      const generation = GenerationSchema.parse(JSON.parse(content.toString('utf8')) as unknown);
      if (!content.equals(bytes(generation)) || name !== `${String(index + 1).padStart(5, '0')}-${contentDigest}.json`
        || generation.sequence !== index + 1 || generation.previousDigest !== (result.at(-1)?.digest ?? null)
        || generation.record.transactionId !== transactionId || generation.record.runId !== input.runId
        || generation.record.hostId !== input.hostId || generation.record.planDigest !== input.planDigest) {
        throw new Error('systemd transaction generation chain is invalid');
      }
      result.push({ generation, digest: contentDigest });
    }
    return result;
  };
  return Object.freeze({
    async load(transactionId: string) { return (await readChain(transactionId)).at(-1)?.generation.record; },
    async save(recordInput: NativeSystemdTransactionRecord) {
      const record = NativeSystemdTransactionRecordSchema.parse(recordInput);
      if (record.runId !== input.runId || record.hostId !== input.hostId || record.planDigest !== input.planDigest) throw new Error('systemd transaction record differs from root authority');
      const directory = join(root, record.transactionId);
      try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await assertPrivateDirectory(directory, ownerUid);
      const chain = await readChain(record.transactionId);
      const previous = chain.at(-1);
      if (previous && bytes(previous.generation.record).equals(bytes(record))) return;
      const generation = GenerationSchema.parse({ schemaVersion: 1, sequence: chain.length + 1, previousDigest: previous?.digest ?? null, record });
      const content = bytes(generation);
      await writeExclusive(join(directory, `${String(generation.sequence).padStart(5, '0')}-${hash(content)}.json`), content);
    },
    async evidenceDigest() {
      const transactionIds = (await readdir(root)).sort();
      if (transactionIds.length !== 1 || !/^[a-f0-9]{64}$/.test(transactionIds[0]!)) throw new Error('systemd transaction fence requires exactly one transaction identity');
      const latest = (await readChain(transactionIds[0]!)).at(-1);
      if (!latest) throw new Error('systemd transaction fence has no durable generation');
      return latest.digest;
    },
  });
}
