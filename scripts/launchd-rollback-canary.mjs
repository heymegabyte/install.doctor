#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLaunchdServiceStateAdapter, serviceStateEquals } from '../packages/installer-engine/dist/index.js';

const run = promisify(execFile);
const [label, definitionPath, uidText] = process.argv.slice(2);
if (!label || !/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,126}[A-Za-z0-9])?$/.test(label)) throw new Error('invalid canary label');
if (!definitionPath || !definitionPath.startsWith('/') || definitionPath.length > 4096) throw new Error('invalid canary definition path');
if (!uidText || !/^[0-9]{1,10}$/.test(uidText)) throw new Error('invalid canary uid');
const uid = Number(uidText);
if (!Number.isSafeInteger(uid) || uid <= 0 || process.geteuid?.() !== uid) throw new Error('canary uid does not match the effective user');

const domain = { kind: 'gui', uid };
const serviceTarget = `gui/${uid}/${label}`;
const adapter = createLaunchdServiceStateAdapter({
  launchctlPath: '/bin/launchctl',
  plutilPath: '/usr/bin/plutil',
  authorizedDefinitions: [{ serviceId: label, domain, definitionPath }],
});

const target = await adapter.capture(label);
assert.equal(target.loaded, true);
assert.equal(target.enablementOverride, 'default');
try {
  await run('/bin/launchctl', ['bootout', serviceTarget], { timeout: 10_000, maxBuffer: 4096 });
  const mutated = await adapter.capture(label);
  assert.equal(mutated.loaded, false);
  assert.equal(mutated.enablementOverride, 'default');
  await adapter.restore(label, target);
  const restored = await adapter.capture(label);
  assert.equal(serviceStateEquals({ schemaVersion: 2, serviceId: label, manager: 'launchd', ...target }, restored), true);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, label, result: 'verified', target })}\n`);
} finally {
  await run('/bin/launchctl', ['bootout', serviceTarget], { timeout: 10_000, maxBuffer: 4096 }).catch(() => undefined);
}
