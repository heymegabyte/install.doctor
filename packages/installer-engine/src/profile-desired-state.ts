import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { blueprintDigest, importMarkdown, resolveMachinePackages } from '@install-doctor/aid-core';
import { z } from 'zod';
import { ProtectedDeviceCredentialStore } from './target-device-credential.js';

const MAX_RESPONSE_BYTES = 2_100_000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const responseSchema = z.strictObject({
  tenant: identifier,
  deviceId: identifier,
  revision: identifier,
  digest,
  updatedAt: z.string().datetime({ offset: true }).max(64),
  markdown: z.string().min(1).max(2_000_000),
});

export type ProfileDesiredStateResult = Readonly<{
  profileId: string;
  profileDigest: string;
  revision: string;
  machineId: string;
  machineRole: string;
  selectedPackages: string[];
  selectedServices: string[];
  environmentPath: string;
  unchanged: boolean;
}>;

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('desired-state response exceeds its byte bound');
  if (!response.body) throw new Error('desired-state response is empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('desired-state response exceeds its byte bound');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('desired-state response is not valid UTF-8 JSON'); }
}

async function assertPrivateParent(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('desired-state parent must be a private directory');
  if (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o700) throw new Error('desired-state parent must have mode 0700');
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error('desired-state parent owner does not match the process');
}

async function writeAtomic(path: string, markdown: string): Promise<boolean> {
  const parent = dirname(path);
  await assertPrivateParent(parent);
  try {
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) throw new Error('desired-state target must be a regular file');
    if (process.platform !== 'win32' && (existing.mode & 0o777) !== 0o600) throw new Error('desired-state target must have mode 0600');
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try { if (await handle.readFile('utf8') === markdown) return true; } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(parent, `.environment-${randomBytes(12).toString('hex')}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(markdown, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await chmod(temporary, 0o600);
  try { await rename(temporary, path); } finally { await rm(temporary, { force: true }); }
  return false;
}

export async function fetchProfileDesiredState(input: Readonly<{
  origin: string;
  credentialPath: string;
  environmentPath: string;
  expectedProfileId: string;
  expectedProfileDigest: string;
  machineId: string;
  hostOs?: 'linux' | 'darwin' | 'win32';
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}>): Promise<ProfileDesiredStateResult> {
  const origin = new URL(input.origin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.port || origin.pathname !== '/' || origin.search || origin.hash
    || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?\.desktop\.tools$/.test(origin.hostname)) {
    throw new Error('desired-state origin must be an exact Desktop Tools profile origin');
  }
  const expectedProfileId = identifier.parse(input.expectedProfileId);
  const expectedProfileDigest = digest.parse(input.expectedProfileDigest);
  const machineId = identifier.parse(input.machineId);
  const stored = await new ProtectedDeviceCredentialStore(input.credentialPath).load();
  if (!stored || Date.parse(stored.expiresAt) <= Date.now()) throw new Error('active protected device credential is unavailable');
  if (stored.request.binding.profileId !== expectedProfileId || !stored.request.binding.scopes.includes('profile:read')) {
    throw new Error('device credential is not authorized for the selected profile');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('desired-state request timed out')), input.timeoutMs ?? 20_000);
  let rawBody: unknown;
  try {
    const response = await (input.fetch ?? globalThis.fetch)(new URL('/api/device/current', origin), {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      headers: { authorization: `Bearer ${stored.credential}`, accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`desired-state request failed with status ${response.status}`);
    rawBody = await boundedJson(response);
  } finally { clearTimeout(timeout); }
  const body = responseSchema.parse(rawBody);
  if (body.deviceId !== stored.credentialId || body.digest !== expectedProfileDigest) {
    throw new Error('desired-state response differs from enrolled profile authority');
  }
  const environment = importMarkdown(body.markdown);
  if (environment.schemaVersion !== 4 || environment.profile.id !== expectedProfileId
    || environment.profile.revision !== environment.revision || await blueprintDigest(environment) !== body.digest) {
    throw new Error('desired-state document differs from its authenticated profile binding');
  }
  const machine = environment.machines.find(candidate => candidate.id === machineId);
  if (!machine) throw new Error('desired-state document does not declare this exact machine');
  if (machine.os !== (input.hostOs ?? process.platform)) throw new Error('desired-state machine operating system differs from this host');
  const selectedPackages = [...resolveMachinePackages(environment, machineId)].sort();
  const selectedServices = environment.services.filter(service => service.machineIds.includes(machineId)).map(service => service.id).sort();
  const unchanged = await writeAtomic(input.environmentPath, body.markdown);
  return { profileId: expectedProfileId, profileDigest: body.digest, revision: body.revision, machineId, machineRole: machine.role,
    selectedPackages, selectedServices, environmentPath: input.environmentPath, unchanged };
}
