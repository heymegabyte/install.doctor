import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TargetDeviceAuthorization } from '../dist/target-device-authorization.js';

const fixedNow = new Date('2026-11-08T15:00:00.000Z');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-device-auth-'));
  await chmod(root, 0o700);
  const statePath = join(root, 'pending.json');
  const calls = [];
  const results = [];
  const transport = {
    async start(input) {
      calls.push({ operation: 'start', input });
      return {
        request: {
          schemaVersion: 1,
          requestId: 'request-1',
          binding: { tenantId: 'tenant-server-owned', ...input.binding },
          machineLabel: input.machineLabel,
          verificationCode: 'ABCD-EF12',
          pollKeyFingerprint: createHash('sha256').update(input.pollSecret).digest('hex'),
          createdAt: fixedNow.toISOString(),
        },
        approvalUri: 'https://brian.desktop.tools/activate',
        pollIntervalMs: 2_000,
      };
    },
    async poll(requestId, pollSecret) {
      calls.push({ operation: 'poll', requestId, pollSecret });
      return results.shift() ?? { status: 'pending' };
    },
    async cancel(requestId, pollSecret) { calls.push({ operation: 'cancel', requestId, pollSecret }); },
  };
  const events = [];
  const delays = [];
  const client = new TargetDeviceAuthorization({
    statePath, transport, emit: event => events.push(event), now: () => fixedNow,
    sleep: async milliseconds => { delays.push(milliseconds); },
  });
  return { root, statePath, calls, results, events, delays, client, transport };
}

const startInput = {
  profileId: 'workstation', machineLabel: 'Zen workstation',
  scopes: ['session:create', 'profile:read'], expiresAt: '2026-11-08T15:10:00.000Z',
};

test('generates target authority, persists it owner-only, and exposes only the human prompt', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const prompt = await state.client.begin(startInput, new AbortController().signal);
  assert.deepEqual(prompt, {
    verificationCode: 'ABCD-EF12', approvalUri: 'https://brian.desktop.tools/activate',
    expiresAt: startInput.expiresAt, cancellation: 'Press Ctrl-C to cancel safely.',
  });
  const stored = JSON.parse(await readFile(state.statePath, 'utf8'));
  assert.match(stored.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.equal((await lstat(state.statePath)).mode & 0o777, 0o600);
  assert.deepEqual(stored.request.binding.scopes, ['profile:read', 'session:create']);
  assert.equal(stored.request.binding.tenantId, 'tenant-server-owned');
  assert.equal(stored.request.binding.targetKeyFingerprint, createHash('sha256').update(Buffer.from(stored.request.binding.targetPublicKey, 'base64url')).digest('hex'));
  assert.doesNotMatch(JSON.stringify(prompt), new RegExp(stored.pollSecret));
  assert.doesNotMatch(JSON.stringify(state.events), new RegExp(stored.pollSecret));
  assert.doesNotMatch(JSON.stringify(state.events), /PRIVATE KEY/);
});

test('resumes after restart, honors bounded server retry guidance, and removes state after claim', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  await state.client.begin(startInput, new AbortController().signal);
  state.results.push(
    { status: 'pending', retryAfterMs: 500 },
    { status: 'pending', retryAfterMs: 120_000 },
    { status: 'approved', credential: 'device-secret-never-log', credentialId: 'credential-1', expiresAt: '2026-11-08T16:00:00.000Z' },
  );
  const restarted = new TargetDeviceAuthorization({
    statePath: state.statePath, transport: state.transport, emit: event => state.events.push(event),
    now: () => fixedNow, sleep: async milliseconds => { state.delays.push(milliseconds); },
  });
  const outcome = await restarted.resume(new AbortController().signal);
  assert.equal(outcome.status, 'approved');
  assert.deepEqual(state.delays, [2_000, 30_000]);
  await assert.rejects(readFile(state.statePath), error => error.code === 'ENOENT');
  assert.doesNotMatch(JSON.stringify(state.events), /device-secret-never-log/);
  assert.doesNotMatch(JSON.stringify(state.events), /pollSecret|privateKey|credential/);
});

