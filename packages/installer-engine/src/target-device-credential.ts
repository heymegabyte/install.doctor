import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DeviceAuthorizationRequestSchema } from '@install-doctor/aid-core/device-authorization';
import { z } from 'zod';

const StoredDeviceCredentialSchema = z.strictObject({
  schemaVersion: z.literal(1),
  request: DeviceAuthorizationRequestSchema,
  credential: z.string().min(32).max(4096),
  credentialId: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  expiresAt: z.string().datetime({ offset: true }).max(64),
  storedAt: z.string().datetime({ offset: true }).max(64),
}).superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.storedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'credential expiry must follow storage' });
  }
});

export type StoredDeviceCredential = z.infer<typeof StoredDeviceCredentialSchema>;

async function assertPrivateParent(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('credential parent must be a private directory');
  if (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o700) throw new Error('credential parent must have mode 0700');
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error('credential parent owner does not match the process');
}

export class ProtectedDeviceCredentialStore {
  constructor(readonly path: string) {}

  async save(input: StoredDeviceCredential): Promise<void> {
    const credential = StoredDeviceCredentialSchema.parse(input);
    const parent = dirname(this.path);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await assertPrivateParent(parent);
    const existing = await this.load();
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(credential)) throw new Error('device credential already exists with different authority');
      return;
    }
    const temporary = join(parent, `.credential-${randomBytes(12).toString('hex')}.tmp`);
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(credential)}\n`, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, 0o600);
    try { await link(temporary, this.path); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
    await rm(temporary);
  }

  async load(): Promise<StoredDeviceCredential | undefined> {
    try {
      await assertPrivateParent(dirname(this.path));
      const metadata = await lstat(this.path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw new Error('credential must be a regular private file');
      if (process.platform !== 'win32' && (metadata.mode & 0o777) !== 0o600) throw new Error('credential must have mode 0600');
      if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error('credential owner does not match the process');
      return StoredDeviceCredentialSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
}
