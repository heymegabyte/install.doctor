import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndexPath = path.resolve(__dirname, '../dist/index.js');

/**
 * Load the bundled Cloudflare Worker (`dist/index.js` emitted by `wrangler deploy --dry-run --outdir dist`)
 * by shimming the `cloudflare:workers` module import with an in-memory mock environment.
 */
async function loadWorkerApp() {
  assert.ok(fs.existsSync(distIndexPath), 'dist/index.js must exist (run `npm run check` first)');
  const rawCode = fs.readFileSync(distIndexPath, 'utf8');
  const mockModuleDataUrl =
    'data:text/javascript,' +
    encodeURIComponent(
      `import { DatabaseSync } from 'node:sqlite';
      const sqlite = new DatabaseSync(':memory:');
      sqlite.exec(\`
        CREATE TABLE IF NOT EXISTS "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
        CREATE TABLE IF NOT EXISTS "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
        CREATE TABLE IF NOT EXISTS "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
        CREATE TABLE IF NOT EXISTS "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
        CREATE TABLE IF NOT EXISTS "rateLimit" ("id" text not null primary key, "key" text not null, "count" integer not null, "lastRequest" integer not null);
        CREATE TABLE IF NOT EXISTS pairings (
          code text primary key, poll_sha256 text not null unique, tenant text not null, label text,
          permissions text, status text not null, device_id text, created_at text not null,
          expires_at text not null, approved_at text, claimed_at text
        );
        CREATE TABLE IF NOT EXISTS devices (
          device_id text primary key, tenant text not null, token_sha256 text not null unique,
          label text, permissions text, created_at text not null, revoked_at text
        );
      \`);
      const mockD1 = {
        prepare(rawSql) {
          const sql = rawSql
            .replace(/pragma_table_info\("([^"]+)"\)/gi, "pragma_table_info('$1')")
            .replace(/"(table|view|sqlite_%|kysely_migration|kysely_migration_lock)"/g, "'$1'");
          let bound = [];
          const stmt = {
            sql,
            bind(...args) { bound = args; return stmt; },
            async all() {
              const s = sqlite.prepare(sql);
              if (/^\\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\\b/i.test(sql)) {
                const info = s.run(...bound);
                return { results: [], success: true, meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) } };
              }
              const rows = s.all(...bound).map(r => ({ ...r }));
              return { results: rows, success: true, meta: {} };
            },
            async first(col) {
              const s = sqlite.prepare(sql);
              const row = s.get(...bound);
              if (!row) return null;
              const plain = { ...row };
              return col ? plain[col] : plain;
            },
            async run() {
              const s = sqlite.prepare(sql);
              const info = s.run(...bound);
              return { results: [], success: true, meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) } };
            },
            async raw() {
              const s = sqlite.prepare(sql);
              const rows = s.all(...bound);
              return rows.map(r => Object.values({ ...r }));
            }
          };
          return stmt;
        },
        async batch(stmts) { return Promise.all(stmts.map(s => s.all())); },
        async exec(sql) { sqlite.exec(sql); return { count: 1, duration: 1 }; }
      };
      globalThis.__AID_TEST_DB__ = mockD1;
      export const env = {
        DB: mockD1,
        AID_ADMIN_TOKEN: 'test_admin_secret_token_123456',
        BETTER_AUTH_SECRET: 'test_better_auth_secret_32_bytes_long_minimum!',
        GITHUB_CLIENT_ID: 'gh_client_test',
        GITHUB_CLIENT_SECRET: 'gh_secret_test',
        GOOGLE_CLIENT_ID: 'goog_client_test',
        GOOGLE_CLIENT_SECRET: 'goog_secret_test'
      };
      export class DurableObject {}
      export class WorkerEntrypoint {}
      export class WorkflowEntrypoint {}`
    );
  const patchedCode = rawCode.replace(/["']cloudflare:[^"']+["']/g, JSON.stringify(mockModuleDataUrl));
  const tmpBundle = path.resolve(__dirname, '../dist/.test-worker-bundle.mjs');
  fs.writeFileSync(tmpBundle, patchedCode, 'utf8');
  const mod = await import(`${tmpBundle}?t=${Date.now()}`);
  fs.rmSync(tmpBundle, { force: true });
  return mod.default;
}

const TEST_ENV = {
  AID_ADMIN_TOKEN: 'test_admin_secret_token_123456',
  AID_RECEIPT_SIGNING_KEY: 'test_receipt_signing_key_at_least_32_bytes_long!',
  BETTER_AUTH_SECRET: 'test_better_auth_secret_32_bytes_long_minimum!',
  INSTALL_DOCTOR_MANIFEST_URL: 'https://app.install.doctor/releases/test/manifest',
  INSTALL_DOCTOR_MANIFEST_SIGNATURE_URL: 'https://app.install.doctor/releases/test/manifest.sig',
  INSTALL_DOCTOR_RELEASE_SIGNER_ID: 'install-doctor-test',
};

const shellLiteral = (value) => `'${value.replaceAll("'", "'\\''")}'`;

test('pairing start uses a high-entropy human code and rejects oversized requests before parsing', async () => {
  const app = await loadWorkerApp();
  const env = { ...TEST_ENV, DB: globalThis.__AID_TEST_DB__ };
  const response = await app.fetch(
    new Request('https://app.install.doctor/api/devices/pair/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'pairing-security', label: 'workstation' }),
    }),
    env,
  );
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json();
  assert.match(body.code, /^[2-9A-HJ-NP-Z]{4}(?:-[2-9A-HJ-NP-Z]{4}){2}$/);
  assert.equal(body.code.length, 14);
  assert.equal(body.verifyUrl, `https://app.install.doctor/pair?code=${body.code}`);

  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const codeBytes = [...body.code.replaceAll('-', '')].map((character) => alphabet.indexOf(character));
  const originalGetRandomValues = globalThis.crypto.getRandomValues;
  let replayedCode = false;
  globalThis.crypto.getRandomValues = (array) => {
    if (!replayedCode && array.byteLength === 12) {
      replayedCode = true;
      array.set(codeBytes);
      return array;
    }
    return originalGetRandomValues.call(globalThis.crypto, array);
  };
  try {
    const collisionSafe = await app.fetch(
      new Request('https://app.install.doctor/api/devices/pair/start', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      }),
      env,
    );
    assert.equal(collisionSafe.status, 201, await collisionSafe.clone().text());
    assert.notEqual((await collisionSafe.json()).code, body.code);
    assert.equal(replayedCode, true, 'test must force an issuance collision');
  } finally {
    globalThis.crypto.getRandomValues = originalGetRandomValues;
  }

  const oversized = await app.fetch(
    new Request('https://app.install.doctor/api/devices/pair/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '4097' },
      body: '{}',
    }),
    env,
  );
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'payload_too_large', limitBytes: 4096 });

  const chunkedOversized = await app.fetch(
    new Request('https://app.install.doctor/api/devices/pair/start', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(4097),
    }),
    env,
  );
  assert.equal(chunkedOversized.status, 413);
  assert.deepEqual(await chunkedOversized.json(), { error: 'payload_too_large', limitBytes: 4096 });
});

