import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../migrations/0017_target_device_authorizations.sql', import.meta.url),
  'utf8',
);

function openStore() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(migration);
  return sqlite;
}

function insertAuthorization(sqlite, overrides = {}) {
  const authorization = {
    requestId: 'request-1',
    verificationCode: 'ABCD-EFGH',
    pollSha256: 'a'.repeat(64),
    requestJson: '{"schemaVersion":1}',
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    profileRevision: 'revision-1',
    profileRevisionDigest: 'b'.repeat(64),
    targetKeyFingerprint: 'c'.repeat(64),
    machineLabel: 'canary',
    requestedScopes: '["profile:read"]',
    approvedScopes: '["profile:read"]',
    status: 'approved',
    createdAt: '2026-11-09T12:00:00.000Z',
    expiresAt: '2026-11-09T12:10:00.000Z',
    ...overrides,
  };
  sqlite.prepare(`
    INSERT INTO device_authorizations (
      request_id, verification_code, poll_sha256, request_json, tenant_id,
      profile_id, profile_revision, profile_revision_digest,
      target_key_fingerprint, machine_label, requested_scopes,
      approved_scopes, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    authorization.requestId,
    authorization.verificationCode,
    authorization.pollSha256,
    authorization.requestJson,
    authorization.tenantId,
    authorization.profileId,
    authorization.profileRevision,
    authorization.profileRevisionDigest,
    authorization.targetKeyFingerprint,
    authorization.machineLabel,
    authorization.requestedScopes,
    authorization.approvedScopes,
    authorization.status,
    authorization.createdAt,
    authorization.expiresAt,
  );
}

function claim(sqlite, overrides = {}) {
  const credential = {
    credentialId: 'credential-1',
    requestId: 'request-1',
    secretSha256: 'd'.repeat(64),
    tenantId: 'tenant-1',
    profileId: 'profile-1',
    targetKeyFingerprint: 'c'.repeat(64),
    scopes: '["profile:read"]',
    issuedAt: '2026-11-09T12:01:00.000Z',
    expiresAt: '2026-11-09T12:31:00.000Z',
    ...overrides,
  };
  sqlite.prepare(`
    INSERT INTO device_authorization_credentials (
      credential_id, request_id, secret_sha256, tenant_id, profile_id,
      target_key_fingerprint, scopes, issued_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    credential.credentialId,
    credential.requestId,
    credential.secretSha256,
    credential.tenantId,
    credential.profileId,
    credential.targetKeyFingerprint,
    credential.scopes,
    credential.issuedAt,
    credential.expiresAt,
  );
}

test('device authorization migration is idempotent and claims atomically', () => {
  const sqlite = openStore();
  sqlite.exec(migration);
  insertAuthorization(sqlite);

  claim(sqlite);

  const claimed = sqlite.prepare(`
    SELECT status, claimed_at AS claimedAt
    FROM device_authorizations WHERE request_id = ?
  `).get('request-1');
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.claimedAt, '2026-11-09T12:01:00.000Z');
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM device_authorization_credentials').get().count,
    1,
  );

  assert.throws(
    () => claim(sqlite, {
      credentialId: 'credential-replay',
      secretSha256: 'e'.repeat(64),
    }),
    /authorization claim unavailable|UNIQUE constraint failed/,
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM device_authorization_credentials').get().count,
    1,
  );
  sqlite.close();
});

for (const [label, authorization] of [
  ['pending', { status: 'pending' }],
  ['expired', { expiresAt: '2026-11-09T12:00:30.000Z' }],
]) {
  test(`credential insert rolls back when authorization is ${label}`, () => {
    const sqlite = openStore();
    insertAuthorization(sqlite, authorization);

    assert.throws(() => claim(sqlite), /authorization claim unavailable/);
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) AS count FROM device_authorization_credentials').get().count,
      0,
    );
    assert.equal(
      sqlite.prepare('SELECT status FROM device_authorizations WHERE request_id = ?').get('request-1').status,
      authorization.status ?? 'approved',
    );
    sqlite.close();
  });
}
