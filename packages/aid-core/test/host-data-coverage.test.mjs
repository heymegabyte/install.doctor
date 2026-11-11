import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assessHostCoverage, validateHostDataCoverageEstate } from '../dist/host-data-coverage.js';

const fixture = () => ({
  schemaVersion: 1,
  inventories: [{
    id: 'fixture-host', observedAt: '2026-11-10T12:00:00.000Z', evidenceState: 'observed',
    os: { family: 'linux', version: '12', architecture: 'x64' },
    hardware: { deviceClasses: ['virtual-disk'], notes: 'Disposable fixture' }, filesystems: ['ext4'], pools: [],
    encryption: [{ scope: '/', state: 'encrypted', reason: 'Fixture volume encryption enabled' }],
    virtualization: { role: 'guest', technologies: ['qemu'] }, services: ['postgres'], protectionTools: ['restic'],
    capabilities: [{ id: 'file-backup', state: 'supported', reason: 'Restic fixture available' }],
  }],
  coverage: [{ hostId: 'fixture-host', inventoryObservedAt: '2026-11-10T12:00:00.000Z', sources: [{
    id: 'database-primary', kind: 'database', locator: 'postgres:app', authoritative: true,
    layers: [
      { layer: 'snapshot', state: 'inapplicable', reason: 'Database-native dump is the consistency boundary' },
      { layer: 'replication', state: 'inapplicable', reason: 'Fixture has no replica objective' },
      { layer: 'independent-backup', state: 'protected', method: 'encrypted restic repository', reason: 'Copy is outside the fixture failure domain' },
      { layer: 'verification', state: 'protected', method: 'restic check plus database import', reason: 'Client decryption and structure are checked' },
      { layer: 'restore', state: 'protected', method: 'isolated PostgreSQL import', reason: 'Disposable restore target is available' },
    ],
  }] }],
});

const discovery = () => [{ id: 'database-primary', kind: 'database', locator: 'postgres:app', authoritative: true }];

test('accepts complete per-host capabilities and every authoritative data kind', () => {
  const input = fixture();
  const kinds = ['dataset', 'file', 'vm', 'container', 'configuration', 'key'];
  for (const [index, kind] of kinds.entries()) {
    const source = structuredClone(input.coverage[0].sources[0]); source.id = `${kind}-${index}`; source.kind = kind; source.locator = `${kind}:fixture`;
    input.coverage[0].sources.push(source);
  }
  assert.deepEqual(validateHostDataCoverageEstate(input), input);
});

test('healthy coverage requires exact discovery and a protected restore method', () => {
  assert.deepEqual(assessHostCoverage(fixture(), 'fixture-host', discovery()), { hostId: 'fixture-host', healthy: true, gaps: [] });
});

test('newly discovered unprotected authoritative data fails coverage health', () => {
  const found = discovery(); found.push({ id: 'new-container-volume', kind: 'container', locator: 'volume:uploads', authoritative: true });
  const result = assessHostCoverage(fixture(), 'fixture-host', found);
  assert.equal(result.healthy, false);
  assert.match(result.gaps.join('\n'), /newly discovered authoritative source has no coverage map/);
  found[1].authoritative = false;
  assert.equal(assessHostCoverage(fixture(), 'fixture-host', found).healthy, true);
});

test('unprotected layers, missing restore, stale discovery, and substituted identity fail health', () => {
  const unprotected = fixture(); unprotected.coverage[0].sources[0].layers[2] = { layer: 'independent-backup', state: 'unprotected', reason: 'No destination' };
  assert.match(assessHostCoverage(unprotected, 'fixture-host', discovery()).gaps.join('\n'), /independent-backup: unprotected/);
  const missing = assessHostCoverage(fixture(), 'fixture-host', []);
  assert.match(missing.gaps.join('\n'), /was not discovered/);
  const substituted = discovery(); substituted[0].locator = 'postgres:other';
  assert.match(assessHostCoverage(fixture(), 'fixture-host', substituted).gaps.join('\n'), /does not match reviewed identity/);
});

test('canonical repository inventory is valid and truthfully reports Zen recovery gaps', async () => {
  const input = JSON.parse(await readFile(new URL('../../../config/fleet/host-data-coverage.json', import.meta.url), 'utf8'));
  validateHostDataCoverageEstate(input);
  const result = assessHostCoverage(input, 'zen', [{ id: 'zen-rpool', kind: 'dataset', locator: 'rpool', authoritative: true }]);
  assert.equal(result.healthy, false);
  assert.match(result.gaps.join('\n'), /independent-backup: unprotected/);
  assert.match(result.gaps.join('\n'), /no usable restore method/);
});

test('strict schemas reject unknown fields, duplicate capabilities, and coverage not bound to observation', () => {
  const unknown = fixture(); unknown.inventories[0].secret = 'not-allowed';
  assert.throws(() => validateHostDataCoverageEstate(unknown), /unrecognized/i);
  const duplicate = fixture(); duplicate.inventories[0].capabilities.push(structuredClone(duplicate.inventories[0].capabilities[0]));
  assert.throws(() => validateHostDataCoverageEstate(duplicate), /unique/i);
  const stale = fixture(); stale.coverage[0].inventoryObservedAt = '2026-11-09T12:00:00.000Z';
  assert.throws(() => validateHostDataCoverageEstate(stale), /not bound/i);
});
