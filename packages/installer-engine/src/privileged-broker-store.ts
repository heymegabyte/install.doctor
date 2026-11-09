import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  PrivilegedBrokerGrantSchema,
  PrivilegedBrokerApprovalEvidenceSchema,
  privilegedBrokerDigest,
} from './privileged-broker-protocol.js';
import type { PrivilegedBrokerApprovalEvidence, PrivilegedBrokerGrant } from './privileged-broker-protocol.js';
import {
  PrivilegedBrokerExecutionAuthoritySchema,
  privilegedBrokerDescriptorDigest,
  privilegedBrokerExecutionAuthorityDigest,
} from './privileged-broker-authority.js';
import type { PrivilegedBrokerExecutionAuthority } from './privileged-broker-authority.js';

const safeName = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export interface PrivilegedBrokerStore {
  readonly publishGrant: (grant: unknown, approval: unknown) => Promise<{ readonly grant: PrivilegedBrokerGrant; readonly digest: string }>;
  readonly readGrant: (grantId: string) => Promise<{ readonly grant: PrivilegedBrokerGrant; readonly digest: string }>;
  readonly publishAuthority: (grantId: string, authority: unknown) => Promise<{ readonly authority: PrivilegedBrokerExecutionAuthority; readonly digest: string }>;
  readonly readAuthority: (grantId: string) => Promise<{ readonly authority: PrivilegedBrokerExecutionAuthority; readonly digest: string }>;
  readonly consumeNonce: (grantId: string, nonce: string, requestDigest: string) => Promise<boolean>;
}

async function assertProtectedDirectory(path: string, ownerUid: number): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
    || metadata.uid !== ownerUid || (metadata.mode & 0o077) !== 0) {
    throw new Error('privileged broker store directory is not private to its owner');
  }
}

async function writeExclusive(path: string, bytes: Buffer): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(dirname(path), constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { await directory.sync(); } finally { await directory.close(); }
  return true;
}

async function readProtected(path: string, ownerUid: number, maximumBytes: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== ownerUid
    || (before.mode & 0o177) !== 0 || before.size < 1 || before.size > maximumBytes) {
    throw new Error('privileged broker authority file is not a protected bounded regular file');
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error('privileged broker authority file changed while opening');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino
      || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('privileged broker authority file changed while reading');
    }
    return bytes;
  } finally { await handle.close(); }
}

export async function createPrivilegedBrokerStore(input: {
  readonly root: string;
  readonly ownerUid?: number;
  readonly verifyApproval: (approval: PrivilegedBrokerApprovalEvidence) => Promise<boolean>;
}): Promise<PrivilegedBrokerStore> {
  const ownerUid = input.ownerUid ?? 0;
  const root = resolve(input.root);
  if (!isAbsolute(input.root) || root === dirname(root)) throw new Error('privileged broker store root must be absolute and non-root');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertProtectedDirectory(root, ownerUid);
  const grants = join(root, 'grants');
  const nonces = join(root, 'nonces');
  const authorities = join(root, 'authorities');
  await mkdir(grants, { mode: 0o700 });
  await mkdir(nonces, { mode: 0o700 });
  await mkdir(authorities, { mode: 0o700 });
  await assertProtectedDirectory(grants, ownerUid);
  await assertProtectedDirectory(nonces, ownerUid);
  await assertProtectedDirectory(authorities, ownerUid);

  return Object.freeze({
    async publishGrant(inputGrant: unknown, inputApproval: unknown) {
      const grant = PrivilegedBrokerGrantSchema.parse(inputGrant);
      const approval = PrivilegedBrokerApprovalEvidenceSchema.parse(inputApproval);
      if (approval.hostId !== grant.hostId || approval.runId !== grant.runId
        || approval.planDigest !== grant.planDigest || approval.consentDigest !== grant.consentDigest) {
        throw new Error('privileged broker approval evidence differs from the exact grant');
      }
      if (!await input.verifyApproval(approval)) throw new Error('privileged broker approval evidence was not independently verified');
      const digest = privilegedBrokerDigest(grant);
      const path = join(grants, `${grant.grantId}.json`);
      const created = await writeExclusive(path, Buffer.from(`${JSON.stringify(grant)}\n`, 'utf8'));
      if (!created) {
        const existing = await readProtected(path, ownerUid, 131_072);
        const parsed = PrivilegedBrokerGrantSchema.parse(JSON.parse(existing.toString('utf8')) as unknown);
        if (privilegedBrokerDigest(parsed) !== digest) throw new Error('privileged broker grant identifier collision');
        return Object.freeze({ grant: parsed, digest });
      }
      return Object.freeze({ grant, digest });
    },
    async readGrant(grantId: string) {
      if (!safeName.test(grantId)) throw new Error('invalid privileged broker grant identifier');
      const bytes = await readProtected(join(grants, `${grantId}.json`), ownerUid, 131_072);
      const grant = PrivilegedBrokerGrantSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
      if (grant.grantId !== grantId) throw new Error('privileged broker grant identity mismatch');
      return Object.freeze({ grant, digest: privilegedBrokerDigest(grant) });
    },
    async publishAuthority(grantId: string, inputAuthority: unknown) {
      if (!safeName.test(grantId)) throw new Error('invalid privileged broker grant identifier');
      const { grant } = await this.readGrant(grantId);
      const authority = PrivilegedBrokerExecutionAuthoritySchema.parse(inputAuthority);
      const digest = privilegedBrokerExecutionAuthorityDigest(authority);
      if (authority.hostId !== grant.hostId || authority.releaseId !== grant.releaseId
        || authority.runId !== grant.runId || authority.planDigest !== grant.planDigest
        || digest !== grant.closureDigest || privilegedBrokerDescriptorDigest(authority.descriptor) !== grant.descriptorDigest) {
        throw new Error('privileged broker execution authority differs from the exact grant');
      }
      const path = join(authorities, `${grantId}.json`);
      const created = await writeExclusive(path, Buffer.from(`${JSON.stringify(authority)}\n`, 'utf8'));
      if (!created) {
        const existing = await this.readAuthority(grantId);
        if (existing.digest !== digest) throw new Error('privileged broker authority identifier collision');
        return existing;
      }
      return Object.freeze({ authority, digest });
    },
    async readAuthority(grantId: string) {
      if (!safeName.test(grantId)) throw new Error('invalid privileged broker grant identifier');
      const bytes = await readProtected(join(authorities, `${grantId}.json`), ownerUid, 2_097_152);
      const authority = PrivilegedBrokerExecutionAuthoritySchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
      const digest = privilegedBrokerExecutionAuthorityDigest(authority);
      const { grant } = await this.readGrant(grantId);
      if (authority.hostId !== grant.hostId || authority.releaseId !== grant.releaseId
        || authority.runId !== grant.runId || authority.planDigest !== grant.planDigest
        || digest !== grant.closureDigest || privilegedBrokerDescriptorDigest(authority.descriptor) !== grant.descriptorDigest) {
        throw new Error('privileged broker stored authority differs from the exact grant');
      }
      return Object.freeze({ authority, digest });
    },
    async consumeNonce(grantId: string, nonce: string, requestDigest: string) {
      if (!safeName.test(grantId) || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(requestDigest)) {
        throw new Error('invalid privileged broker nonce authority');
      }
      const grantNonceRoot = join(nonces, grantId);
      try { await mkdir(grantNonceRoot, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await assertProtectedDirectory(grantNonceRoot, ownerUid);
      return writeExclusive(join(grantNonceRoot, nonce), Buffer.from(`${requestDigest}\n`, 'ascii'));
    },
  });
}
