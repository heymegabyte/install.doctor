import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  authenticatedOwnerFromBetterAuthSession,
  createBrokerProductionAuthorities,
} from '../src/broker-production-authorities.ts';

const hex = value => value.repeat(64);
const now = new Date('2026-11-09T12:00:00.000Z');

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of ['0003_devices.sql', '0005_pairings.sql', '0009_pairing_owner_approval.sql',
    '0010_atomic_device_claim.sql', '0016_broker_production_authority.sql']) {
    sqlite.exec(fs.readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const database = { prepare(sql) { let values = []; const statement = {
    bind(...bound) { values = bound; return statement; },
    async first() { const row = sqlite.prepare(sql).get(...values); return row ? { ...row } : null; },
  }; return statement; } };
  const profiles = [{ id: 'profile-1', tenantId: 'tenant-1', slug: 'brian', revision: 'revision-1',
    digest: hex('a'), visibility: 'public-bootstrap', enabled: true }];
  sqlite.prepare(`INSERT INTO devices
    (device_id, tenant, token_sha256, created_at, machine_fingerprint, profile_id, profile_revision_digest, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('device-1', 'tenant-1', hex('1'), now.toISOString(), hex('b'),
      'profile-1', hex('a'), '2026-11-09T13:00:00.000Z');
  sqlite.prepare(`INSERT INTO tenant_owner_authority
    (authority_id, tenant_id, owner_actor_id, better_auth_user_id, authentication_actor, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)`).run('authority-1', 'tenant-1', 'owner-1', 'user_1',
      'better-auth-user:user_1', now.toISOString());
  return { sqlite, authorities: createBrokerProductionAuthorities({ database, publicProfiles: profiles, now: () => now }) };
}

test('resolves only exact active device, immutable public profile, and server-managed tenant owner', async () => {
  const { authorities } = setup();
  assert.deepEqual(await authorities.device.resolve('device-1'), {
    deviceCredentialId: 'device-1', deviceFingerprint: hex('b'), tenantId: 'tenant-1',
    profileId: 'profile-1', profileRevisionDigest: hex('a'), active: true,
  });
  assert.deepEqual(await authorities.profile.resolve('profile-1'), {
    profileId: 'profile-1', tenantId: 'tenant-1', revision: 'revision-1', digest: hex('a'),
    visibility: 'public-bootstrap', enabled: true,
  });
  assert.deepEqual(await authorities.owner.resolveForTenant('tenant-1'), {
    authenticationActor: 'better-auth-user:user_1', ownerActorId: 'owner-1',
  });
});

test('legacy, expired, revoked, mismatched, and malformed authority fail closed', async () => {
  for (const mutation of [
    "UPDATE devices SET profile_id=NULL WHERE device_id='device-1'",
    "UPDATE devices SET profile_revision_digest=NULL WHERE device_id='device-1'",
    "UPDATE devices SET machine_fingerprint=NULL WHERE device_id='device-1'",
    "UPDATE devices SET expires_at='2026-11-09T12:00:00.000Z' WHERE device_id='device-1'",
    "UPDATE devices SET revoked_at='2026-11-09T11:00:00.000Z' WHERE device_id='device-1'",
  ]) {
    const setupValue = setup();
    setupValue.sqlite.exec(mutation);
    assert.equal(await setupValue.authorities.device.resolve('device-1'), null, mutation);
  }
  for (const mutation of [
    "UPDATE tenant_owner_authority SET status='revoked', revoked_at='2026-11-09T11:00:00.000Z'",
    "UPDATE tenant_owner_authority SET authentication_actor='better-auth-user:other'",
  ]) {
    const setupValue = setup();
    setupValue.sqlite.exec(mutation);
    assert.equal(await setupValue.authorities.owner.resolveForTenant('tenant-1'), null, mutation);
  }
});

test('projects stable Better Auth user identity and rejects email-only or malformed sessions', () => {
  assert.deepEqual(authenticatedOwnerFromBetterAuthSession({
    user: { id: 'user_1', email: 'owner@example.com' },
    session: { createdAt: '2026-11-09T11:59:00.000Z' },
  }), { actor: 'better-auth-user:user_1', authenticatedAt: '2026-11-09T11:59:00.000Z' });
  assert.equal(authenticatedOwnerFromBetterAuthSession({
    user: { email: 'owner@example.com' }, session: { createdAt: '2026-11-09T11:59:00.000Z' },
  }), null);
  assert.equal(authenticatedOwnerFromBetterAuthSession({
    user: { id: 'bad:user' }, session: { createdAt: '2026-11-09T11:59:00.000Z' },
  }), null);
});