test('public pairing lookup normalizes malformed, unknown, and claimed responses', async () => {
  const app = await loadWorkerApp();
  const env = { ...TEST_ENV, DB: globalThis.__AID_TEST_DB__ };
  const unavailable = { error: 'pairing_unavailable' };

  for (const code of ['', 'bad-code', '2222-2222-2222']) {
    const suffix = code ? `?code=${encodeURIComponent(code)}` : '';
    const response = await app.fetch(new Request(`https://app.install.doctor/api/devices/pair/info${suffix}`), env);
    assert.equal(response.status, 404, await response.clone().text());
    assert.deepEqual(await response.json(), unavailable);
  }

  const started = await app.fetch(
    new Request('https://app.install.doctor/api/devices/pair/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'private-tenant', label: 'private-host' }),
    }),
    env,
  );
  const pairing = await started.json();
  const pending = await app.fetch(new Request(`https://app.install.doctor/api/devices/pair/info?code=${pairing.code}`), env);
  assert.equal(pending.status, 200);
  assert.equal((await pending.json()).host, 'private-host');

  const approved = await app.fetch(
    new Request('https://app.install.doctor/api/devices/pair/approve', {
      method: 'POST',
      headers: { authorization: `Bearer ${TEST_ENV.AID_ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.code }),
    }),
    env,
  );
  assert.equal(approved.status, 200);
  const claimed = await app.fetch(
    new Request('https://app.install.doctor/api/devices/pair/poll', {
      headers: { authorization: `Bearer ${pairing.pollSecret}` },
    }),
    env,
  );
  assert.equal(claimed.status, 200);
  const afterClaim = await app.fetch(new Request(`https://app.install.doctor/api/devices/pair/info?code=${pairing.code}`), env);
  assert.equal(afterClaim.status, 404);
  assert.deepEqual(await afterClaim.json(), unavailable);
});

function makeBootstrapRuntimeFixture(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'install-doctor-bootstrap-test-'));
  const downloadRoot = path.join(fixtureRoot, 'downloads');
  const stageRoot = path.join(fixtureRoot, 'staging');
  const mockBin = path.join(fixtureRoot, 'bin');
  fs.mkdirSync(downloadRoot);
  fs.mkdirSync(stageRoot);
  fs.mkdirSync(mockBin);
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const privateKey = path.join(fixtureRoot, 'release-signing-key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'bootstrap-runtime-test', '-f', privateKey]);
  const publicKey = fs.readFileSync(`${privateKey}.pub`, 'utf8').trim();

  const curlMock = path.join(mockBin, 'curl');
  fs.writeFileSync(
    curlMock,
    `#!/usr/bin/env bash
set -euo pipefail
[ -z "\${MOCK_CURL_MARKER:-}" ] || : > "$MOCK_CURL_MARKER"
destination=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '--output' ]; then destination="$argument"; fi
  previous="$argument"
done
[ -n "$destination" ] || exit 64
url="\${!#}"
[ -z "\${MOCK_CURL_LOG:-}" ] || printf '%s\n' "$url" >> "$MOCK_CURL_LOG"
case "$url" in
  https://app.install.doctor/releases/test/manifest) source="$MOCK_MANIFEST" ;;
  https://app.install.doctor/releases/test/manifest.sig) source="$MOCK_SIGNATURE" ;;
  https://app.install.doctor/releases/test/provision.sh) source="$MOCK_ARTIFACT" ;;
  https://app.install.doctor/releases/test/install-doctor-engine.mjs) source="$MOCK_ENGINE" ;;
  https://app.install.doctor/releases/test/catalog.json) source="$MOCK_CATALOG" ;;
  https://app.install.doctor/releases/test/node-macos-x64.tar.gz) source="$MOCK_RUNTIME_MACOS_X64" ;;
  https://app.install.doctor/releases/test/node-macos-arm64.tar.gz) source="$MOCK_RUNTIME_MACOS_ARM64" ;;
  https://app.install.doctor/releases/test/node-linux-x64.tar.gz) source="$MOCK_RUNTIME_LINUX_X64" ;;
  https://app.install.doctor/releases/test/node-linux-arm64.tar.gz) source="$MOCK_RUNTIME_LINUX_ARM64" ;;
  *) exit 65 ;;
esac
/bin/cp "$source" "$destination"
`,
    { mode: 0o700 }
  );

  const unameMock = path.join(mockBin, 'uname');
  fs.writeFileSync(
    unameMock,
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  -s) printf '%s\\n' "\${MOCK_UNAME_S:-$(/usr/bin/uname -s)}" ;;
  -m) printf '%s\\n' "\${MOCK_UNAME_M:-$(/usr/bin/uname -m)}" ;;
  *) exit 64 ;;
esac
`,
    { mode: 0o700 }
  );

  const config = {
    manifestUrl: TEST_ENV.INSTALL_DOCTOR_MANIFEST_URL,
    signatureUrl: TEST_ENV.INSTALL_DOCTOR_MANIFEST_SIGNATURE_URL,
    signerIdentity: 'install-doctor-test',
    signerPublicKey: publicKey,
  };

  const createRelease = ({
    keyId = config.signerIdentity,
    releaseId = 'test',
    artifactUrl = 'https://app.install.doctor/releases/test/provision.sh',
    catalogUrl = 'https://app.install.doctor/releases/test/catalog.json',
    createdAt = Math.floor(Date.now() / 1000) - 60,
    expiresAt = Math.floor(Date.now() / 1000) + 600,
    artifactBody,
    engineBody = '#!/usr/bin/env node\nprocess.exit(0)\n',
    catalogBody = '[{"name":"fixture"}]\n',
  } = {}) => {
    const artifact = path.join(downloadRoot, `provision-${crypto.randomUUID()}.sh`);
    const manifest = path.join(downloadRoot, `manifest-${crypto.randomUUID()}`);
    const engine = path.join(downloadRoot, `engine-${crypto.randomUUID()}.mjs`);
    const catalog = path.join(downloadRoot, `catalog-${crypto.randomUUID()}.json`);
    const launcher = path.join(downloadRoot, `start-${crypto.randomUUID()}`);
    const runtimes = Object.fromEntries(['macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64'].map((platform) => {
      const runtime = path.join(downloadRoot, `node-${platform}-${crypto.randomUUID()}.tar.gz`);
      fs.writeFileSync(runtime, `fixture Node 24.11.0 runtime for ${platform}\n`, { mode: 0o600 });
      return [platform, runtime];
    }));
    const body = artifactBody ?? '#!/usr/bin/env bash\nset -euo pipefail\n';
    fs.writeFileSync(artifact, body, { mode: 0o700 });
    fs.writeFileSync(engine, engineBody, { mode: 0o700 });
    fs.writeFileSync(catalog, catalogBody, { mode: 0o600 });
    const launcherBody = '#!/usr/bin/env bash\nexit 0\n';
    fs.writeFileSync(launcher, launcherBody, { mode: 0o700 });
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const engineDigest = crypto.createHash('sha256').update(engineBody).digest('hex');
    const catalogDigest = crypto.createHash('sha256').update(catalogBody).digest('hex');
    const manifestBody = [
      'schema_version=5',
      `release_id=${releaseId}`,
      `source_commit=${'a'.repeat(40)}`,
      `created_at=${createdAt}`,
      `expires_at=${expiresAt}`,
      `key_id=${keyId}`,
      `artifact_url=${artifactUrl}`,
      `artifact_sha256=${digest}`,
      `artifact_size=${Buffer.byteLength(body)}`,
      'engine_url=https://app.install.doctor/releases/test/install-doctor-engine.mjs',
      `engine_sha256=${engineDigest}`,
      `engine_size=${Buffer.byteLength(engineBody)}`,
      `catalog_url=${catalogUrl}`,
      `catalog_sha256=${catalogDigest}`,
      `catalog_size=${Buffer.byteLength(catalogBody)}`,
      `launcher_url=https://app.install.doctor/releases/${releaseId}/start`,
      `launcher_sha256=${crypto.createHash('sha256').update(launcherBody).digest('hex')}`,
      `launcher_size=${Buffer.byteLength(launcherBody)}`,
      'engine_node_min=22',
      'runtime_node_version=24.11.0',
      ...['macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64'].flatMap((platform) => {
        const key = platform.replaceAll('-', '_');
        const runtime = runtimes[platform];
        const runtimeBody = fs.readFileSync(runtime);
        return [
          `runtime_${key}_url=https://app.install.doctor/releases/test/node-${platform}.tar.gz`,
          `runtime_${key}_sha256=${crypto.createHash('sha256').update(runtimeBody).digest('hex')}`,
          `runtime_${key}_size=${runtimeBody.byteLength}`,
        ];
      }),
      '',
    ].join('\n');
    fs.writeFileSync(manifest, manifestBody);
    execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-f', privateKey, '-n', 'install.doctor.release', manifest]);
    return { artifact, engine, catalog, launcher, runtimes, manifest, signature: `${manifest}.sig` };
  };

  const run = (script, release, extraEnv = {}) =>
    spawnSync('bash', [], {
      input: script,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH ?? ''}`,
        TMPDIR: stageRoot,
        HEADLESS_INSTALL: '1',
        MOCK_MANIFEST: release.manifest,
        MOCK_SIGNATURE: release.signature,
        MOCK_ARTIFACT: release.artifact,
        MOCK_ENGINE: release.engine,
        MOCK_CATALOG: release.catalog,
        MOCK_RUNTIME_MACOS_X64: release.runtimes['macos-x64'],
        MOCK_RUNTIME_MACOS_ARM64: release.runtimes['macos-arm64'],
        MOCK_RUNTIME_LINUX_X64: release.runtimes['linux-x64'],
        MOCK_RUNTIME_LINUX_ARM64: release.runtimes['linux-arm64'],
        ...extraEnv,
      },
    });

  const assertStageClean = () => assert.deepEqual(fs.readdirSync(stageRoot), [], 'private stage is removed');
  return { config, createRelease, run, assertStageClean, mockBin };
}

test('public product status is generated from evidence-backed Desktop Tools truth', async () => {
  const app = await loadWorkerApp();
  const response = await app.fetch(
    new Request('https://app.install.doctor/api/v1/product-status'),
    TEST_ENV
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.product, 'Desktop Tools');
  assert.equal(
    body.capabilities.find(item => item.id === 'device-authorization').status,
    'contract-only'
  );
  assert.equal(
    body.migrations.find(item => item.legacy === 'app.install.doctor').canonical,
    'desktop.tools'
  );
  assert.equal(JSON.stringify(body).includes('verified-live'), false);
});

test('Desktop Tools wildcard profile routing is isolated and enrollment remains fail-closed', async () => {
  const app = await loadWorkerApp();
  const response = await app.fetch(new Request('https://example.desktop.tools/'), TEST_ENV);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '3600');
  assert.deepEqual(await response.json(), {
    error: 'profile_bootstrap_unavailable',
    profile: 'example',
    message: 'This Desktop Tools profile is not accepting bootstrap requests yet.'
  });

  const apex = await app.fetch(new Request('https://desktop.tools/health'), TEST_ENV);
  assert.equal(apex.status, 200);
  const reserved = await app.fetch(new Request('https://api.desktop.tools/health'), TEST_ENV);
  assert.equal(reserved.status, 200);
  const nested = await app.fetch(new Request('https://nested.example.desktop.tools/'), TEST_ENV);
  assert.equal(nested.status, 400);
});

test('public profile descriptor is bounded, cache-controlled, and contains no authority', async () => {
  const app = await loadWorkerApp();
  const profile = {
    id: 'profile-example', tenantId: 'tenant-private', slug: 'example', revision: 'revision-7',
    digest: 'c'.repeat(64), visibility: 'public-bootstrap', enabled: true
  };
  const response = await app.fetch(
    new Request('https://example.desktop.tools/.well-known/desktop-tools-profile.json'),
    { ...TEST_ENV, DESKTOP_TOOLS_PUBLIC_PROFILES: [profile] }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60, s-maxage=300, stale-if-error=60');
  assert.equal(response.headers.get('etag'), `\"${profile.digest}\"`);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), {
    schemaVersion: 1,
    profile: { id: profile.id, slug: profile.slug, revision: profile.revision, digest: profile.digest }
  });
  for (const forbidden of ['tenant-private', 'credential', 'secret', 'token', 'permission', 'enrollment']) {
    assert.equal(text.toLowerCase().includes(forbidden), false);
  }

  for (const unavailable of [
    [],
    [{ ...profile, enabled: false }],
    [{ ...profile, visibility: 'private' }]
  ]) {
    const denied = await app.fetch(
      new Request('https://example.desktop.tools/.well-known/desktop-tools-profile.json'),
      { ...TEST_ENV, DESKTOP_TOOLS_PUBLIC_PROFILES: unavailable }
    );
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: 'profile_unavailable' });
  }
});

