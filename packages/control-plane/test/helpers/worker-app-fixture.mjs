import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const helperDirectory = path.dirname(fileURLToPath(import.meta.url));
const distIndexPath = path.resolve(helperDirectory, '../../dist/index.js');

export const TEST_ENV = Object.freeze({
  AID_ADMIN_TOKEN: 'test_admin_secret_token_123456',
  AID_RECEIPT_SIGNING_KEY: 'test_receipt_signing_key_at_least_32_bytes_long!',
  BETTER_AUTH_SECRET: 'test_better_auth_secret_32_bytes_long_minimum!',
  GITHUB_CLIENT_ID: 'gh_client_test',
  GITHUB_CLIENT_SECRET: 'gh_secret_test',
  GOOGLE_CLIENT_ID: 'goog_client_test',
  GOOGLE_CLIENT_SECRET: 'goog_secret_test',
  INSTALL_DOCTOR_MANIFEST_URL: 'https://app.install.doctor/releases/test/manifest',
  INSTALL_DOCTOR_MANIFEST_SIGNATURE_URL: 'https://app.install.doctor/releases/test/manifest.sig',
  INSTALL_DOCTOR_RELEASE_SIGNER_ID: 'install-doctor-test',
});

const schema = `
  CREATE TABLE IF NOT EXISTS "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
  CREATE TABLE IF NOT EXISTS "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
  CREATE TABLE IF NOT EXISTS "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
  CREATE TABLE IF NOT EXISTS "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
  CREATE TABLE IF NOT EXISTS "rateLimit" ("id" text not null primary key, "key" text not null, "count" integer not null, "lastRequest" integer not null);
  CREATE TABLE IF NOT EXISTS pairings (code text primary key, poll_sha256 text not null unique, tenant text not null, label text, permissions text, status text not null, device_id text, created_at text not null, expires_at text not null, approved_at text, claimed_at text, machine_fingerprint text, profile_revision text, owner_actor text, decided_by text, denied_at text, last_polled_at text, approved_scopes text, profile_id text, profile_revision_digest text);
  CREATE TABLE IF NOT EXISTS devices (device_id text primary key, tenant text not null, token_sha256 text not null unique, label text, permissions text, created_at text not null, revoked_at text, pairing_code text unique references pairings(code), profile_revision text, machine_fingerprint text, expires_at text, profile_id text, profile_revision_digest text);
  CREATE TABLE IF NOT EXISTS device_authorizations (request_id text primary key, verification_code text not null unique, poll_sha256 text not null unique, request_json text not null, tenant_id text not null, profile_id text not null, profile_revision text not null, profile_revision_digest text not null, target_key_fingerprint text not null, machine_label text not null, requested_scopes text not null, approved_scopes text, status text not null, created_at text not null, expires_at text not null, approved_at text, denied_at text, cancelled_at text, claimed_at text, last_polled_at text);
  CREATE TABLE IF NOT EXISTS device_authorization_credentials (credential_id text primary key, request_id text not null unique references device_authorizations(request_id), secret_sha256 text not null unique, tenant_id text not null, profile_id text not null, target_key_fingerprint text not null, scopes text not null, issued_at text not null, expires_at text not null, revoked_at text);
  CREATE TABLE IF NOT EXISTS blueprints (tenant text primary key, markdown text not null, updated_at text not null);
  CREATE TABLE IF NOT EXISTS tenant_owner_authority (authority_id text primary key, tenant_id text not null, owner_actor_id text not null, better_auth_user_id text not null, authentication_actor text not null, status text not null, created_at text not null, revoked_at text);
  CREATE TRIGGER IF NOT EXISTS claim_pairing_after_device_insert AFTER INSERT ON devices WHEN NEW.pairing_code IS NOT NULL BEGIN UPDATE pairings SET status='claimed', claimed_at=NEW.created_at, device_id=NEW.device_id WHERE code=NEW.pairing_code AND status='approved' AND expires_at > NEW.created_at; SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'claim unavailable') END; END;
  CREATE TRIGGER IF NOT EXISTS claim_device_authorization_after_credential_insert AFTER INSERT ON device_authorization_credentials BEGIN UPDATE device_authorizations SET status='claimed', claimed_at=NEW.issued_at WHERE request_id=NEW.request_id AND status='approved' AND expires_at>NEW.issued_at; SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT, 'authorization claim unavailable') END; END;
`;

