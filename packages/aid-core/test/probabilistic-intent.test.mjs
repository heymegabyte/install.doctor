import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCadenceEntropy,
  predictIntentDistribution,
  createSpeculativeBranch,
  collapseSpeculativeBranch,
  evaporateSpeculativeBranch,
  cloudflareEdgeRoute,
  generateEdgeHeaders,
  evaluateEasterEgg,
  createVirtualPet,
  stepVirtualPet
} from '../dist/core.js';

test('calculateCadenceEntropy returns 0 on empty or single-bin intervals', () => {
  assert.equal(calculateCadenceEntropy([]), 0);
  assert.equal(calculateCadenceEntropy([80, 90, 100]), 0); // all bin 1
});

test('calculateCadenceEntropy calculates positive entropy across varied cadences', () => {
  const varied = [30, 80, 150, 400, 800, 2000];
  const entropy = calculateCadenceEntropy(varied);
  assert.ok(entropy > 2.0, `Expected entropy > 2.0, got ${entropy}`);
});

test('predictIntentDistribution identifies SYNC_CHEZMOI with high confidence', () => {
  const dist = predictIntentDistribution({
    terminalBuffer: 'chezmoi diff and apply',
    interArrivalsMs: [120, 140, 130],
    machineRole: 'workstation',
    recentCommands: ['git status']
  });
  assert.equal(dist.primaryIntent, 'SYNC_CHEZMOI');
  assert.ok(dist.confidence > 0.65);
  assert.equal(dist.speculativeEligible, true);
});

test('predictIntentDistribution identifies easter egg trigger keywords', () => {
  const dist = predictIntentDistribution({
    terminalBuffer: 'hack the planet',
    interArrivalsMs: [50, 60],
    machineRole: 'workstation',
    recentCommands: []
  });
  assert.equal(dist.primaryIntent, 'TRIGGER_EASTER_EGG');
  assert.equal(dist.speculativeEligible, true);
});

test('speculative branch lifecycle: fork -> collapse with 0ms perceived latency', () => {
  const now = '2026-11-01T21:40:00.000Z';
  const branch = createSpeculativeBranch('tenant-alpha', 'macbook-pro', 'SYNC_CHEZMOI', 1.45, now);
  assert.equal(branch.intent, 'SYNC_CHEZMOI');
  assert.ok(branch.stagedDiff.includes('.zshrc'));

  const voucher = {
    branchId: branch.branchId,
    intent: 'SYNC_CHEZMOI',
    actionDigest: 'sha256_mock_action_hash',
    clientTimestamp: '2026-11-01T21:40:01.000Z'
  };

  const collapsed = collapseSpeculativeBranch(branch, voucher, '2026-11-01T21:40:01.000Z');
  assert.equal(collapsed.status, 'collapsed');
  assert.equal(collapsed.perceivedLatencyMicros, 0);
  assert.ok(collapsed.auditSignature.includes(branch.branchId));
});

test('speculative branch rejects expired voucher', () => {
  const created = '2026-11-01T21:40:00.000Z';
  const branch = createSpeculativeBranch('tenant-alpha', 'macbook-pro', 'SYNC_CHEZMOI', 1.0, created);
  const voucher = {
    branchId: branch.branchId,
    intent: 'SYNC_CHEZMOI',
    actionDigest: 'abc',
    clientTimestamp: '2026-11-01T21:40:20.000Z' // 20s later, exceeds 15s TTL
  };
  assert.throws(() => collapseSpeculativeBranch(branch, voucher, '2026-11-01T21:40:20.000Z'), /expired/);
});

test('evaporateSpeculativeBranch records clean zero-side-effect drop', () => {
  const now = '2026-11-01T21:40:00.000Z';
  const branch = createSpeculativeBranch('tenant-beta', 'proxmox-1', 'DIAGNOSE_LOKI', 2.1, now);
  const evaporated = evaporateSpeculativeBranch(branch, 'user_divergence', '2026-11-01T21:40:02.000Z');
  assert.equal(evaporated.status, 'evaporated');
  assert.equal(evaporated.reason, 'user_divergence');
});