test('Control Plane Phase 1: PIA endpoints (/api/v1/intent/* and /api/v1/easter-eggs/oracle)', async () => {
  const app = await loadWorkerApp();

  // 1. POST /api/v1/intent/telemetry
  const telRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/intent/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        terminalBuffer: 'chezmoi apply',
        interArrivalsMs: [80, 95, 110, 90, 85],
        machineRole: 'workstation',
        recentCommands: ['chezmoi diff', 'git status'],
      }),
    }),
    TEST_ENV
  );
  assert.equal(telRes.status, 200);
  assert.ok(telRes.headers.get('x-intent-entropy'));
  assert.equal(telRes.headers.get('x-predicted-intent'), 'SYNC_CHEZMOI');
  const telJson = await telRes.json();
  assert.equal(telJson.primaryIntent, 'SYNC_CHEZMOI');
  assert.ok(telJson.confidence > 0.4);

  // 2. POST /api/v1/intent/speculate
  const specRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/intent/speculate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'tenant-alpha',
        machineId: 'ubuntu-megabyte-space',
        intent: 'SYNC_CHEZMOI',
        entropy: 0.75,
      }),
    }),
    TEST_ENV
  );
  assert.equal(specRes.status, 200);
  const branch = await specRes.json();
  assert.ok(branch.branchId.startsWith('spec_'));
  assert.equal(branch.intent, 'SYNC_CHEZMOI');

  // 3. POST /api/v1/intent/collapse
  const colRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/intent/collapse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        branch,
        voucher: {
          branchId: branch.branchId,
          intent: 'SYNC_CHEZMOI',
          actionDigest: 'sha256-verified',
          clientTimestamp: new Date().toISOString(),
        },
      }),
    }),
    TEST_ENV
  );
  assert.equal(colRes.status, 200);
  const collapsed = await colRes.json();
  assert.equal(collapsed.status, 'collapsed');
  assert.equal(collapsed.perceivedLatencyMicros, 0);
  assert.ok(collapsed.auditSignature.startsWith('ed25519_sig_'));

  // 4. POST /api/v1/easter-eggs/oracle (SECRET_CODE + HARMONIC_FIBONACCI + ASTRAL_404)
  const eggRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/easter-eggs/oracle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'SECRET_CODE',
        payload: 'xyzzy',
      }),
    }),
    TEST_ENV
  );
  assert.equal(eggRes.status, 200);
  assert.equal(eggRes.headers.get('x-easter-egg-unlocked'), 'xyzzy-1989');
  const eggJson = await eggRes.json();
  assert.equal(eggJson.unlocked, true);
  assert.equal(eggJson.codeName, 'COLOSSAL_CAVE_PORTAL');

  const fibRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/easter-eggs/oracle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'HARMONIC_FIBONACCI',
        intervalsMs: [10, 10, 20, 30, 50, 80],
      }),
    }),
    TEST_ENV
  );
  assert.equal(fibRes.status, 200);
  const fibJson = await fibRes.json();
  assert.equal(fibJson.unlocked, true);
  assert.equal(fibJson.codeName, 'FIBONACCI_HARMONIC_RESONANCE');

  const astralRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/easter-eggs/oracle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'ASTRAL_404',
      }),
    }),
    TEST_ENV
  );
  assert.equal(astralRes.status, 200);
  const astralJson = await astralRes.json();
  assert.equal(astralJson.unlocked, true);
  assert.equal(astralJson.codeName, 'ASTRAL_PLANE_DUNGEON');
});

