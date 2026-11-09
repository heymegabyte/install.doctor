import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { createBetterAuthOptions } from '../src/better-auth-options.ts';
import { DESKTOP_TOOLS_CANONICAL_AUTH_ORIGIN, DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS } from '../src/auth-origin-policy.ts';

test('reviewed D1 migration exactly matches pinned Better Auth schema', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(fs.readFileSync(new URL('../migrations/0018_better_auth_schema.sql', import.meta.url), 'utf8'));
    // Better Auth's SQLite introspector is the schema compiler used for D1; using
    // node:sqlite here makes an inspection failure fatal instead of returning an
    // empty plan from a partial test double.
    const auth = betterAuth(createBetterAuthOptions(sqlite, {
      BETTER_AUTH_SECRET: 'test_better_auth_secret_32_bytes_long_minimum!',
      GITHUB_CLIENT_ID: 'github-test',
      GITHUB_CLIENT_SECRET: 'github-secret-test',
      GOOGLE_CLIENT_ID: 'google-test',
      GOOGLE_CLIENT_SECRET: 'google-secret-test',
    }, {
      baseURL: DESKTOP_TOOLS_CANONICAL_AUTH_ORIGIN,
      trustedOrigins: DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS,
    }));
    const plan = await getMigrations(auth.options, { throwOnUnsafe: false });
    assert.deepEqual({
      created: plan.toBeCreated,
      added: plan.toBeAdded,
      indexes: plan.toBeAddedIndexes,
      unsafe: plan.unsafeChanges,
      problems: plan.schemaProblems,
    }, { created: [], added: [], indexes: [], unsafe: [], problems: [] });
  } finally {
    sqlite.close();
  }
});
