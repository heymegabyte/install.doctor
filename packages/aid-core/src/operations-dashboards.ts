import { z } from 'zod';

const id = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const instant = z.string().datetime({ offset: true }).max(64);
const state = z.enum(['unknown', 'stale', 'running', 'failed', 'verified']);
const domains = ['release-adoption', 'fleet-drift', 'run-critical-path', 'agent-cost', 'secret-access',
  'platform-evidence', 'capacity', 'pool-health', 'backup-freshness', 'replication-lag', 'verification', 'restore-outcomes'] as const;

export const OperationsDashboardObservationSchema = z.strictObject({ schemaVersion: z.literal(1), tenantId: id,
  hostId: id.nullable(), domain: z.enum(domains), observedAt: instant, expiresAt: instant, state,
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), value: z.number().finite().nullable(),
  unit: z.enum(['1', 'percent', 'bytes', 'seconds', 'usd']).nullable(), reason: z.string().min(1).max(512),
}).superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.observedAt)) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'dashboard evidence expiry must follow observation' });
  if ((value.value === null) !== (value.unit === null)) context.addIssue({ code: 'custom', path: ['unit'], message: 'dashboard value and unit must be present together' });
  if (value.state === 'verified' && value.evidenceDigest === null) context.addIssue({ code: 'custom', path: ['evidenceDigest'], message: 'verified dashboard state requires evidence' });
});

export const OperationsDashboardQuerySchema = z.strictObject({ schemaVersion: z.literal(1), tenantId: id,
  now: instant, observations: z.array(OperationsDashboardObservationSchema).max(1_000_000) });

const panel = z.strictObject({ id, title: z.string().min(1).max(128), domain: z.enum(domains),
  source: z.enum(['prometheus', 'loki']), query: z.string().min(1).max(1_024),
  states: z.tuple([z.literal('unknown'), z.literal('stale'), z.literal('running'), z.literal('failed'), z.literal('verified')]),
  stateField: z.literal('desktop_tools_state'), evidenceField: z.literal('evidence_digest'),
  records: z.array(z.strictObject({ hostId: id.nullable(), state, observedAt: instant.nullable(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    value: z.number().finite().nullable(), unit: z.enum(['1', 'percent', 'bytes', 'seconds', 'usd']).nullable(), reason: z.string().min(1).max(512) })).max(100_000),
});
export const OperationsDashboardBundleSchema = z.strictObject({ schemaVersion: z.literal(1), tenantId: id, generatedAt: instant,
  dashboards: z.array(z.strictObject({ id, title: z.string().min(1).max(128), panels: z.array(panel).min(1).max(32) })).length(3) });

const definitions = [
  ['delivery', 'Delivery and execution', ['release-adoption', 'run-critical-path', 'agent-cost', 'secret-access']],
  ['fleet', 'Fleet and platform', ['fleet-drift', 'platform-evidence', 'capacity', 'pool-health']],
  ['recovery', 'Protection and recovery', ['backup-freshness', 'replication-lag', 'verification', 'restore-outcomes']],
] as const;

/** Pure dashboard projection. Queries consume bounded state labels; run/host IDs stay fields, not labels. */
export function buildOperationsDashboards(input: unknown) {
  const request = OperationsDashboardQuerySchema.parse(input);
  const selected = request.observations.filter(item => item.tenantId === request.tenantId);
  if (selected.length !== request.observations.length) throw new Error('cross-tenant dashboard evidence is forbidden');
  const dashboards = definitions.map(([dashboardId, title, panelDomains]) => ({ id: dashboardId, title,
    panels: panelDomains.map(domain => {
      const candidates = selected.filter(item => item.domain === domain);
      const byHost = new Map<string, typeof candidates[number]>();
      for (const candidate of candidates) {
        const key = candidate.hostId ?? '__fleet__';
        const previous = byHost.get(key);
        if (!previous || Date.parse(candidate.observedAt) > Date.parse(previous.observedAt)) byHost.set(key, candidate);
      }
      const records: Array<{ hostId: string | null; state: z.infer<typeof state>; observedAt: string | null;
        evidenceDigest: string | null; value: number | null; unit: '1' | 'percent' | 'bytes' | 'seconds' | 'usd' | null;
        reason: string }> = [...byHost.values()].map(item => {
        const stale = Date.parse(request.now) >= Date.parse(item.expiresAt);
        return { hostId: item.hostId, state: stale ? 'stale' as const : item.state, observedAt: item.observedAt,
          evidenceDigest: item.evidenceDigest, value: item.value, unit: item.unit,
          reason: stale ? 'evidence-expired' : item.reason };
      }).sort((a, b) => (a.hostId ?? '').localeCompare(b.hostId ?? ''));
      if (records.length === 0) records.push({ hostId: null, state: 'unknown' as const, observedAt: null,
        evidenceDigest: null, value: null, unit: null, reason: 'no-current-evidence' });
      return { id: domain, title: domain.split('-').map(word => `${word[0].toUpperCase()}${word.slice(1)}`).join(' '), domain,
        source: ['secret-access', 'restore-outcomes'].includes(domain) ? 'loki' as const : 'prometheus' as const,
        query: `{tenant_id="${request.tenantId}",desktop_tools_domain="${domain}"}`,
        states: ['unknown', 'stale', 'running', 'failed', 'verified'] as const,
        stateField: 'desktop_tools_state' as const, evidenceField: 'evidence_digest' as const, records };
    }) }));
  return OperationsDashboardBundleSchema.parse({ schemaVersion: 1, tenantId: request.tenantId, generatedAt: request.now, dashboards });
}
