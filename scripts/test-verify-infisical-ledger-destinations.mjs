#!/usr/bin/env node
import assert from 'node:assert/strict';
import { collectLedgerDestinations } from './verify-infisical-ledger-destinations.mjs';

const manifest = {
  hosts: { 'macos.example.test': { projectId: '00000000-0000-0000-0000-000000000001', secretPath: '/' } },
  workloads: { 'api.example.test': { projectId: '00000000-0000-0000-0000-000000000002', secretPath: '/runtime' } },
};
const ledger = { records: {
  'general:ONE': { canonicalName: 'ONE', migrated: true, targetRetrievalVerified: true, destination: 'macos.example.test:/' },
  'general:ALIAS': { canonicalName: 'ALIAS', migrated: true, targetRetrievalVerified: true, destination: 'macos.example.test:RENAMED' },
  'general:TWO': { canonicalName: 'TWO', migrated: true, targetRetrievalVerified: true, destination: ['api.example.test:/runtime'] },
  'general:SKIP': { canonicalName: 'SKIP', migrated: false, targetRetrievalVerified: false, destination: 'macos.example.test:/' },
} };
assert.deepEqual(collectLedgerDestinations(ledger, manifest), [
  {
    target: 'api.example.test', projectId: '00000000-0000-0000-0000-000000000002',
    secretPath: '/runtime', names: ['TWO'],
  },
  {
    target: 'macos.example.test', projectId: '00000000-0000-0000-0000-000000000001',
    secretPath: '/', names: ['ONE', 'RENAMED'],
  },
]);
assert.throws(() => collectLedgerDestinations({ records: {
  'general:BAD': { canonicalName: 'BAD', migrated: true, targetRetrievalVerified: true, destination: 'unknown.example.test:/' },
} }, manifest), /unknown destination/);
console.log('infisical ledger destination verifier tests: PASS');
