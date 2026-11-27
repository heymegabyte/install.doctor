#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyInfisicalGetPayload } from './verify-infisical-secret-presence.mjs';

const result = classifyInfisicalGetPayload([
  { secretKey: 'REAL_SECRET', secretValue: 'actual-value' },
  { secretKey: 'MISSING_SECRET', secretValue: 'NOT FOUND' },
  { secretKey: 'SENTINEL', secretValue: 'NOT FOUND' },
], 'SENTINEL', ['REAL_SECRET', 'MISSING_SECRET']);
assert.deepEqual(result, { present: ['REAL_SECRET'], absent: ['MISSING_SECRET'] });
assert.throws(() => classifyInfisicalGetPayload([], 'SENTINEL', ['REAL_SECRET']), /sentinel/);
assert.throws(() => classifyInfisicalGetPayload([
  { secretKey: 'SENTINEL', secretValue: 'NOT FOUND' },
], 'SENTINEL', ['REAL_SECRET']), /omitted requested key/);
assert.throws(() => classifyInfisicalGetPayload([
  { secretKey: 'SENTINEL', secretValue: 'NOT FOUND' },
  { secretKey: 'SENTINEL', secretValue: 'NOT FOUND' },
], 'SENTINEL', []), /duplicate key/);
console.log('infisical presence verifier tests: PASS');