test('cloudflareEdgeRoute maps intents to proper edge DO and AI Gateway models', () => {
  const provRoute = cloudflareEdgeRoute('PROVISION_NODE', false);
  assert.equal(provRoute.workerTier, 'smart-placement');
  assert.equal(provRoute.durableObjectBinding, 'FLEET_COORDINATOR_DO');
  assert.equal(provRoute.aiGatewayModel, 'deepseek/deepseek-v3');

  const provPremium = cloudflareEdgeRoute('PROVISION_NODE', true);
  assert.equal(provPremium.aiGatewayModel, 'deepseek/deepseek-r1');

  const lokiRoute = cloudflareEdgeRoute('DIAGNOSE_LOKI', false);
  assert.equal(lokiRoute.aiGatewayModel, '@cf/meta/llama-3.3-70b-instruct');
});

test('generateEdgeHeaders produces required edge tracking and easter egg seeds', () => {
  const headers = generateEdgeHeaders(1.85, 'SYNC_CHEZMOI', '0xDEADBEEF');
  assert.equal(headers['X-Intent-Entropy'], '1.85');
  assert.equal(headers['X-Predicted-Intent'], 'SYNC_CHEZMOI');
  assert.equal(headers['X-Easter-Egg-Seed'], '0xDEADBEEF');
  assert.equal(headers['X-Speculative-Collapse'], 'ready');
});

test('evaluateEasterEgg triggers classic secret codes and ANSI games', () => {
  const xyzzy = evaluateEasterEgg({ kind: 'SECRET_CODE', payload: 'xyzzy' });
  assert.equal(xyzzy.unlocked, true);
  assert.equal(xyzzy.codeName, 'COLOSSAL_CAVE_PORTAL');
  assert.ok(xyzzy.content.includes('Plugh'));

  const matrix = evaluateEasterEgg({ kind: 'SECRET_CODE', payload: 'matrix' });
  assert.equal(matrix.unlocked, true);
  assert.equal(matrix.codeName, 'DIGITAL_RAIN');
  assert.ok(matrix.content.includes('Follow the white rabbit'));

  const c64 = evaluateEasterEgg({ kind: 'SECRET_CODE', payload: 'c64' });
  assert.equal(c64.unlocked, true);
  assert.equal(c64.codeName, 'COMMODORE_64_BOOT');
  assert.ok(c64.content.includes('COMMODORE 64 BASIC'));
});

test('evaluateEasterEgg detects Fibonacci harmonic cadence and awards VIP tokens', () => {
  const fib = evaluateEasterEgg({
    kind: 'HARMONIC_FIBONACCI',
    payload: '',
    intervalsMs: [12, 11, 22, 29, 53, 85, 128]
  });
  assert.equal(fib.unlocked, true);
  assert.equal(fib.codeName, 'FIBONACCI_HARMONIC_RESONANCE');
  assert.equal(fib.headers['X-VIP-Tokens'], '50000');
});

test('evaluateEasterEgg unlocks Astral 404 text dungeon', () => {
  const dungeon = evaluateEasterEgg({ kind: 'ASTRAL_404', payload: '/missing-route' });
  assert.equal(dungeon.unlocked, true);
  assert.equal(dungeon.codeName, 'ASTRAL_PLANE_DUNGEON');
  assert.ok(dungeon.content.includes('Astral Plane of 404'));
});

test('Virtual Pet lifecycle steps and evolves across stages', () => {
  let pet = createVirtualPet('session-42');
  assert.equal(pet.stage, 'egg');

  pet = stepVirtualPet(pet, 'idempotent-run');
  assert.equal(pet.stage, 'bitling');
  assert.equal(pet.happiness, 95);

  pet = stepVirtualPet(pet, 'easter-egg-unlocked');
  assert.equal(pet.stage, 'daemon');
  assert.equal(pet.wisdom, 45);

  pet = stepVirtualPet(pet, 'easter-egg-unlocked');
  assert.equal(pet.stage, 'fleet-master');
  assert.equal(pet.wisdom, 75);
  assert.equal(pet.ansiAvatar, ' ᕦ(ò_óˇ)ᕤ ');
});