test('Control Plane Phase 1: OpenAPI 3.1 schema (/api/v1/openapi.json) covers 100% of /api/v1/* routes and interactive docs (/api/v1/docs)', async () => {
  const app = await loadWorkerApp();

  const oaRes = await app.fetch(new Request('https://app.install.doctor/api/v1/openapi.json'), TEST_ENV);
  assert.equal(oaRes.status, 200);
  const spec = await oaRes.json();
  assert.equal(spec.openapi, '3.1.0');
  assert.ok(spec.components?.securitySchemes?.bearerAdmin);
  assert.ok(spec.components?.securitySchemes?.bearerDevice);

  // Extract all /api/v1/* routes from src/index.ts and verify 100% coverage in OpenAPI 3.1 spec
  const srcIndex = fs.readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf8');
  const v1RouteRegex = /app\.(get|post|put|delete)\(\s*['"](\/api\/v1\/[^'"]+)['"]/g;
  let match;
  const discoveredV1Routes = [];
  while ((match = v1RouteRegex.exec(srcIndex)) !== null) {
    const [, method, routePath] = match;
    discoveredV1Routes.push({ method, routePath });
    assert.ok(spec.paths[routePath], `OpenAPI 3.1 spec must document path ${routePath}`);
    assert.ok(spec.paths[routePath][method], `OpenAPI 3.1 spec must document ${method.toUpperCase()} ${routePath}`);
  }
  assert.ok(discoveredV1Routes.length >= 9, 'Must discover all /api/v1/* routes');
  assert.ok(spec.paths['/start']);

  const docRes = await app.fetch(new Request('https://app.install.doctor/api/v1/docs'), TEST_ENV);
  assert.equal(docRes.status, 200);
  const html = await docRes.text();
  assert.ok(html.includes('OpenAPI 3.1'));
  assert.ok(!html.includes('.innerHTML'));
  assert.ok(docRes.headers.get('content-security-policy')?.includes("require-trusted-types-for 'script'"));
});

test('Control Plane Phase 1: GitHub discovery, truthful unsupported mutations & Universal /start', async () => {
  const app = await loadWorkerApp();

  // Scan repos
  const scanRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/github/repos/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: 'heymegabyte', namespace: 'megabyte.space', detectedHostname: 'ubuntu' }),
    }),
    TEST_ENV
  );
  assert.equal(scanRes.status, 200);
  const scanJson = await scanRes.json();
  assert.equal(scanJson.defaultMasterRepo, 'heymegabyte/install.doctor');
  assert.equal(scanJson.suggestedHostRepo, 'ubuntu.megabyte.space');

  // Host-repo ensure is not provider-backed yet. It must never claim a repository exists.
  const ensRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/github/host-repo/ensure', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_ENV.AID_ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ owner: 'heymegabyte', hostname: 'ubuntu', namespace: 'megabyte.space' }),
    }),
    TEST_ENV
  );
  assert.equal(ensRes.status, 501);
  const ensJson = await ensRes.json();
  assert.equal(ensJson.error, 'github_reconciliation_not_configured');
  assert.equal(ensJson.status, 'unsupported');
  assert.equal(ensJson.repoFullName, 'heymegabyte/ubuntu.megabyte.space');

  // Ensure host repo fallback when namespace is absent
  const ensFallbackRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/github/host-repo/ensure', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_ENV.AID_ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ owner: 'heymegabyte', hostname: 'ephemeral-node' }),
    }),
    TEST_ENV
  );
  assert.equal(ensFallbackRes.status, 501);
  const ensFallback = await ensFallbackRes.json();
  assert.equal(ensFallback.fqdn, 'ephemeral-node');
  assert.equal(ensFallback.repoFullName, 'heymegabyte/ephemeral-node');

  // API-key persistence is not implemented. Authentication is required, then the route is truthful.
  const mintUnauth = await app.fetch(
    new Request('https://app.install.doctor/api/v1/keys/mint', { method: 'POST' }),
    TEST_ENV
  );
  assert.equal(mintUnauth.status, 401);

  const mintAuth = await app.fetch(
    new Request('https://app.install.doctor/api/v1/keys/mint', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_ENV.AID_ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tenant: '_default', label: 'ci-runner-key', namespace: 'megabyte.space' }),
    }),
    TEST_ENV
  );
  assert.equal(mintAuth.status, 501);
  const mintJson = await mintAuth.json();
  assert.equal(mintJson.error, 'api_key_provisioning_not_configured');
  assert.equal(mintJson.status, 'unsupported');
  assert.equal('apiKey' in mintJson, false);

  // GET /start universal bootstrap
  const startRes = await app.fetch(new Request('https://app.install.doctor/start'), TEST_ENV);
  assert.equal(startRes.status, 503);
  assert.equal((await startRes.json()).error, 'release_channel_unavailable');
});

