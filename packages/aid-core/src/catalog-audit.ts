import { z } from 'zod';
import { SoftwareCatalogEntrySchema } from './software-catalog.js';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true }).max(64);
const unknown = z.strictObject({ status: z.literal('unknown'), reason: z.enum(['not-queried', 'not-published', 'source-unavailable', 'unsupported-source', 'stale-evidence']) });

export const CatalogAuditPolicySchema = z.strictObject({ schemaVersion: z.literal(1), policyId: id,
  maximumAgeMs: z.number().int().min(60_000).max(31_536_000_000),
  staleReleaseMs: z.number().int().min(86_400_000).max(315_360_000_000),
  minimumPopularityStars: z.number().int().nonnegative().max(10_000_000),
  allowedLicenses: z.array(z.string().min(1).max(128)).max(1_024),
  deniedLicenses: z.array(z.string().min(1).max(128)).max(1_024),
}).superRefine((value, context) => {
  const overlap = value.allowedLicenses.filter(item => value.deniedLicenses.includes(item));
  if (overlap.length) context.addIssue({ code: 'custom', path: ['deniedLicenses'], message: `license appears in allow and deny policy: ${overlap.join(', ')}` });
});

export const CatalogAuditObservationSchema = z.strictObject({ schemaVersion: z.literal(1), entryKey: id,
  observedAt: instant, source: z.string().url().max(2_048), immutableSourceDigest: digest,
  release: z.discriminatedUnion('status', [unknown, z.strictObject({ status: z.literal('observed'), latestVersion: z.string().min(1).max(256), publishedAt: instant, prerelease: z.boolean() })]),
  maintenance: z.discriminatedUnion('status', [unknown, z.strictObject({ status: z.literal('observed'), archived: z.boolean(), lastCommitAt: instant, openIssueCount: z.number().int().nonnegative().max(10_000_000) })]),
  popularity: z.discriminatedUnion('status', [unknown, z.strictObject({ status: z.literal('observed'), stars: z.number().int().nonnegative().max(10_000_000), forks: z.number().int().nonnegative().max(10_000_000) })]),
  vulnerabilities: z.discriminatedUnion('status', [unknown, z.strictObject({ status: z.literal('observed'), database: id, queriedAt: instant,
    findings: z.array(z.strictObject({ id, severity: z.enum(['low', 'medium', 'high', 'critical']), affected: z.boolean(), fixedVersion: z.string().min(1).max(256).nullable() })).max(100_000) })]),
  license: z.discriminatedUnion('status', [unknown, z.strictObject({ status: z.literal('observed'), spdx: z.string().min(1).max(128), evidenceUrl: z.string().url().max(2_048) })]),
  support: z.discriminatedUnion('status', [unknown, z.strictObject({ status: z.literal('observed'), receiptDigests: z.array(digest).max(256), expiresAt: instant })]),
});

export const CatalogAuditScheduleSchema = z.strictObject({ schemaVersion: z.literal(1), scheduleId: id, policyId: id,
  intervalMs: z.number().int().min(300_000).max(31_536_000_000), jitterMs: z.number().int().nonnegative().max(86_400_000),
  networkRequiredOnlyForAudit: z.literal(true), provisioningDependency: z.literal(false), boundedConcurrency: z.number().int().min(1).max(64) });

export const CatalogAuditReportSchema = z.strictObject({ schemaVersion: z.literal(1), entryKey: id, policyId: id,
  evaluatedAt: instant, evidence: z.enum(['current', 'stale', 'missing']), maintenance: z.enum(['maintained', 'stale', 'archived', 'unknown']),
  popularity: z.enum(['qualified', 'below-threshold', 'unknown']), vulnerability: z.enum(['clear', 'affected', 'unknown']),
  license: z.enum(['allowed', 'denied', 'undeclared', 'unknown']), support: z.enum(['verified', 'expired', 'unverified', 'unknown']),
  provisioningAdmission: z.literal('independent'), reasons: z.array(z.string().min(1).max(512)).max(64), reportDigest: digest });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Evaluate cached evidence only. Provisioning never performs a network request through this API. */
export async function evaluateCatalogAudit(input: { entry: unknown; policy: unknown; observation: unknown | null; now: string }) {
  const entry = SoftwareCatalogEntrySchema.parse(input.entry);
  const policy = CatalogAuditPolicySchema.parse(input.policy);
  const now = instant.parse(input.now);
  const observation = input.observation === null ? null : CatalogAuditObservationSchema.parse(input.observation);
  if (observation && observation.entryKey !== entry.identity.key) throw new Error('audit observation entry identity mismatch');
  const age = observation ? Date.parse(now) - Date.parse(observation.observedAt) : Number.POSITIVE_INFINITY;
  if (age < 0) throw new Error('audit observation cannot be from the future');
  const reasons: string[] = [];
  const evidence = !observation ? 'missing' as const : age > policy.maximumAgeMs ? 'stale' as const : 'current' as const;
  if (evidence !== 'current') reasons.push(`audit-evidence-${evidence}`);
  let maintenance: 'maintained' | 'stale' | 'archived' | 'unknown' = 'unknown';
  if (observation?.maintenance.status === 'observed') maintenance = observation.maintenance.archived ? 'archived'
    : Date.parse(now) - Date.parse(observation.maintenance.lastCommitAt) > policy.staleReleaseMs ? 'stale' : 'maintained';
  if (maintenance !== 'maintained') reasons.push(`maintenance-${maintenance}`);
  const popularity = observation?.popularity.status === 'observed'
    ? observation.popularity.stars >= policy.minimumPopularityStars ? 'qualified' as const : 'below-threshold' as const : 'unknown' as const;
  if (popularity !== 'qualified') reasons.push(`popularity-${popularity}`);
  const vulnerability = observation?.vulnerabilities.status === 'observed'
    ? observation.vulnerabilities.findings.some(item => item.affected) ? 'affected' as const : 'clear' as const : 'unknown' as const;
  if (vulnerability !== 'clear') reasons.push(`vulnerability-${vulnerability}`);
  const spdx = observation?.license.status === 'observed' ? observation.license.spdx : entry.license.spdx;
  const license = !spdx ? 'unknown' as const : policy.deniedLicenses.includes(spdx) ? 'denied' as const
    : policy.allowedLicenses.includes(spdx) ? 'allowed' as const : 'undeclared' as const;
  if (license !== 'allowed') reasons.push(`license-${license}`);
  let support: 'verified' | 'expired' | 'unverified' | 'unknown' = 'unknown';
  if (observation?.support.status === 'observed') support = Date.parse(observation.support.expiresAt) > Date.parse(now)
    && observation.support.receiptDigests.length > 0 ? 'verified' : 'expired';
  else if (entry.supportEvidence.status === 'unverified') support = 'unverified';
  if (support !== 'verified') reasons.push(`support-${support}`);
  const unsigned = { schemaVersion: 1 as const, entryKey: entry.identity.key, policyId: policy.policyId, evaluatedAt: now,
    evidence, maintenance, popularity, vulnerability, license, support, provisioningAdmission: 'independent' as const,
    reasons: [...new Set(reasons)].sort() };
  const bytes = new TextEncoder().encode(canonical(unsigned));
  const reportDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  return CatalogAuditReportSchema.parse({ ...unsigned, reportDigest });
}
