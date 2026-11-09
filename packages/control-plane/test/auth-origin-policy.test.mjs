import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_TOOLS_AUTH_HOSTS,
  DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS,
  isCanonicalAuthOrigin,
} from '../src/auth-origin-policy.ts';

test('auth accepts only the canonical HTTPS approval origins', () => {
  assert.deepEqual(DESKTOP_TOOLS_AUTH_HOSTS, ['desktop.tools', 'app.install.doctor']);
  assert.deepEqual(DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS,
    ['https://desktop.tools', 'https://app.install.doctor']);
  for (const origin of DESKTOP_TOOLS_TRUSTED_AUTH_ORIGINS) assert.equal(isCanonicalAuthOrigin(origin), true);
});

test('profile, insecure, credentialed, port, and suffix-confusion origins are not auth origins', () => {
  for (const origin of [
    'https://brian.desktop.tools', 'http://desktop.tools', 'https://desktop.tools:8443',
    'https://desktop.tools.evil.example', 'https://user@desktop.tools', 'https://desktop.tools/pair',
  ]) assert.equal(isCanonicalAuthOrigin(origin), false, origin);
});