test('credential persistence failure preserves resumable polling state', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  await state.client.begin(startInput, new AbortController().signal);
  state.results.push({ status: 'approved', credential: 'device-secret-never-log',
    credentialId: 'credential-1', expiresAt: '2026-11-08T16:00:00.000Z' });
  const restarted = new TargetDeviceAuthorization({ statePath: state.statePath, transport: state.transport,
    now: () => fixedNow, persistApproved: async () => { throw new Error('disk unavailable'); } });
  await assert.rejects(restarted.resume(new AbortController().signal), /disk unavailable/);
  assert.equal(JSON.parse(await readFile(state.statePath, 'utf8')).request.requestId, 'request-1');
});

test('cancellation informs the service, clears restart state, and reveals no private authority', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  await state.client.begin(startInput, new AbortController().signal);
  const stored = JSON.parse(await readFile(state.statePath, 'utf8'));
  const outcome = await state.client.cancel('operator-cancelled');
  assert.deepEqual(outcome, { status: 'cancelled', reason: 'operator-cancelled' });
  assert.equal(state.calls.at(-1).operation, 'cancel');
  await assert.rejects(readFile(state.statePath), error => error.code === 'ENOENT');
  assert.doesNotMatch(JSON.stringify(state.events), new RegExp(stored.pollSecret));
  assert.doesNotMatch(JSON.stringify(state.events), /PRIVATE KEY/);
});

test('an abort while waiting performs protocol cancellation and clears resumable state', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  await state.client.begin(startInput, new AbortController().signal);
  const controller = new AbortController();
  const restarted = new TargetDeviceAuthorization({
    statePath: state.statePath, transport: state.transport, now: () => fixedNow,
    sleep: async () => { controller.abort(new Error('operator interrupted')); controller.signal.throwIfAborted(); },
  });
  const outcome = await restarted.resume(controller.signal);
  assert.deepEqual(outcome, { status: 'cancelled', reason: 'cancelled' });
  assert.equal(state.calls.at(-1).operation, 'cancel');
  await assert.rejects(readFile(state.statePath), error => error.code === 'ENOENT');
});

test('rejects insecure persisted state and response substitution', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  await state.client.begin(startInput, new AbortController().signal);
  if (process.platform !== 'win32') {
    await chmod(state.statePath, 0o644);
    await assert.rejects(state.client.prompt(), /mode 0600/);
  }
  await rm(state.statePath, { force: true });
  const originalStart = state.transport.start;
  state.transport.start = async input => {
    const response = await originalStart(input);
    response.request.binding.profileId = 'server';
    return response;
  };
  await assert.rejects(state.client.begin(startInput, new AbortController().signal), /not bound/);
});

test('rejects symlink and non-private state parents before reading or writing authority', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const privateTarget = join(state.root, 'private-target');
  const linkedParent = join(state.root, 'linked-parent');
  await mkdir(privateTarget, { mode: 0o700 });
  await symlink(privateTarget, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedClient = new TargetDeviceAuthorization({ statePath: join(linkedParent, 'pending.json'), transport: state.transport });
  await assert.rejects(linkedClient.begin(startInput, new AbortController().signal), /parent must be a private directory/);
  await assert.rejects(linkedClient.prompt(), /parent must be a private directory/);

  const openParent = join(state.root, 'open-parent');
  await mkdir(openParent, { mode: 0o700 });
  if (process.platform !== 'win32') {
    await chmod(openParent, 0o755);
    const openClient = new TargetDeviceAuthorization({ statePath: join(openParent, 'pending.json'), transport: state.transport });
    await assert.rejects(openClient.begin(startInput, new AbortController().signal), /mode 0700/);
    await assert.rejects(openClient.prompt(), /mode 0700/);
  }
});

test('private material is absent from process arguments, Markdown prompt, and telemetry', async t => {
  const state = await fixture();
  t.after(() => rm(state.root, { recursive: true, force: true }));
  const prompt = await state.client.begin(startInput, new AbortController().signal);
  const stored = JSON.parse(await readFile(state.statePath, 'utf8'));
  const publicSurfaces = [process.argv.join(' '), JSON.stringify(prompt), JSON.stringify(state.events)].join('\n');
  for (const secret of [stored.pollSecret, stored.privateKeyPem]) assert.equal(publicSurfaces.includes(secret), false);
  const markdown = `Open **${prompt.approvalUri}** and enter \`${prompt.verificationCode}\`. Expires ${prompt.expiresAt}. ${prompt.cancellation}`;
  assert.equal(markdown.includes(stored.pollSecret), false);
  assert.equal(markdown.includes(stored.privateKeyPem), false);
});
