import assert from 'node:assert/strict';
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  RendererSpillLogIntegrityError,
  createProtectedRendererSpillLog,
} from '../dist/renderer-spill-log.js';

function privateStateRoot(label) {
  const root = mkdtempSync(join(tmpdir(), label));
  chmodSync(root, 0o700);
  return root;
}

test('creates a private bounded synchronous spill log', () => {
  const stateRoot = privateStateRoot('renderer-spill-private-');
  const log = createProtectedRendererSpillLog({ stateRoot, runId: 'run-1', maxBytes: 8 });

  assert.equal(log.append('four'), true);
  assert.equal(log.append('more'), true);
  assert.equal(log.append('!'), false);
  assert.equal(log.bytesWritten, 8);
  log.close();

  assert.equal(readFileSync(log.path, 'utf8'), 'fourmore');
  assert.equal(lstatSync(join(stateRoot, 'renderer-spill')).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(stateRoot, 'renderer-spill', 'run-1')).mode & 0o777, 0o700);
  const metadata = lstatSync(log.path);
  assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(metadata.nlink, 1);
  assert.equal(log.closed, true);
  assert.throws(() => log.append('late'), RendererSpillLogIntegrityError);
  assert.doesNotThrow(() => log.close());
});

test('rejects invalid run identifiers and non-private roots before writing', () => {
  const privateRoot = privateStateRoot('renderer-spill-invalid-');
  assert.throws(() => createProtectedRendererSpillLog({ stateRoot: privateRoot, runId: '../escape' }));

  if (process.platform !== 'win32') {
    const publicRoot = privateStateRoot('renderer-spill-public-');
    chmodSync(publicRoot, 0o755);
    assert.throws(
      () => createProtectedRendererSpillLog({ stateRoot: publicRoot, runId: 'run-1' }),
      /directory is not private/,
    );
  }
});

test('fails closed when the spill path is pre-created or traverses a symlink', () => {
  const occupiedRoot = privateStateRoot('renderer-spill-occupied-');
  const occupiedRun = join(occupiedRoot, 'renderer-spill', 'run-1');
  mkdirSync(occupiedRun, { recursive: true, mode: 0o700 });
  writeFileSync(join(occupiedRun, 'output.log'), 'do not replace', { mode: 0o600 });
  assert.throws(() => createProtectedRendererSpillLog({ stateRoot: occupiedRoot, runId: 'run-1' }), /EEXIST/);
  assert.equal(readFileSync(join(occupiedRun, 'output.log'), 'utf8'), 'do not replace');

  const linkedRoot = privateStateRoot('renderer-spill-linked-');
  const outside = privateStateRoot('renderer-spill-outside-');
  symlinkSync(outside, join(linkedRoot, 'renderer-spill'));
  assert.throws(
    () => createProtectedRendererSpillLog({ stateRoot: linkedRoot, runId: 'run-1' }),
    /not a real directory/,
  );
});

test('detects hard links, permission changes, replacement, and external growth', () => {
  if (process.platform === 'win32') return;

  const hardLinkRoot = privateStateRoot('renderer-spill-hardlink-');
  const hardLinked = createProtectedRendererSpillLog({ stateRoot: hardLinkRoot, runId: 'run-1' });
  linkSync(hardLinked.path, join(hardLinkRoot, 'linked.log'));
  assert.throws(() => hardLinked.append('x'), /unsafe permissions or links/);

  const modeRoot = privateStateRoot('renderer-spill-mode-');
  const modeChanged = createProtectedRendererSpillLog({ stateRoot: modeRoot, runId: 'run-1' });
  chmodSync(modeChanged.path, 0o644);
  assert.throws(() => modeChanged.append('x'), /unsafe permissions or links/);

  const replacementRoot = privateStateRoot('renderer-spill-replaced-');
  const replaced = createProtectedRendererSpillLog({ stateRoot: replacementRoot, runId: 'run-1' });
  renameSync(replaced.path, `${replaced.path}.old`);
  writeFileSync(replaced.path, '', { mode: 0o600 });
  assert.throws(() => replaced.append('x'), /pathname no longer identifies/);

  const growthRoot = privateStateRoot('renderer-spill-growth-');
  const grown = createProtectedRendererSpillLog({ stateRoot: growthRoot, runId: 'run-1' });
  writeFileSync(grown.path, 'external');
  assert.throws(() => grown.append('x'), /changed outside/);
});
