import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QUBES_COMPARTMENT_KINDS,
  QUBES_FIXTURE_BOUNDARIES,
  QUBES_LIFECYCLE_PHASES,
  QubesFixtureSchema,
  digestQubesFixture,
  preflightQubesMutation,
} from '../dist/qubes-fixture-contract.js';

const releaseDigest = 'a'.repeat(64);
const recipeDigest = 'b'.repeat(64);
const now = '2026-11-10T12:00:00.000Z';
/** @typedef {ReturnType<typeof QubesFixtureSchema.parse>['compartments'][number]} Compartment */
/** @type {Array<[Compartment['id'], Compartment['kind'], Compartment['templateId'], Compartment['networking'], Compartment['persistentRoot'], Compartment['outboundAuthorities'], Compartment['acceptedAuthorities']]>} */
const compartmentRows = [
  ['admin', 'dom0', null, 'none', true, ['admin.read'], ['file.open']],
  ['debian-12', 'template-vm', null, 'none', true, ['template.update'], ['template.update']],
  ['work', 'app-vm', 'debian-12', 'through-netvm', true, ['file.open'], ['file.open']],
  ['disp-work', 'disposable-vm', 'debian-12', 'through-netvm', false, ['file.open'], ['file.open']],
  ['sys-whonix', 'whonix-gateway', 'debian-12', 'direct', true, ['network.proxy'], ['network.proxy']],
  ['anon-whonix', 'whonix-workstation', 'debian-12', 'whonix-only', true, ['file.open'], ['file.open']],
];
const compartments = compartmentRows.map(([id, kind, templateId, networking, persistentRoot, outboundAuthorities, acceptedAuthorities]) => ({
  id, kind, templateId, networking, persistentRoot, outboundAuthorities, acceptedAuthorities,
}));
/** @type {ReturnType<typeof QubesFixtureSchema.parse>} */
const fixture = {
  schemaVersion: 1, fixtureId: 'qubes-4.2-lab', isolation: 'disposable-qubes-lab', platform: 'qubes', qubesVersion: '4.2.4',
  compartments,
  qrexecRules: [{ ruleId: 'work-open-admin', sourceId: 'work', targetId: 'admin', service: 'desktop.ToolsOpen',
    argument: 'review', authorities: ['file.open'], user: 'user' }],
  supportedBoundaries: [...QUBES_FIXTURE_BOUNDARIES],
};

/**
 * @param {import('../dist/qubes-fixture-contract.js').QubesFixtureBoundary} boundary
 * @param {Partial<ReturnType<typeof import('../dist/qubes-fixture-contract.js').QubesFixtureEvidenceSchema.parse>>} overrides
 */
function evidence(boundary, overrides = {}) {
  return { schemaVersion: 1, evidenceId: `qubes-${boundary}`, source: 'real-qubes-lab', fixtureId: fixture.fixtureId,
    boundary, releaseDigest, recipeDigest, fixtureDigest: digestQubesFixture(fixture),
    observedAt: '2026-11-10T10:00:00.000Z', expiresAt: '2026-11-17T10:00:00.000Z',
    independentAttestor: 'qubes-lab-attestor', phases: [...QUBES_LIFECYCLE_PHASES], outcome: 'passed', ...overrides };
}

/**
 * @param {import('../dist/qubes-fixture-contract.js').QubesFixtureBoundary} boundary
 * @param {Partial<ReturnType<typeof import('../dist/qubes-fixture-contract.js').QubesMutationPreflightSchema.parse>>} overrides
 */
function request(boundary, overrides = {}) {
  const item = evidence(boundary);
  return { fixture, boundary, qrexec: null, releaseDigest, recipeDigest, evidence: [item],
    verifiedEvidenceIds: [item.evidenceId], now, ...overrides };
}

test('strict fixture represents every required Qubes compartment and qrexec boundary', () => {
  assert.deepEqual([...new Set(QubesFixtureSchema.parse(fixture).compartments.map(item => item.kind))], QUBES_COMPARTMENT_KINDS);
  assert.throws(() => QubesFixtureSchema.parse({ ...fixture, unexpected: true }), /unrecognized/i);
  assert.throws(() => QubesFixtureSchema.parse({ ...fixture, compartments: compartments.filter(item => item.kind !== 'disposable-vm') }), /disposable-vm/);
  assert.throws(() => QubesFixtureSchema.parse({ ...fixture,
    compartments: compartments.map(item => item.kind === 'dom0' ? { ...item, networking: 'direct' } : item),
  }), /network-isolated/);
  assert.throws(() => QubesFixtureSchema.parse({ ...fixture,
    compartments: compartments.map(item => item.kind === 'disposable-vm' ? { ...item, persistentRoot: true } : item),
  }), /ephemeral/);
  assert.throws(() => QubesFixtureSchema.parse({ ...fixture,
    compartments: compartments.map(item => item.id === 'work' ? { ...item, templateId: 'missing-template' } : item),
  }), /resolve to a fixture TemplateVM/);
});

