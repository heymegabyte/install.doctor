import { z } from 'zod';

const ReleaseIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const ReleaseFileSchema = z.enum([
  'manifest', 'manifest.sig', 'provision.sh', 'start', 'install-doctor-engine.mjs', 'catalog.json',
  'node-macos-x64.tar.gz', 'node-macos-arm64.tar.gz', 'node-linux-x64.tar.gz', 'node-linux-arm64.tar.gz',
]);
const DesktopReleaseFileSchema = z.enum([
  'manifest', 'manifest.sig', 'provision.sh', 'start', 'desktop-tools-engine.mjs', 'catalog.json',
  'node-macos-x64.tar.gz', 'node-macos-arm64.tar.gz', 'node-linux-x64.tar.gz', 'node-linux-arm64.tar.gz',
  'opencode-macos-x64.zip', 'opencode-macos-arm64.zip', 'opencode-linux-x64.tar.gz', 'opencode-linux-arm64.tar.gz',
  'desktop-tools-supervisor.mjs', 'desktop-tools-tools.tar.gz', 'release.sbom.json', 'release.provenance.json',
  'THIRD_PARTY_LICENSES.txt', 'opencode.lock.json', 'debian-bookworm-inrelease',
  'debian-bookworm-archive-keyring.gpg', 'debian-bookworm-main-amd64-Packages.xz', 'tree_2.1.0-1_amd64.deb',
  'broker-approval-signer-delegation.json',
]);

type ReleaseObjectBody = {
  body: ReadableStream<Uint8Array>;
  size?: number;
};

type ReleaseBucket = {
  get(key: string): Promise<unknown>;
};

const ReleaseBucketSchema = z.custom<ReleaseBucket>(
  (value) => typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function',
);

const ReleaseObjectBodySchema = z
  .object({
    body: z.custom<ReadableStream<Uint8Array>>(
      (value) => typeof ReadableStream !== 'undefined' && value instanceof ReadableStream,
    ),
    size: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const CONTENT_TYPES: Record<z.infer<typeof ReleaseFileSchema>, string> = {
  manifest: 'application/vnd.install-doctor.release-manifest',
  'manifest.sig': 'application/octet-stream',
  'provision.sh': 'text/x-shellscript; charset=utf-8',
  start: 'text/x-shellscript; charset=utf-8',
  'install-doctor-engine.mjs': 'text/javascript; charset=utf-8',
  'catalog.json': 'application/json; charset=utf-8',
  'node-macos-x64.tar.gz': 'application/gzip',
  'node-macos-arm64.tar.gz': 'application/gzip',
  'node-linux-x64.tar.gz': 'application/gzip',
  'node-linux-arm64.tar.gz': 'application/gzip',
};

export type ReleaseLookup =
  | { status: 'invalid' }
  | { status: 'unavailable' }
  | { status: 'missing' }
  | { status: 'found'; body: ReleaseObjectBody; contentType: string };

/**
 * Resolve one immutable release object through the smallest R2-compatible boundary.
 * The caller supplies untrusted route and binding values; neither can influence the
 * fixed object prefix or filename allowlist.
 */
export async function lookupReleaseObject(
  binding: unknown,
  releaseIdValue: unknown,
  fileValue: unknown,
): Promise<ReleaseLookup> {
  const releaseId = ReleaseIdSchema.safeParse(releaseIdValue);
  const file = ReleaseFileSchema.safeParse(fileValue);
  if (!releaseId.success || !file.success) return { status: 'invalid' };

  const bucket = ReleaseBucketSchema.safeParse(binding);
  if (!bucket.success) return { status: 'unavailable' };

  let stored: unknown;
  try {
    stored = await bucket.data.get(`bootstrap/${releaseId.data}/${file.data}`);
  } catch {
    return { status: 'unavailable' };
  }
  if (stored === null || stored === undefined) return { status: 'missing' };

  const object = ReleaseObjectBodySchema.safeParse(stored);
  if (!object.success) return { status: 'unavailable' };
  return {
    status: 'found',
    body: object.data,
    contentType: CONTENT_TYPES[file.data],
  };
}

/** Desktop Tools objects are deliberately isolated from the legacy bootstrap prefix and allowlist. */
export async function lookupDesktopReleaseObject(binding: unknown, releaseIdValue: unknown, fileValue: unknown): Promise<ReleaseLookup> {
  const releaseId = ReleaseIdSchema.safeParse(releaseIdValue);
  const file = DesktopReleaseFileSchema.safeParse(fileValue);
  if (!releaseId.success || !file.success) return { status: 'invalid' };
  const bucket = ReleaseBucketSchema.safeParse(binding);
  if (!bucket.success) return { status: 'unavailable' };
  let stored: unknown;
  try { stored = await bucket.data.get(`desktop-tools/bootstrap/${releaseId.data}/${file.data}`); }
  catch { return { status: 'unavailable' }; }
  if (stored === null || stored === undefined) return { status: 'missing' };
  const object = ReleaseObjectBodySchema.safeParse(stored);
  if (!object.success) return { status: 'unavailable' };
  const contentType = file.data === 'manifest' ? 'application/vnd.desktop-tools.release-manifest'
    : file.data === 'manifest.sig' ? 'application/octet-stream'
    : file.data === 'provision.sh' || file.data === 'start' ? 'text/x-shellscript; charset=utf-8'
    : file.data === 'desktop-tools-engine.mjs' || file.data === 'desktop-tools-supervisor.mjs' ? 'text/javascript; charset=utf-8'
    : file.data === 'catalog.json' || file.data === 'release.sbom.json' || file.data === 'release.provenance.json'
      || file.data === 'opencode.lock.json' || file.data === 'broker-approval-signer-delegation.json' ? 'application/json; charset=utf-8'
    : file.data === 'THIRD_PARTY_LICENSES.txt' ? 'text/plain; charset=utf-8'
    : file.data === 'debian-bookworm-inrelease' ? 'text/plain; charset=utf-8'
    : file.data.endsWith('.gpg') ? 'application/pgp-keys'
    : file.data.endsWith('.deb') ? 'application/vnd.debian.binary-package'
    : file.data.endsWith('.xz') ? 'application/x-xz'
    : file.data.endsWith('.zip') ? 'application/zip' : 'application/gzip';
  return { status: 'found', body: object.data, contentType };
}
