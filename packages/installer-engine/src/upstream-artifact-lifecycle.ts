import { createHash } from 'node:crypto';
import { isAbsolute, posix } from 'node:path';
import { z } from 'zod';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._+-]*$/);
const Version = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/);
const Platform = z.strictObject({
  os: z.enum(['linux', 'darwin', 'win32']),
  arch: z.enum(['x64', 'arm64']),
});
const RelativePath = z.string().min(1).max(1024).refine(value => {
  if (value.includes('\\') || value.startsWith('/') || value.includes('\0')) return false;
  const normalized = posix.normalize(value);
  return normalized === value && normalized !== '.' && !normalized.startsWith('../');
}, 'path must be a normalized contained POSIX path');
const AbsolutePath = z.string().min(1).max(4096).refine(isAbsolute, 'path must be absolute');

export const AdmittedUpstreamArtifactSchema = z.strictObject({
  schemaVersion: z.literal(1),
  admissionId: Digest,
  package: Identifier,
  version: Version,
  provider: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('github-release'),
      repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      tag: Version,
      asset: z.string().min(1).max(255).regex(/^[^/\\]+$/),
    }),
    z.strictObject({
      kind: z.literal('upstream-release'),
      authority: z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/),
      release: Version,
      artifact: z.string().min(1).max(255).regex(/^[^/\\]+$/),
    }),
  ]),
  platform: Platform,
  format: z.enum(['raw', 'tar.gz', 'zip']),
  object: z.strictObject({ path: AbsolutePath, sha256: Digest, sizeBytes: z.number().int().positive().max(1_073_741_824) }),
  extraction: z.strictObject({
    stripComponents: z.number().int().min(0).max(16),
    files: z.array(z.strictObject({
      archivePath: RelativePath,
      installPath: RelativePath,
      sha256: Digest,
      sizeBytes: z.number().int().nonnegative().max(268_435_456),
      mode: z.enum(['0644', '0755']),
    })).min(1).max(4096),
  }),
  evidence: z.strictObject({
    authenticated: z.literal(true),
    signatureKeyId: Digest,
    license: z.string().min(1).max(128),
    mirroredAt: z.string().datetime({ offset: true }),
  }),
}).superRefine((value, context) => {
  const archivePaths = new Set<string>();
  const installPaths = new Set<string>();
  for (const [index, file] of value.extraction.files.entries()) {
    if (archivePaths.has(file.archivePath)) context.addIssue({ code: 'custom', path: ['extraction', 'files', index, 'archivePath'], message: 'archive paths must be unique' });
    if (installPaths.has(file.installPath)) context.addIssue({ code: 'custom', path: ['extraction', 'files', index, 'installPath'], message: 'install paths must be unique' });
    archivePaths.add(file.archivePath); installPaths.add(file.installPath);
  }
  if (value.format === 'raw' && (value.extraction.stripComponents !== 0 || value.extraction.files.length !== 1)) {
    context.addIssue({ code: 'custom', path: ['extraction'], message: 'raw artifacts require one file and zero stripped components' });
  }
});

export type AdmittedUpstreamArtifact = z.infer<typeof AdmittedUpstreamArtifactSchema>;
export type ArtifactPlatform = z.infer<typeof Platform>;

const InstalledReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1), package: Identifier, version: Version, admissionId: Digest,
  platform: Platform, root: AbsolutePath,
  files: z.array(z.strictObject({ path: RelativePath, sha256: Digest, sizeBytes: z.number().int().nonnegative(), mode: z.enum(['0644', '0755']) })).min(1).max(4096),
});
export type InstalledArtifactReceipt = z.infer<typeof InstalledReceiptSchema>;

export type ArtifactLifecyclePlan = Readonly<{
  schemaVersion: 1;
  action: 'install' | 'update' | 'noop' | 'uninstall';
  package: string;
  root: string;
  target?: AdmittedUpstreamArtifact;
  previous?: InstalledArtifactReceipt;
  removePaths: readonly string[];
  planDigest: string;
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }

/** Select exactly one immutable admitted artifact for a host. No filename heuristics or architecture fallback are allowed. */
export function resolveAdmittedUpstreamArtifact(input: {
  package: unknown; version: unknown; platform: unknown; candidates: readonly unknown[];
}): AdmittedUpstreamArtifact {
  const packageName = Identifier.parse(input.package);
  const version = Version.parse(input.version);
  const platform = Platform.parse(input.platform);
  const candidates = z.array(AdmittedUpstreamArtifactSchema).min(1).max(4096).parse(input.candidates);
  const matches = candidates.filter(candidate => candidate.package === packageName && candidate.version === version
    && candidate.platform.os === platform.os && candidate.platform.arch === platform.arch);
  if (matches.length === 0) throw new Error(`no admitted artifact for ${packageName}@${version} ${platform.os}/${platform.arch}`);
  if (matches.length !== 1) throw new Error(`ambiguous admitted artifact for ${packageName}@${version} ${platform.os}/${platform.arch}`);
  return matches[0]!;
}