export async function createWorkerFixture() {
  assert.ok(fs.existsSync(distIndexPath), 'dist/index.js must exist (run `npm run check` first)');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tools-worker-fixture-'));
  fs.chmodSync(root, 0o700);
  const key = `__DESKTOP_TOOLS_TEST_DB_${crypto.randomBytes(12).toString('hex')}__`;
  const mockModule = `import { DatabaseSync } from 'node:sqlite';
    const sqlite = new DatabaseSync(':memory:'); sqlite.exec(${JSON.stringify(schema)});
    const mockD1={prepare(rawSql){const sql=rawSql.replace(/pragma_table_info\\(\"([^\"]+)\"\\)/gi,"pragma_table_info('$1')").replace(/\"(table|view|sqlite_%|kysely_migration|kysely_migration_lock)\"/g,"'$1'");let bound=[];const stmt={sql,bind(...args){bound=args;return stmt},async all(){const s=sqlite.prepare(sql);if(/^\\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\\b/i.test(sql)&&!/[\\s)]RETURNING\\s/i.test(sql)){const info=s.run(...bound);return{results:[],success:true,meta:{changes:Number(info.changes??0),last_row_id:Number(info.lastInsertRowid??0)}}}return{results:s.all(...bound).map(r=>({...r})),success:true,meta:{}}},async first(col){const row=sqlite.prepare(sql).get(...bound);if(!row)return null;const plain={...row};return col?plain[col]:plain},async run(){const info=sqlite.prepare(sql).run(...bound);return{results:[],success:true,meta:{changes:Number(info.changes??0),last_row_id:Number(info.lastInsertRowid??0)}}},async raw(){return sqlite.prepare(sql).all(...bound).map(r=>Object.values({...r}))}};return stmt},async batch(stmts){return Promise.all(stmts.map(s=>s.all()))},async exec(sql){sqlite.exec(sql);return{count:1,duration:1}},close(){sqlite.close()}};
    globalThis[${JSON.stringify(key)}]=mockD1;
    export const env={DB:mockD1,AID_ADMIN_TOKEN:'test_admin_secret_token_123456',BETTER_AUTH_SECRET:'test_better_auth_secret_32_bytes_long_minimum!',GITHUB_CLIENT_ID:'gh_client_test',GITHUB_CLIENT_SECRET:'gh_secret_test',GOOGLE_CLIENT_ID:'goog_client_test',GOOGLE_CLIENT_SECRET:'goog_secret_test'};
    export class DurableObject{} export class WorkerEntrypoint{} export class WorkflowEntrypoint{}`;
  const mockUrl = `data:text/javascript,${encodeURIComponent(mockModule)}`;
  const bundle = path.join(root, 'worker.mjs');
  fs.writeFileSync(bundle, fs.readFileSync(distIndexPath, 'utf8').replace(/["']cloudflare:[^"']+["']/g, JSON.stringify(mockUrl)), { mode: 0o600, flag: 'wx' });
  const module = await import(`${pathToFileURL(bundle).href}?fixture=${Date.now()}`);
  const db = globalThis[key];
  assert.ok(db, 'worker fixture did not publish its isolated D1 adapter');
  return Object.freeze({
    app: module.default,
    db,
    env: Object.freeze({ ...TEST_ENV, DB: db }),
    async cleanup() {
      delete globalThis[key];
      fs.rmSync(root, { recursive: true, force: true });
    },
  });
}
