import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  BETTER_AUTH_SECRET: 'test_better_auth_secret_32_bytes_long_minimum!',
};

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

test('Control Plane Phase 1: Dual-Repo GitHub Scan, Host-Repo Ensure, API Key Minting & Universal /start', async () => {
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

  // Ensure host repo with namespace
  const ensRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/github/host-repo/ensure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: 'heymegabyte', hostname: 'ubuntu', namespace: 'megabyte.space' }),
    }),
    TEST_ENV
  );
  assert.equal(ensRes.status, 201);
  const ensJson = await ensRes.json();
  assert.equal(ensJson.fqdn, 'ubuntu.megabyte.space');
  assert.equal(ensJson.repoFullName, 'heymegabyte/ubuntu.megabyte.space');
  assert.ok(ensJson.closeBrowserMessage.includes('You can close the browser now'));

  // Ensure host repo fallback when namespace is absent
  const ensFallbackRes = await app.fetch(
    new Request('https://app.install.doctor/api/v1/github/host-repo/ensure', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: 'heymegabyte', hostname: 'ephemeral-node' }),
    }),
    TEST_ENV
  );
  assert.equal(ensFallbackRes.status, 201);
  const ensFallback = await ensFallbackRes.json();
  assert.equal(ensFallback.fqdn, 'ephemeral-node');
  assert.equal(ensFallback.repoFullName, 'heymegabyte/ephemeral-node');

  // Mint API Key (unauthenticated -> 401; authenticated -> 201)
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
  assert.equal(mintAuth.status, 201);
  const mintJson = await mintAuth.json();
  assert.ok(mintJson.apiKey.startsWith('aid_'));
  assert.equal(mintJson.bypassOAuth, true);

  // GET /start universal bootstrap
  const startRes = await app.fetch(new Request('https://app.install.doctor/start'), TEST_ENV);
  assert.equal(startRes.status, 200);
  const startScript = await startRes.text();
  assert.ok(startScript.includes('AID_API_KEY'));
  assert.ok(startScript.includes('heymegabyte/install.doctor'));
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
