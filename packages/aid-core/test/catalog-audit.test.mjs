import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCatalogAudit, CatalogAuditObservationSchema, CatalogAuditScheduleSchema } from '../dist/catalog-audit.js';
import { migrateLegacySoftwareCatalogEntry } from '../dist/software-catalog.js';

const now = '2026-11-10T12:00:00.000Z';
const entry = migrateLegacySoftwareCatalogEntry({ name: 'ripgrep', bin: 'rg', providers: ['brew'], pkgs: { brew: 'ripgrep' }, platforms: ['macos', 'linux'], installMode: 'cli', preload: false, deliveryMode: 'lazy', loadPolicy: 'lazy', loadRationale: 'default-lazy', github: 'https://github.com/BurntSushi/ripgrep' });
const policy = { schemaVersion: 1, policyId: 'default-audit-v1', maximumAgeMs: 86_400_000, staleReleaseMs: 31_536_000_000, minimumPopularityStars: 1000, allowedLicenses: ['MIT', 'Apache-2.0'], deniedLicenses: ['AGPL-3.0-only'] };
const observation = { schemaVersion: 1, entryKey: 'ripgrep', observedAt: '2026-11-10T10:00:00.000Z', source: 'https://api.github.com/repos/BurntSushi/ripgrep', immutableSourceDigest: 'a'.repeat(64),
  release: { status: 'observed', latestVersion: '14.1.1', publishedAt: '2026-10-01T00:00:00.000Z', prerelease: false },
  maintenance: { status: 'observed', archived: false, lastCommitAt: '2026-10-20T00:00:00.000Z', openIssueCount: 31 },
  popularity: { status: 'observed', stars: 60000, forks: 2300 }, vulnerabilities: { status: 'observed', database: 'osv', queriedAt: '2026-11-10T10:00:00.000Z', findings: [] },
  license: { status: 'observed', spdx: 'MIT', evidenceUrl: 'https://github.com/BurntSushi/ripgrep/blob/master/LICENSE-MIT' },
  support: { status: 'observed', receiptDigests: ['b'.repeat(64)], expiresAt: '2026-12-10T00:00:00.000Z' } };

test('current evidence produces deterministic qualified reports without provisioning authority', async () => {
  const first = await evaluateCatalogAudit({ entry, policy, observation, now });
  assert.deepEqual(first, await evaluateCatalogAudit({ entry: structuredClone(entry), policy, observation: structuredClone(observation), now }));
  assert.deepEqual([first.evidence, first.maintenance, first.popularity, first.vulnerability, first.license, first.support], ['current', 'maintained', 'qualified', 'clear', 'allowed', 'verified']);
  assert.equal(first.provisioningAdmission, 'independent'); assert.deepEqual(first.reasons, []);
});

test('missing and stale remote evidence remains explicit and network-independent', async () => {
  const missing = await evaluateCatalogAudit({ entry, policy, observation: null, now });
  assert.deepEqual([missing.evidence, missing.popularity, missing.vulnerability], ['missing', 'unknown', 'unknown']);
  assert.equal((await evaluateCatalogAudit({ entry, policy, observation: { ...observation, observedAt: '2026-01-01T00:00:00.000Z' }, now })).evidence, 'stale');
  assert.equal(CatalogAuditScheduleSchema.parse({ schemaVersion: 1, scheduleId: 'catalog-daily', policyId: policy.policyId, intervalMs: 86_400_000, jitterMs: 3_600_000, networkRequiredOnlyForAudit: true, provisioningDependency: false, boundedConcurrency: 8 }).provisioningDependency, false);
});

test('risk signals remain individually visible', async () => {
  const report = await evaluateCatalogAudit({ entry, policy, observation: { ...observation,
    maintenance: { ...observation.maintenance, archived: true }, popularity: { ...observation.popularity, stars: 2 },
    vulnerabilities: { ...observation.vulnerabilities, findings: [{ id: 'cve-2026-0001', severity: 'critical', affected: true, fixedVersion: null }] },
    license: { ...observation.license, spdx: 'AGPL-3.0-only' }, support: { ...observation.support, expiresAt: '2026-11-01T00:00:00.000Z' } }, now });
  assert.deepEqual([report.maintenance, report.popularity, report.vulnerability, report.license, report.support], ['archived', 'below-threshold', 'affected', 'denied', 'expired']);
});

test('strict observations reject partial evidence and identity substitution', async () => {
  assert.throws(() => CatalogAuditObservationSchema.parse({ ...observation, popularity: { status: 'observed', stars: 1 } }));
  await assert.rejects(evaluateCatalogAudit({ entry, policy, observation: { ...observation, entryKey: 'other' }, now }), /identity mismatch/);
  await assert.rejects(evaluateCatalogAudit({ entry, policy, observation: { ...observation, observedAt: '2027-01-01T00:00:00.000Z' }, now }), /future/);
});