test('every compartment boundary needs current externally verified evidence bound to exact fixture policy', () => {
  for (const boundary of QUBES_COMPARTMENT_KINDS) {
    assert.deepEqual(preflightQubesMutation(request(boundary)), {
      decision: 'allow', boundary, evidenceId: `qubes-${boundary}`, reason: 'verified-real-evidence',
    });
  }
  const base = request('app-vm');
  for (const denied of [
    { ...base, verifiedEvidenceIds: [] },
    { ...base, now: '2026-11-18T12:00:00.000Z' },
    { ...base, now: '2026-11-01T12:00:00.000Z' },
    { ...base, releaseDigest: 'c'.repeat(64) },
    { ...base, recipeDigest: 'd'.repeat(64) },
    { ...base, evidence: [evidence('app-vm', { fixtureDigest: 'e'.repeat(64) })] },
  ]) assert.equal(preflightQubesMutation(denied).reason, 'no-current-verified-real-evidence');
});

test('qrexec admits only the exact route and intersection of source, rule, and target authority', () => {
  /** @type {NonNullable<ReturnType<typeof import('../dist/qubes-fixture-contract.js').QubesMutationPreflightSchema.parse>['qrexec']>} */
  const qrexec = { sourceId: 'work', targetId: 'admin', service: 'desktop.ToolsOpen', argument: 'review', authority: 'file.open' };
  assert.deepEqual(preflightQubesMutation(request('qrexec', { qrexec })), {
    decision: 'allow', boundary: 'qrexec', evidenceId: 'qubes-qrexec', ruleId: 'work-open-admin', reason: 'verified-real-evidence',
  });
  /** @type {Array<[Partial<typeof qrexec>, string]>} */
  const deniedRoutes = [
    [{ targetId: 'debian-12' }, 'no-exact-qrexec-rule'],
    [{ service: 'desktop.ToolsAdmin' }, 'no-exact-qrexec-rule'],
    [{ argument: 'install' }, 'no-exact-qrexec-rule'],
    [{ authority: 'template.update' }, 'authority-not-delegated'],
    [{ sourceId: 'missing' }, 'unknown-compartment'],
  ];
  for (const [change, reason] of deniedRoutes) assert.equal(preflightQubesMutation(request('qrexec', { qrexec: { ...qrexec, ...change } })).reason, reason);
});

test('one compartment cannot broaden another authority through fixture policy', () => {
  const broadenSource = structuredClone(fixture);
  const [sourceRule] = broadenSource.qrexecRules;
  assert.ok(sourceRule);
  sourceRule.authorities = ['template.update'];
  assert.throws(() => QubesFixtureSchema.parse(broadenSource), /broaden source authority/);

  const broadenTarget = structuredClone(fixture);
  const [targetRule] = broadenTarget.qrexecRules;
  const source = broadenTarget.compartments.find(item => item.id === 'work');
  assert.ok(targetRule);
  assert.ok(source);
  source.outboundAuthorities.push('network.proxy');
  targetRule.authorities = ['network.proxy'];
  assert.throws(() => QubesFixtureSchema.parse(broadenTarget), /broaden target acceptance/);

  assert.throws(() => QubesFixtureSchema.parse({ ...fixture, qrexecRules: [...fixture.qrexecRules,
    { ...fixture.qrexecRules[0], ruleId: 'duplicate-route' }] }), /non-overlapping/);
  assert.throws(() => QubesFixtureSchema.parse({ ...fixture, qrexecRules: [{ ...fixture.qrexecRules[0], service: '*' }] }));
});

test('unsupported or malformed requests fail closed without executing Qubes operations', () => {
  assert.deepEqual(preflightQubesMutation(request('app-vm', { fixture: { ...fixture, supportedBoundaries: ['dom0'] } })), {
    decision: 'deny', boundary: 'app-vm', reason: 'unsupported-boundary',
  });
  assert.throws(() => preflightQubesMutation({ ...request('qrexec'), qrexec: null }), /required only/);
  assert.throws(() => preflightQubesMutation({ ...request('dom0'), qrexec: { sourceId: 'work', targetId: 'admin', service: 'x', argument: null, authority: 'file.open' } }), /required only/);
  assert.throws(() => preflightQubesMutation({ ...request('dom0'), extra: true }), /unrecognized/i);
});