test('Control Plane /start fails closed when the activated release channel is not configured', async () => {
  const app = await loadWorkerApp();
  const response = await app.fetch(new Request('https://app.install.doctor/start'), {
    ...TEST_ENV,
    RELEASES: undefined,
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'release_channel_unavailable');
  const injectedKey = await app.fetch(new Request('https://app.install.doctor/start'), {
    ...TEST_ENV,
    INSTALL_DOCTOR_RELEASE_SIGNER_KEY: 'ssh-ed25519 attacker-controlled-key',
  });
  assert.equal(injectedKey.status, 503, 'deployment bindings cannot inject a release trust anchor');
  assert.equal((await injectedKey.json()).error, 'release_channel_unavailable');
});

test('Control Plane /start resolves only a digest-bound CAS channel before consulting pinned trust', async () => {
  const app = await loadWorkerApp();
  const now = Math.floor(Date.now() / 1000);
  const manifest = new TextEncoder().encode([
    'schema_version=5', 'release_id=release-1', `source_commit=${'a'.repeat(40)}`,
    `created_at=${now - 60}`, `expires_at=${now + 86_400}`, 'key_id=not-source-pinned', '',
  ].join('\n'));
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', manifest)).toString('hex');
  const pointer = new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    channel: 'stable',
    generation: 1,
    kind: 'promote',
    releaseId: 'release-1',
    signerId: 'not-source-pinned',
    manifestSha256: digest,
    activatedAt: '2026-11-06T12:00:00.000Z',
    activationId: '8dc2b35c-58d6-4de8-8237-d93833f66075',
    previous: null,
    rollbackOfActivationId: null,
  }));
  const requested = [];
  const RELEASE_CHANNELS = { async get(key) {
    requested.push(key);
    const bytes = key === 'bootstrap/channels/stable.json' ? pointer : null;
    return bytes ? { body: new Blob([bytes]).stream(), size: bytes.byteLength } : null;
  } };
  const RELEASES = { async get(key) {
    requested.push(key);
    const bytes = key === 'bootstrap/release-1/manifest' ? manifest : null;
    return bytes ? { body: new Blob([bytes]).stream(), size: bytes.byteLength } : null;
  } };
  const response = await app.fetch(new Request('https://app.install.doctor/start'), { ...TEST_ENV, RELEASES, RELEASE_CHANNELS });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'release_trust_not_configured');
  assert.deepEqual(requested, ['bootstrap/channels/stable.json', 'bootstrap/release-1/manifest']);

  const tampered = await app.fetch(new Request('https://app.install.doctor/start'), {
    ...TEST_ENV,
    RELEASE_CHANNELS,
    RELEASES: { async get(key) {
      const bytes = key === 'bootstrap/release-1/manifest' ? new TextEncoder().encode('tampered') : null;
      return bytes ? { body: new Blob([bytes]).stream(), size: bytes.byteLength } : null;
    } },
  });
  assert.equal(tampered.status, 503);
  assert.equal((await tampered.json()).error, 'release_channel_unavailable');

  const expiredManifest = new TextEncoder().encode([
    'schema_version=5', 'release_id=release-1', `source_commit=${'a'.repeat(40)}`,
    `created_at=${now - 86_400}`, `expires_at=${now - 1}`, 'key_id=not-source-pinned', '',
  ].join('\n'));
  const expiredDigest = Buffer.from(await crypto.subtle.digest('SHA-256', expiredManifest)).toString('hex');
  const expiredPointer = new TextEncoder().encode(JSON.stringify({
    ...JSON.parse(new TextDecoder().decode(pointer)), manifestSha256: expiredDigest,
  }));
  const expired = await app.fetch(new Request('https://app.install.doctor/start'), {
    ...TEST_ENV,
    RELEASE_CHANNELS: { async get() { return { body: new Blob([expiredPointer]).stream(), size: expiredPointer.byteLength }; } },
    RELEASES: { async get() { return { body: new Blob([expiredManifest]).stream(), size: expiredManifest.byteLength }; } },
  });
  assert.equal(expired.status, 503);
  assert.equal((await expired.json()).error, 'release_channel_unavailable');
});

test('Control Plane landing page advertises only the canonical signed bootstrap command', async () => {
  const app = await loadWorkerApp();
  const response = await app.fetch(new Request('https://app.install.doctor/'), TEST_ENV);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('curl -fsSL https://app.install.doctor/start | bash'));
  assert.equal(html.includes('&lt;(curl'), false);
  assert.equal(html.includes('https://install.doctor/start'), false);
});

test('Control Plane serves immutable release bytes from the exact release object key', async () => {
  const app = await loadWorkerApp();
  const requestedKeys = [];
  const bodies = new Map([
    ['bootstrap/2026.11.05-a1/manifest', new Uint8Array([0, 10, 13, 255, 65])],
    ['bootstrap/2026.11.05-a1/manifest.sig', new Uint8Array([83, 83, 72, 83, 73, 71])],
    ['bootstrap/2026.11.05-a1/provision.sh', new TextEncoder().encode('#!/bin/sh\nexit 0\n')],
    ['bootstrap/2026.11.05-a1/install-doctor-engine.mjs', new TextEncoder().encode('#!/usr/bin/env node\n')],
    ['bootstrap/2026.11.05-a1/catalog.json', new TextEncoder().encode('[]\n')],
    ['bootstrap/2026.11.05-a1/start', new TextEncoder().encode('#!/usr/bin/env bash\nexit 0\n')],
    ...['macos-x64', 'macos-arm64', 'linux-x64', 'linux-arm64'].map((platform) => [
      `bootstrap/2026.11.05-a1/node-${platform}.tar.gz`, new TextEncoder().encode(`runtime-${platform}`),
    ]),
  ]);
  const RELEASES = {
    async get(key) {
      requestedKeys.push(key);
      const body = bodies.get(key);
      return body ? { body: new Blob([body]).stream(), size: body.byteLength } : null;
    },
  };

  for (const [file, expectedContentType] of [
    ['manifest', 'application/vnd.install-doctor.release-manifest'],
    ['manifest.sig', 'application/octet-stream'],
    ['provision.sh', 'text/x-shellscript; charset=utf-8'],
    ['install-doctor-engine.mjs', 'text/javascript; charset=utf-8'],
    ['catalog.json', 'application/json; charset=utf-8'],
    ['start', 'text/x-shellscript; charset=utf-8'],
    ['node-macos-x64.tar.gz', 'application/gzip'],
    ['node-macos-arm64.tar.gz', 'application/gzip'],
    ['node-linux-x64.tar.gz', 'application/gzip'],
    ['node-linux-arm64.tar.gz', 'application/gzip'],
  ]) {
    const response = await app.fetch(
      new Request(`https://app.install.doctor/releases/2026.11.05-a1/${file}`),
      { ...TEST_ENV, RELEASES },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), expectedContentType);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable, no-transform');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bodies.get(`bootstrap/2026.11.05-a1/${file}`));
  }
  assert.deepEqual(requestedKeys, [
    'bootstrap/2026.11.05-a1/manifest',
    'bootstrap/2026.11.05-a1/manifest.sig',
    'bootstrap/2026.11.05-a1/provision.sh',
    'bootstrap/2026.11.05-a1/install-doctor-engine.mjs',
    'bootstrap/2026.11.05-a1/catalog.json',
    'bootstrap/2026.11.05-a1/start',
    'bootstrap/2026.11.05-a1/node-macos-x64.tar.gz',
    'bootstrap/2026.11.05-a1/node-macos-arm64.tar.gz',
    'bootstrap/2026.11.05-a1/node-linux-x64.tar.gz',
    'bootstrap/2026.11.05-a1/node-linux-arm64.tar.gz',
  ]);
});

