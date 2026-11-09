import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAuthReturnPath } from '../src/auth-return-policy.ts';

test('auth completion preserves only a canonical pairing review', () => {
  assert.equal(normalizeAuthReturnPath(undefined), '/');
  assert.equal(normalizeAuthReturnPath('/'), '/');
  assert.equal(normalizeAuthReturnPath('/pair?code=2345-ABCD-EFGH'), '/pair?code=2345-ABCD-EFGH');
  assert.equal(normalizeAuthReturnPath('/pair?code=2345-abcd-efgh'), '/pair?code=2345-ABCD-EFGH');
});

test('auth completion rejects external, ambiguous, and malformed return paths', () => {
  for (const value of [
    'https://evil.example/pair?code=2345-ABCD-EFGH',
    '//evil.example/pair?code=2345-ABCD-EFGH',
    '/pair?code=2345-ABCD-EFGH&next=https://evil.example',
    '/pair?code=2345-ABCD-EFGH#fragment',
    '/pair?code=not-a-code',
    '/machines',
  ]) assert.equal(normalizeAuthReturnPath(value), '/', value);
});
