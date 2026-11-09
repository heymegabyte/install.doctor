import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PROVISIONING_PROMPT, PROVISIONING_PROMPT_VERSION } from '../../src/desktop-tools-supervisor.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]))
    : value;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const octal = (value, length) => `${value.toString(8).padStart(length - 1, '0')}\0`;
const tarEntry = (name, bytes, mode) => {
  const header = Buffer.alloc(512); header.write(name, 0, 100); header.write(octal(mode, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii'); header.write(octal(0, 8), 116, 8, 'ascii'); header.write(octal(bytes.length, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii'); header.fill(0x20, 148, 156); header[156] = 0x30;
  header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
};

export async function createProtocolRuntimeFixture(identity) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-tools-composition-runtime-'));
  const state = join(root, 'state');
  await mkdir(join(state, 'config'), { recursive: true, mode: 0o700 });
  await writeFile(join(state, 'config', 'inference-token'), 'scoped-fixture-token-abcdefghijklmnopqrstuvwxyz\n', { mode: 0o600 });
  const runtime = join(root, 'opencode');
  await writeFile(runtime, `#!/bin/sh
if [ "$1" = --version ]; then printf "opencode 2.2.5\\n"; exit 0; fi
printf "%s\\n" "$@" >"$DESKTOP_TOOLS_STATE_DIR/argv"
env | LC_ALL=C sort >"$DESKTOP_TOOLS_STATE_DIR/observed-environment"
printf "%s\\n" "$OPENCODE_CONFIG_CONTENT" >"$DESKTOP_TOOLS_STATE_DIR/opencode-config"
test -f "$DESKTOP_TOOLS_PROMPT_EVIDENCE"
`, { mode: 0o700 });
  await chmod(runtime, 0o700);
  const runtimeSha256 = digest(await readFile(runtime));
  const engine = join(root, 'desktop-tools-engine.mjs');
  await writeFile(engine, '#!/usr/bin/env node\n', { mode: 0o700 });
  const engineSha256 = digest(await readFile(engine));
  const toolsArchive = join(root, 'desktop-tools-tools.tar.gz');
  await writeFile(toolsArchive, gzipSync(Buffer.concat([
    tarEntry('contracts/runtime-policy.json', Buffer.from('{}\n'), 0o600),
    tarEntry('contracts/supervisor-api.schema.json', Buffer.from('{}\n'), 0o600),
    tarEntry('contracts/typed-tools.json', Buffer.from('{}\n'), 0o600),
    tarEntry('bin/desktop-tools-mcp-server.mjs', Buffer.from('#!/usr/bin/env node\n'), 0o700),
    Buffer.alloc(1024),
  ]), { mtime: 0 }));
  const toolsSha256 = digest(await readFile(toolsArchive));
  const toolContext = join(root, 'tool-context.json');
  await writeFile(toolContext, `${JSON.stringify({ schemaVersion: 1, sessionId: identity.sessionId, runId: identity.runId,
    authorizationId: identity.authorizationId, releaseId: identity.releaseId, releaseDigest: identity.releaseDigest,
    profileRevision: identity.profileRevision, profileDigest: identity.profileDigest, facts: {}, desiredState: {}, plan: {}, operations: {} })}\n`, { mode: 0o600 });
  const toolContextDigest = digest(await readFile(toolContext));
  const unsignedPrompt = {
    schemaVersion: 1, promptVersion: PROVISIONING_PROMPT_VERSION, promptDigest: digest(PROVISIONING_PROMPT),
    profile: { id: identity.profileId, revision: identity.profileRevision, digest: identity.profileDigest },
    release: { id: identity.releaseId, version: '2.2.5', digest: identity.releaseDigest },
    discoveredFacts: { arch: process.arch, platform: process.platform },
    policy: { concurrency: 2, network: false, toolContextDigest }, capabilities: ['configuration.read', 'packages.plan'],
    permittedTools: ['desktop_tools_discover', 'desktop_tools_plan'],
  };
  const prompt = { ...unsignedPrompt, contextDigest: digest(`${JSON.stringify(canonical(unsignedPrompt))}\n`) };
  const promptPath = join(root, 'provisioning-context.json');
  await writeFile(promptPath, `${JSON.stringify(prompt)}\n`, { mode: 0o600 });
  const session = { schemaVersion: 1, sessionId: identity.sessionId, runId: identity.runId, parentSessionId: null, parentRunId: null,
    createdAt: new Date().toISOString(), machine: { id: 'fixture-host', fingerprint: identity.deviceFingerprint },
    actor: { id: 'fixture-owner' }, authorization: { id: identity.authorizationId, scopes: identity.scopes, expiresAt: identity.authorizationExpiresAt } };
  const sessionPath = join(root, 'session-context.json');
  await writeFile(sessionPath, `${JSON.stringify(session)}\n`, { mode: 0o600 });
  return Object.freeze({
    root, state, runtime, runtimeSha256, prompt, promptPath, session, sessionPath,
    args: ['run', '--state-dir', state, '--runtime', runtime, '--sha256', runtimeSha256, '--version', '2.2.5', '--port', '4123',
      '--provisioning-context', promptPath, '--session-context', sessionPath, '--engine', engine, '--engine-sha256', engineSha256,
      '--tools-archive', toolsArchive, '--tools-sha256', toolsSha256, '--tool-context', toolContext],
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}