test('Control Plane release serving fails closed for unavailable storage, missing objects, and invalid paths', async () => {
  const app = await loadWorkerApp();
  const withoutBinding = await app.fetch(
    new Request('https://app.install.doctor/releases/release-1/manifest'),
    TEST_ENV,
  );
  assert.equal(withoutBinding.status, 503);
  assert.equal((await withoutBinding.json()).error, 'release_storage_not_configured');

  const requestedKeys = [];
  const RELEASES = { async get(key) { requestedKeys.push(key); return null; } };
  const missing = await app.fetch(
    new Request('https://app.install.doctor/releases/release-1/manifest'),
    { ...TEST_ENV, RELEASES },
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'release_not_found');
  assert.deepEqual(requestedKeys, ['bootstrap/release-1/manifest']);

  for (const pathname of [
    '/releases/UPPERCASE/manifest',
    '/releases/-leading-hyphen/manifest',
    `/releases/${'a'.repeat(129)}/manifest`,
    '/releases/release-1/latest',
    '/releases/release-1/manifest/extra',
    '/releases/release%2Fescape/manifest',
  ]) {
    const response = await app.fetch(new Request(`https://app.install.doctor${pathname}`), { ...TEST_ENV, RELEASES });
    assert.equal(response.status, 404, pathname);
  }
  assert.deepEqual(requestedKeys, ['bootstrap/release-1/manifest'], 'invalid paths never reach object storage');
});

test('Rendered /start executes only an authentic, current release and scrubs its child environment', async (t) => {
  const fixture = makeBootstrapRuntimeFixture(t);
  const { renderBootstrap } = await import('../src/bootstrap.ts');
  const startScript = renderBootstrap(fixture.config);
  assert.ok(startScript.includes('ssh-keygen -Y verify'));
  assert.ok(startScript.includes('install.doctor.release'));
  assert.ok(startScript.includes('env -i'));
  assert.ok(startScript.includes('MAX_RELEASE_LIFETIME=604800'));
  assert.ok(startScript.includes('fetching verified release payloads in parallel'));
  assert.ok(startScript.includes('DOWNLOAD_PIDS+=("$!")'));
  assert.ok(startScript.includes("readonly APPROVED_PATH='/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'"));
  assert.ok(startScript.includes('PATH="$APPROVED_PATH"'));
  assert.ok(!startScript.includes('START_REF'));
  assert.doesNotThrow(() => execFileSync('bash', ['-n'], { input: startScript }));
  assert.throws(() => renderBootstrap({
    ...fixture.config,
    manifestUrl: `${fixture.config.manifestUrl}?mutable=1`,
  }));

  const childEnvironment = path.join(os.tmpdir(), `install-doctor-child-env-${crypto.randomUUID()}`);
  const curlLog = path.join(os.tmpdir(), `install-doctor-curl-log-${crypto.randomUUID()}`);
  t.after(() => fs.rmSync(childEnvironment, { force: true }));
  t.after(() => fs.rmSync(curlLog, { force: true }));
  const valid = fixture.createRelease({
    artifactBody: `#!/usr/bin/env bash
set -euo pipefail
env | sort > ${shellLiteral(childEnvironment)}
[ -f "$INSTALL_DOCTOR_CATALOG_PATH" ] && [ ! -L "$INSTALL_DOCTOR_CATALOG_PATH" ]
catalog_mode="$(stat -c '%a' "$INSTALL_DOCTOR_CATALOG_PATH" 2>/dev/null || stat -f '%Lp' "$INSTALL_DOCTOR_CATALOG_PATH")"
printf 'VERIFIED_CATALOG_MODE=%s\nVERIFIED_CATALOG_BODY=%s\n' "$catalog_mode" "$(cat "$INSTALL_DOCTOR_CATALOG_PATH")" >> ${shellLiteral(childEnvironment)}
`,
  });
  const success = fixture.run(startScript, valid, {
    AID_API_KEY: 'must-not-reach-the-provisioner',
    HTTPS_PROXY: 'http://must-not-reach-the-provisioner.invalid',
    NODE_OPTIONS: '--trace-warnings',
    DEBUG: 'install-doctor:*',
    INSTALL_DOCTOR_SELECTED_PACKAGES: 'docker-pushrm,sysz',
    INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS: 'developer',
    INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS: 'chezmoi,installx',
    MOCK_CURL_LOG: curlLog,
  });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.signal, null);
  const childEnv = fs.readFileSync(childEnvironment, 'utf8');
  assert.match(childEnv, /^INSTALL_DOCTOR_RELEASE_ID=test$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_BOOTSTRAP_PLATFORM=(?:macos|linux)-(?:x64|arm64)$/m);
  assert.match(childEnv, new RegExp(`^INSTALL_DOCTOR_SOURCE_COMMIT=${'a'.repeat(40)}$`, 'm'));
  assert.match(childEnv, /^INSTALL_DOCTOR_ENGINE_PATH=.*install-doctor-engine\.mjs$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_ENGINE_SHA256=[a-f0-9]{64}$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_CATALOG_PATH=\/.*\/catalog\.json$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_CATALOG_SHA256=[a-f0-9]{64}$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_SELECTED_PACKAGES=docker-pushrm,sysz$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_SELECTED_SUPPORTED_PATHS=developer$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_LAZY_RESOLVER_REQUIREMENTS=chezmoi,installx$/m);
  assert.match(childEnv, /^VERIFIED_CATALOG_MODE=600$/m);
  assert.match(childEnv, /^VERIFIED_CATALOG_BODY=\[{"name":"fixture"}\]$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_SOURCE=(?:system|signed-archive)$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_NODE_VERSION=(?:22|24)\.[0-9]+\.[0-9]+$/m);
  assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_PLATFORM=(?:macos|linux)-(?:x64|arm64)$/m);
  const runtimeSource = childEnv.match(/^INSTALL_DOCTOR_RUNTIME_SOURCE=(.+)$/m)?.[1];
  const requestedUrls = fs.readFileSync(curlLog, 'utf8').trim().split('\n');
  if (runtimeSource === 'system') {
    assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_NODE=\/(?:opt|home|usr|bin)\//m);
    assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_SHA256=$/m);
    assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_SIZE=$/m);
    assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_ARCHIVE=$/m);
    assert.equal(requestedUrls.some(url => /\/node-(?:macos|linux)-/.test(url)), false, 'compatible system Node avoids the runtime download');
  } else {
    assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_NODE=$/m);
    assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_SHA256=[a-f0-9]{64}$/m);
    assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_SIZE=[1-9][0-9]*$/m);
    assert.match(childEnv, /^INSTALL_DOCTOR_RUNTIME_ARCHIVE=.*node-runtime\.tar\.gz$/m);
    assert.equal(requestedUrls.filter(url => /\/node-(?:macos|linux)-/.test(url)).length, 1, 'only the selected runtime is downloaded');
  }
  assert.doesNotMatch(childEnv, /^(AID_API_KEY|HTTPS_PROXY|NODE_OPTIONS|DEBUG)=/m);
  fixture.assertStageClean();

  const tamperedCatalog = fixture.createRelease();
  fs.appendFileSync(tamperedCatalog.catalog, 'tampered');
  const catalogFailure = fixture.run(startScript, tamperedCatalog);
  assert.notEqual(catalogFailure.status, 0);
  assert.match(catalogFailure.stderr, /(?:download exceeded its declared size limit|catalog (?:size|checksum) does not match the signed manifest)/);
  fixture.assertStageClean();

  const escapedCatalog = fixture.createRelease({
    catalogUrl: 'https://app.install.doctor/releases/test/../other/catalog.json',
  });
  const catalogUrlFailure = fixture.run(startScript, escapedCatalog);
  assert.notEqual(catalogUrlFailure.status, 0);
  assert.match(catalogUrlFailure.stderr, /release catalog URL does not match/);
  fixture.assertStageClean();

  const tamperedEngine = fixture.createRelease();
  const tamperedEngineBytes = fs.readFileSync(tamperedEngine.engine);
  tamperedEngineBytes[0] ^= 1;
  fs.writeFileSync(tamperedEngine.engine, tamperedEngineBytes);
  const engineFailure = fixture.run(startScript, tamperedEngine);
  assert.notEqual(engineFailure.status, 0);
  assert.match(engineFailure.stderr, /engine checksum does not match the signed manifest/);
  fixture.assertStageClean();

  const tamperedRuntime = fixture.createRelease();
  const selectedRuntimePlatform = `${process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}`;
  fs.appendFileSync(tamperedRuntime.runtimes[selectedRuntimePlatform], 'tampered');
  const runtimeFailure = fixture.run(startScript, tamperedRuntime);
  if (runtimeSource === 'system') {
    assert.equal(runtimeFailure.status, 0, runtimeFailure.stderr);
  } else {
    assert.notEqual(runtimeFailure.status, 0);
    assert.match(runtimeFailure.stderr, /(?:download exceeded its declared size limit|runtime (?:size|checksum) does not match the signed manifest)/);
  }
  fixture.assertStageClean();

  const tamperedArtifact = fixture.createRelease();
  const tamperedBytes = fs.readFileSync(tamperedArtifact.artifact);
  tamperedBytes[0] ^= 1;
  fs.writeFileSync(tamperedArtifact.artifact, tamperedBytes);
  const artifactFailure = fixture.run(startScript, tamperedArtifact);
  assert.notEqual(artifactFailure.status, 0);
  assert.match(artifactFailure.stderr, /provisioner checksum does not match the signed manifest/);
  fixture.assertStageClean();

  const tamperedManifest = fixture.createRelease();
  fs.appendFileSync(tamperedManifest.manifest, 'release_id=attacker-release\n');
  const manifestFailure = fixture.run(startScript, tamperedManifest);
  assert.notEqual(manifestFailure.status, 0);
  assert.match(manifestFailure.stderr, /release manifest signature verification failed/);
  fixture.assertStageClean();

  const unknownSigner = fixture.createRelease({ keyId: 'untrusted-release-signer' });
  const signerFailure = fixture.run(startScript, unknownSigner);
  assert.notEqual(signerFailure.status, 0);
  assert.match(signerFailure.stderr, /release manifest uses an unknown signing identity/);
  fixture.assertStageClean();

  const mismatchedRelease = fixture.createRelease({ releaseId: 'other-release' });
  const releaseFailure = fixture.run(startScript, mismatchedRelease);
  assert.notEqual(releaseFailure.status, 0);
  assert.match(releaseFailure.stderr, /release manifest identity does not match/);
  fixture.assertStageClean();

  const escapedArtifact = fixture.createRelease({
    artifactUrl: 'https://app.install.doctor/releases/../api/v1/openapi.json',
  });
  const artifactUrlFailure = fixture.run(startScript, escapedArtifact);
  assert.notEqual(artifactUrlFailure.status, 0);
  assert.match(artifactUrlFailure.stderr, /release artifact URL does not match/);
  fixture.assertStageClean();

  const expired = fixture.createRelease({
    createdAt: Math.floor(Date.now() / 1000) - 120,
    expiresAt: Math.floor(Date.now() / 1000) - 60,
  });
  const expiryFailure = fixture.run(startScript, expired);
  assert.notEqual(expiryFailure.status, 0);
  assert.match(expiryFailure.stderr, /release manifest expired/);
  fixture.assertStageClean();

  const overlong = fixture.createRelease({
    createdAt: Math.floor(Date.now() / 1000) - 60,
    expiresAt: Math.floor(Date.now() / 1000) + 604800,
  });
  const overlongFailure = fixture.run(startScript, overlong);
  assert.notEqual(overlongFailure.status, 0);
  assert.match(overlongFailure.stderr, /lifetime exceeds the seven-day replay policy/);
  fixture.assertStageClean();

  const sshKeygenMock = path.join(fixture.mockBin, 'ssh-keygen');
  fs.writeFileSync(sshKeygenMock, '#!/bin/sh\nprintf "SSHSIG unavailable\\n" >&2\nexit 1\n', { mode: 0o700 });
  const verifierFailure = fixture.run(startScript, valid);
  assert.notEqual(verifierFailure.status, 0);
  assert.match(verifierFailure.stderr, /this ssh-keygen lacks SSHSIG support/);
  fixture.assertStageClean();
});