export function compileArtifactLifecyclePlan(rawInput: {
  package: unknown; root: unknown; target?: unknown; installed?: unknown; uninstall?: unknown;
}): ArtifactLifecyclePlan {
  const packageName = Identifier.parse(rawInput.package);
  const root = AbsolutePath.parse(rawInput.root);
  const installed = rawInput.installed === undefined ? undefined : InstalledReceiptSchema.parse(rawInput.installed);
  if (installed && (installed.package !== packageName || installed.root !== root)) throw new Error('installed receipt is outside the requested package or root');
  const uninstall = z.boolean().parse(rawInput.uninstall ?? false);
  const target = rawInput.target === undefined ? undefined : AdmittedUpstreamArtifactSchema.parse(rawInput.target);
  if (uninstall && target) throw new Error('uninstall plans cannot select a target artifact');
  if (!uninstall && !target) throw new Error('install and update plans require an admitted target artifact');
  if (target && target.package !== packageName) throw new Error('target artifact package does not match the request');
  const action: ArtifactLifecyclePlan['action'] = uninstall ? 'uninstall' : !installed ? 'install'
    : installed.admissionId === target!.admissionId ? 'noop' : 'update';
  const retained = new Set(target?.extraction.files.map(file => file.installPath) ?? []);
  const removePaths = [...new Set((installed?.files ?? []).map(file => file.path).filter(path => !retained.has(path)))].sort();
  const planWithoutDigest = { schemaVersion: 1 as const, action, package: packageName, root,
    ...(target ? { target } : {}), ...(installed ? { previous: installed } : {}), removePaths };
  return Object.freeze({ ...planWithoutDigest, planDigest: digest(planWithoutDigest) });
}

export type ArtifactExtractionAdapter = (input: Readonly<{
  format: AdmittedUpstreamArtifact['format']; objectPath: string; stripComponents: number;
  expectedFiles: AdmittedUpstreamArtifact['extraction']['files'];
}>) => Promise<readonly { archivePath: string; bytes: Uint8Array; mode: '0644' | '0755' }[]>;

export type ArtifactInstallAdapter = Readonly<{
  activate(input: Readonly<{ root: string; files: readonly { path: string; bytes: Uint8Array; mode: '0644' | '0755' }[]; removePaths: readonly string[]; expectedPlanDigest: string }>): Promise<void>;
  remove(input: Readonly<{ root: string; paths: readonly string[]; expectedPlanDigest: string }>): Promise<void>;
}>;

/** Execute only the precompiled lifecycle. Archive parsing and atomic activation remain replaceable platform adapters. */
export async function executeArtifactLifecyclePlan(input: {
  plan: ArtifactLifecyclePlan; extract: ArtifactExtractionAdapter; install: ArtifactInstallAdapter;
}): Promise<InstalledArtifactReceipt | null> {
  const { plan } = input;
  const { planDigest, ...body } = plan;
  if (digest(body) !== planDigest) throw new Error('artifact lifecycle plan digest mismatch');
  if (plan.action === 'noop') return InstalledReceiptSchema.parse(plan.previous);
  if (plan.action === 'uninstall') {
    if (!plan.previous) throw new Error('uninstall requires an installed receipt');
    await input.install.remove({ root: plan.root, paths: plan.previous.files.map(file => file.path).sort(), expectedPlanDigest: planDigest });
    return null;
  }
  if (!plan.target) throw new Error('artifact lifecycle target is missing');
  const extracted = await input.extract({ format: plan.target.format, objectPath: plan.target.object.path,
    stripComponents: plan.target.extraction.stripComponents, expectedFiles: plan.target.extraction.files });
  const byArchivePath = new Map(extracted.map(file => [file.archivePath, file]));
  if (byArchivePath.size !== extracted.length || extracted.length !== plan.target.extraction.files.length) throw new Error('extracted artifact closure differs from admitted manifest');
  const files = plan.target.extraction.files.map(expected => {
    const actual = byArchivePath.get(expected.archivePath);
    if (!actual || actual.mode !== expected.mode || actual.bytes.byteLength !== expected.sizeBytes
      || createHash('sha256').update(actual.bytes).digest('hex') !== expected.sha256) {
      throw new Error(`extracted artifact file failed admission: ${expected.archivePath}`);
    }
    return { path: expected.installPath, bytes: actual.bytes, mode: actual.mode };
  });
  await input.install.activate({ root: plan.root, files, removePaths: plan.removePaths, expectedPlanDigest: planDigest });
  return InstalledReceiptSchema.parse({ schemaVersion: 1, package: plan.package, version: plan.target.version,
    admissionId: plan.target.admissionId, platform: plan.target.platform, root: plan.root,
    files: plan.target.extraction.files.map(file => ({ path: file.installPath, sha256: file.sha256, sizeBytes: file.sizeBytes, mode: file.mode })) });
}
