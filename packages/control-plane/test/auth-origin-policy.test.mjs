import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_TOOLS_CANONICAL_AUTH_HOST,
  DESKTOP_TOOLS_CANONICAL_AUTH_ORIGIN,
  DESKTOP_TOOLS_AUTH_HOSTS,
  DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS,
  isCanonicalAuthOrigin,
  requiresCanonicalAuthOrigin,
} from '../src/auth-origin-policy.ts';

test('auth accepts only the canonical HTTPS approval origins', () => {
  assert.deepEqual(DESKTOP_TOOLS_AUTH_HOSTS, ['desktop.tools', 'app.install.doctor']);
  assert.equal(DESKTOP_TOOLS_CANONICAL_AUTH_HOST, 'desktop.tools');
  assert.equal(DESKTOP_TOOLS_CANONICAL_AUTH_ORIGIN, 'https://desktop.tools');
  assert.deepEqual(DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS,
    ['https://desktop.tools', 'https://app.install.doctor']);
  assert.equal(isCanonicalAuthOrigin('https://desktop.tools'), true);
  assert.equal(isCanonicalAuthOrigin('https://app.install.doctor'), false);
});

test('only state-creating sign-in and callback completion require the canonical origin', () => {
  assert.equal(requiresCanonicalAuthOrigin('POST', '/api/auth/sign-in/social'), true);
  assert.equal(requiresCanonicalAuthOrigin('POST', '/api/auth/sign-in/email'), true);
  assert.equal(requiresCanonicalAuthOrigin('GET', '/api/auth/callback/github'), true);
  assert.equal(requiresCanonicalAuthOrigin('GET', '/api/auth/get-session'), false);
  assert.equal(requiresCanonicalAuthOrigin('POST', '/api/auth/sign-out'), false);
  assert.equal(requiresCanonicalAuthOrigin('GET', '/api/auth/sign-in/social'), false);
});

test('profile, insecure, credentialed, port, and suffix-confusion origins are not auth origins', () => {
  for (const origin of [
    'https://brian.desktop.tools', 'http://desktop.tools', 'https://desktop.tools:8443',
    'https://desktop.tools.evil.example', 'https://user@desktop.tools', 'https://desktop.tools/pair',
  ]) assert.equal(isCanonicalAuthOrigin(origin), false, origin);
});