test('Desktop Tools release policy is source-owned while legacy release verification remains available', async () => {
  const { renderBootstrap, parseBootstrapReleaseConfig } = await import('../src/bootstrap.ts');
  const { releaseObjectUrl, releasePolicy } = await import('../src/release-policy.ts');
  const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const desktopConfig = {
    product: 'desktop-tools',
    manifestUrl: 'https://desktop.tools/releases/release-1/manifest',
    signatureUrl: 'https://desktop.tools/releases/release-1/manifest.sig',
    signerIdentity: 'desktop-tools-production-1',
    signerPublicKey: key
  };
  const script = renderBootstrap(desktopConfig);
  assert.match(script, /readonly RELEASE_ORIGIN='https:\/\/desktop\.tools'/);
  assert.match(script, /readonly SIGNATURE_NAMESPACE='desktop\.tools\.release'/);
  assert.match(script, /desktop-tools\.engine|desktop-tools-engine\.mjs/);
  assert.match(script, /desktop-tools\.XXXXXXXX/);
  assert.doesNotThrow(() => execFileSync('bash', ['-n'], { input: script }));
  assert.equal(releaseObjectUrl('desktop-tools', 'release-1', 'desktop-tools-engine.mjs'),
    'https://desktop.tools/releases/release-1/desktop-tools-engine.mjs');
  assert.equal(releasePolicy('legacy-install-doctor').signatureNamespace, 'install.doctor.release');
  assert.doesNotThrow(() => parseBootstrapReleaseConfig({
    manifestUrl: 'https://app.install.doctor/releases/legacy-1/manifest',
    signatureUrl: 'https://app.install.doctor/releases/legacy-1/manifest.sig',
    signerIdentity: 'legacy-production-1', signerPublicKey: key
  }));
  assert.throws(() => parseBootstrapReleaseConfig({
    ...desktopConfig,
    manifestUrl: 'https://app.install.doctor/releases/release-1/manifest'
  }));
  assert.throws(() => releaseObjectUrl('desktop-tools', 'release-1', 'install-doctor-engine.mjs'));
});

