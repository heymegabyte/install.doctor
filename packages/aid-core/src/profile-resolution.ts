/** Pure profile-slug and tenant-resolution boundary for Desktop Tools. */
import { z } from 'zod';

export const RESERVED_DESKTOP_TOOLS_HOSTS = [
  'admin', 'api', 'app', 'assets', 'auth', 'cdn', 'dashboard', 'desktop-tools',
  'docs', 'health', 'help', 'install', 'login', 'mail', 'pair', 'profile', 'profiles',
  'releases', 'root', 'start', 'static', 'status',
  'support', 'www'
] as const;
const RESERVED_PROFILE_SLUGS = new Set<string>(RESERVED_DESKTOP_TOOLS_HOSTS);

const slugSyntax = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,61}[a-z0-9]$/;
const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);

const profileRecordSchema = z.object({
  id: identifier,
  tenantId: identifier,
  slug: z.string(),
  revision: identifier,
  digest,
  visibility: z.enum(['public-bootstrap', 'private']),
  enabled: z.boolean()
}).strict();

const profileDirectorySchema = z.array(profileRecordSchema).max(100_000).superRefine((records, context) => {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const [index, record] of records.entries()) {
    let slug: string;
    try {
      slug = validateProfileSlug(record.slug);
    } catch (error) {
      context.addIssue({ code: 'custom', path: [index, 'slug'], message: String(error) });
      continue;
    }
    if (ids.has(record.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Profile ids must be unique' });
    if (slugs.has(slug)) context.addIssue({ code: 'custom', path: [index, 'slug'], message: 'Profile slugs must be globally unique' });
    ids.add(record.id);
    slugs.add(slug);
  }
});

export type ProfileRecord = z.infer<typeof profileRecordSchema>;
export interface PublicProfileDescriptor {
  schemaVersion: 1;
  profile: { id: string; slug: string; revision: string; digest: string };
}
export type DesktopToolsHost =
  | { kind: 'apex'; hostname: 'desktop.tools' }
  | { kind: 'reserved'; hostname: string; name: typeof RESERVED_DESKTOP_TOOLS_HOSTS[number] }
  | { kind: 'profile'; hostname: string; slug: string }
  | { kind: 'unrelated' | 'invalid'; hostname: string };

/** Classify an HTTP hostname without treating nested, confusable, or reserved labels as profiles. */
export function classifyDesktopToolsHostname(input: unknown): DesktopToolsHost {
  if (typeof input !== 'string' || input.length === 0 || input.length > 253) {
    return { kind: 'invalid', hostname: '' };
  }
  const hostname = input.endsWith('.') ? input.slice(0, -1) : input;
  if (hostname.normalize('NFKC') !== hostname || !/^[a-zA-Z0-9.-]+$/.test(hostname)) {
    return { kind: 'invalid', hostname };
  }
  const canonical = hostname.toLowerCase();
  if (canonical === 'desktop.tools') return { kind: 'apex', hostname: 'desktop.tools' };
  if (!canonical.endsWith('.desktop.tools')) return { kind: 'unrelated', hostname: canonical };
  const label = canonical.slice(0, -'.desktop.tools'.length);
  if (label.includes('.')) return { kind: 'invalid', hostname: canonical };
  if (RESERVED_PROFILE_SLUGS.has(label)) {
    return {
      kind: 'reserved',
      hostname: canonical,
      name: label as typeof RESERVED_DESKTOP_TOOLS_HOSTS[number]
    };
  }
  try {
    return { kind: 'profile', hostname: canonical, slug: validateProfileSlug(label) };
  } catch {
    return { kind: 'invalid', hostname: canonical };
  }
}

/** Validate a canonical DNS label without silently normalizing confusable input. */
export function validateProfileSlug(input: unknown): string {
  if (typeof input !== 'string' || input.length < 3 || input.length > 63) {
    throw new Error('Profile slug must contain 3 to 63 ASCII characters');
  }
  const normalized = input.normalize('NFKC').toLocaleLowerCase('en-US');
  if (normalized !== input || !slugSyntax.test(input)) {
    throw new Error('Profile slug must already be canonical lowercase ASCII');
  }
  if (RESERVED_PROFILE_SLUGS.has(input)) throw new Error('Profile slug is reserved');
  return input;
}

/** Validate a complete immutable directory before it can serve lookups. */
export function validateProfileDirectory(input: unknown): ProfileRecord[] {
  return profileDirectorySchema.parse(input);
}

/**
 * Resolve only within authenticated tenant scope. Every unavailable case intentionally has the
 * same error so callers cannot enumerate disabled, private, or cross-tenant profiles.
 */
export function resolveTenantProfile(input: unknown, request: unknown): ProfileRecord {
  const directory = validateProfileDirectory(input);
  const parsed = z.object({ tenantId: identifier, slug: z.string() }).strict().parse(request);
  let slug: string;
  try {
    slug = validateProfileSlug(parsed.slug);
  } catch {
    throw new Error('Profile unavailable');
  }
  const record = directory.find(candidate => candidate.slug === slug && candidate.tenantId === parsed.tenantId);
  if (!record?.enabled) throw new Error('Profile unavailable');
  return structuredClone(record);
}

/** Project the exact public, non-authorizing fields for an enabled public profile. */
export function resolvePublicProfileDescriptor(input: unknown, slugInput: unknown): PublicProfileDescriptor {
  const directory = validateProfileDirectory(input);
  let slug: string;
  try {
    slug = validateProfileSlug(slugInput);
  } catch {
    throw new Error('Profile unavailable');
  }
  const record = directory.find(candidate => candidate.slug === slug);
  if (!record?.enabled || record.visibility !== 'public-bootstrap') throw new Error('Profile unavailable');
  return {
    schemaVersion: 1,
    profile: { id: record.id, slug: record.slug, revision: record.revision, digest: record.digest }
  };
}
