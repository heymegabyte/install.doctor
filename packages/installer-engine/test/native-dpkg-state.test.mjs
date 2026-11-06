import assert from 'node:assert/strict';
import test from 'node:test';
import { assessDpkgPackageState, inspectDpkgPackage, parseDpkgQueryState } from '../dist/index.js';

const line = ({ name = 'fixture', version = '1.2.3-1', architecture = 'amd64', want = 'install', error = 'ok', status = 'installed' } = {}) =>
  `${name}\x1f${version}\x1f${architecture}\x1f${want}\x1f${error}\x1f${status}\n`;

test('parses one exact machine-oriented dpkg-query record', () => {
  assert.deepEqual(parseDpkgQueryState(line()), {
    packageName: 'fixture', version: '1.2.3-1', architecture: 'amd64', want: 'install', errorFlag: 'ok', status: 'installed',
  });
  for (const malformed of ['', `${line()}${line()}`, line({ status: 'mystery' }), line({ name: '../escape' }), line().replace('\n', '\r\n')]) {
    assert.throws(() => parseDpkgQueryState(malformed));
  }
});

test('classifies only an exact healthy installed package as verified', () => {
  const expected = { expectedName: 'fixture', expectedVersion: '1.2.3-1', expectedArchitecture: 'amd64' };
  assert.equal(assessDpkgPackageState({ ...expected, observed: parseDpkgQueryState(line()) }).disposition, 'verified');
  assert.deepEqual(assessDpkgPackageState({ ...expected, observed: null }), { disposition: 'needed', reason: 'absent', observed: null });
  assert.equal(assessDpkgPackageState({ ...expected, observed: parseDpkgQueryState(line({ version: '1.0.0' })) }).reason, 'version-drift');
  assert.equal(assessDpkgPackageState({ ...expected, observed: parseDpkgQueryState(line({ version: '1.0.0', want: 'hold' })) }).reason, 'held-version-drift');
});

test('half states, triggers, reinstreq, and removal intent are repair blockers', () => {
  const expected = { expectedName: 'fixture', expectedVersion: '1.2.3-1', expectedArchitecture: 'amd64' };
  for (const state of ['half-installed', 'unpacked', 'half-configured', 'triggers-awaited', 'triggers-pending']) {
    assert.deepEqual(assessDpkgPackageState({ ...expected, observed: parseDpkgQueryState(line({ status: state })) }).reason, 'repair-required');
  }
  assert.equal(assessDpkgPackageState({ ...expected, observed: parseDpkgQueryState(line({ error: 'reinstreq' })) }).reason, 'repair-required');
  assert.equal(assessDpkgPackageState({ ...expected, observed: parseDpkgQueryState(line({ want: 'deinstall' })) }).reason, 'repair-required');
});

test('inspection treats only an exact missing record as absent and propagates ambiguity', async () => {
  const base = { packageName: 'fixture', version: '1.2.3-1', architecture: 'amd64' };
  assert.equal((await inspectDpkgPackage({ ...base, runner: { query: async () => ({ code: 1, stdout: '', stderr: 'not installed' }) } })).reason, 'absent');
  assert.equal((await inspectDpkgPackage({ ...base, runner: { query: async () => ({ code: 0, stdout: line(), stderr: '' }) } })).disposition, 'verified');
  await assert.rejects(inspectDpkgPackage({ ...base, runner: { query: async () => ({ code: 2, stdout: '', stderr: 'database failure' }) } }), /exit 2/);
  await assert.rejects(inspectDpkgPackage({ ...base, runner: { query: async () => ({ code: 1, stdout: 'unexpected', stderr: '' }) } }), /exit 1/);
});