test('Rendered /start gates the kernel and architecture before any release download', async (t) => {
  const fixture = makeBootstrapRuntimeFixture(t);
  const { renderBootstrap } = await import('../src/bootstrap.ts');
  const startScript = renderBootstrap(fixture.config);
  const release = fixture.createRelease({
    artifactBody: '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" "$INSTALL_DOCTOR_BOOTSTRAP_PLATFORM"\n',
  });

  for (const [kernel, machine, expected] of [
    ['Darwin', 'x86_64', 'macos-x64'],
    ['Darwin', 'arm64', 'macos-arm64'],
    ['Linux', 'x86_64', 'linux-x64'],
    ['Linux', 'aarch64', 'linux-arm64'],
    ['Linux', 'arm64', 'linux-arm64'],
  ]) {
    const result = fixture.run(startScript, release, { MOCK_UNAME_S: kernel, MOCK_UNAME_M: machine });
    assert.equal(result.status, 0, `${kernel}/${machine}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), expected);
    fixture.assertStageClean();
  }

  for (const [kernel, machine] of [
    ['FreeBSD', 'amd64'],
    ['MINGW64_NT-10.0', 'x86_64'],
    ['Linux', 'riscv64'],
    ['Darwin', 'powerpc'],
  ]) {
    const marker = path.join(os.tmpdir(), `install-doctor-curl-marker-${crypto.randomUUID()}`);
    t.after(() => fs.rmSync(marker, { force: true }));
    const result = fixture.run(startScript, release, {
      MOCK_UNAME_S: kernel,
      MOCK_UNAME_M: machine,
      MOCK_CURL_MARKER: marker,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`unsupported bootstrap platform: ${kernel}/${machine}`));
    assert.equal(fs.existsSync(marker), false, 'unsupported platforms must fail before curl runs');
    fixture.assertStageClean();
  }
});

test('Control Plane Phase 1: Better Auth D1 migrations and session handling under cloudflare:workers mock', async () => {
  const app = await loadWorkerApp();

  // 1. Unauthenticated POST /api/auth-migrate must fail closed (401)
  const unauthMig = await app.fetch(
    new Request('https://app.install.doctor/api/auth-migrate', { method: 'POST' }),
    TEST_ENV
  );
  assert.equal(unauthMig.status, 401);

  // 2. Admin-authenticated POST /api/auth-migrate runs Better Auth schema inspection / migration against mock D1
  const authMig = await app.fetch(
    new Request('https://app.install.doctor/api/auth-migrate', {
      method: 'POST',
      headers: { authorization: `Bearer ${TEST_ENV.AID_ADMIN_TOKEN}` },
    }),
    TEST_ENV
  );
  assert.equal(authMig.status, 200);
  const migBody = await authMig.json();
  assert.ok(migBody.message === 'no migrations needed' || migBody.message === 'migrations applied');
  assert.ok(Array.isArray(migBody.created));

  // 3. GET /api/auth/get-session returns clean null session when unauthenticated (with Cache-Control: no-store)
  const sessRes = await app.fetch(
    new Request('https://app.install.doctor/api/auth/get-session', {
      headers: { accept: 'application/json', 'cf-connecting-ip': '203.0.113.42' },
    }),
    TEST_ENV
  );
  assert.equal(sessRes.status, 200);
  assert.ok(sessRes.headers.get('cache-control')?.includes('no-store'));
  const sessBody = await sessRes.json();
  assert.equal(sessBody, null);
});

test('Catalog detail exposes the validated lazy-load decision', async () => {
  const app = await loadWorkerApp();
  const response = await app.fetch(new Request('https://app.install.doctor/api/catalog/xz'), TEST_ENV);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.deliveryMode, 'lazy');
  assert.equal(body.loadPolicy, 'lazy');
  assert.equal(body.loadRationale, 'default-lazy');
});

test('Control Plane Phase 2: Fleet Drift Radar, Cryptographic Execution Receipts & Semantic Catalog Search', async () => {
  const app = await loadWorkerApp();

  // 1. POST /api/v1/fleet/drift
  const driftRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/fleet/drift', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        desired: {
          machineId: 'ubuntu-megabyte-space',
          packages: ['git', 'ripgrep', 'tmux'],
          services: ['alloy'],
        },
        observed: {
          installedPackages: ['git', 'ripgrep'],
          runningServices: [],
          sshPort: 22,
          cloudflareOnlyIngress: false,
          autologinConfigured: true,
        },
      }),
    }),
    TEST_ENV
  );
  assert.equal(driftRes.status, 200);
  const driftJson = await driftRes.json();
  assert.equal(driftJson.converged, false);
  assert.deepEqual(driftJson.missingPackages, ['tmux']);
  assert.deepEqual(driftJson.stoppedServices, ['alloy']);
  assert.ok(driftJson.healingPlan.includes('cloudflare-firewall'));

  // 2. POST /api/v1/receipts/mint & /api/v1/receipts/verify are authenticated.
  const unauthenticatedReceipt = await app.fetch(
    new Request('https://app.install.doctor/api/v1/receipts/mint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
    TEST_ENV
  );
  assert.equal(unauthenticatedReceipt.status, 401);

  const mintRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/receipts/mint', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_ENV.AID_ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        receiptId: 'rcpt-edge-01',
        tenantId: 'tenant-alpha',
        machineId: 'ubuntu-megabyte-space',
        runId: 'run-edge-01',
        blueprintDigest: 'b'.repeat(64),
        action: 'cloudflare-firewall',
        exitCode: 0,
      }),
    }),
    TEST_ENV
  );
  assert.equal(mintRes.status, 201);
  const receipt = await mintRes.json();
  assert.equal(receipt.receiptHash.length, 64);

  const verRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/receipts/verify', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_ENV.AID_ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(receipt),
    }),
    TEST_ENV
  );
  assert.equal(verRes.status, 200);
  const verJson = await verRes.json();
  assert.equal(verJson.valid, true);

  const tamperedRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/receipts/verify', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_ENV.AID_ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...receipt, machineId: 'other-machine' }),
    }),
    TEST_ENV
  );
  assert.equal(tamperedRes.status, 200);
  assert.equal((await tamperedRes.json()).valid, false);

  const staleRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/receipts/mint', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TEST_ENV.AID_ADMIN_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        receiptId: 'rcpt-stale-01',
        tenantId: 'tenant-alpha',
        machineId: 'ubuntu-megabyte-space',
        runId: 'run-stale-01',
        blueprintDigest: 'b'.repeat(64),
        action: 'cloudflare-firewall',
        exitCode: 0,
        timestamp: '2020-01-01T00:00:00.000Z',
      }),
    }),
    TEST_ENV
  );
  assert.equal(staleRes.status, 409);
  assert.equal((await staleRes.json()).error, 'receipt_outside_replay_window');

  // 3. GET /api/v1/catalog/semantic
  const semRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/catalog/semantic?q=ripgrep+search&os=macos&limit=5'),
    TEST_ENV
  );
  assert.equal(semRes.status, 200);
  const semJson = await semRes.json();
  assert.ok(semJson.count >= 1);
  assert.equal(semJson.matches[0].name, 'ripgrep');
});

test('Control Plane security: desired-state metadata is authenticated and requests are bounded/correlated', async () => {
  const app = await loadWorkerApp();

  const desiredRead = await app.fetch(
    new Request('https://app.install.doctor/api/environment/current?tenant=tenant-alpha'),
    TEST_ENV
  );
  assert.equal(desiredRead.status, 401);
  assert.ok(desiredRead.headers.get('x-request-id'));
  assert.equal((await desiredRead.json()).error, 'unauthorized');

  const preview = await app.fetch(
    new Request('https://app.install.doctor/api/environment/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: 'tenant-alpha', observed: {}, dryRun: true }),
    }),
    TEST_ENV
  );
  assert.equal(preview.status, 401);

  const oversized = await app.fetch(
    new Request('https://app.install.doctor/api/v1/github/repos/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '1048577' },
      body: '{}',
    }),
    TEST_ENV
  );
  assert.equal(oversized.status, 413);
  const oversizedBody = await oversized.json();
  assert.equal(oversizedBody.error, 'request_too_large');
  assert.equal(typeof oversizedBody.requestId, 'string');
  assert.equal('detail' in oversizedBody, false);
});
