#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [matrixFile, receiptFile, outputRoot] = process.argv.slice(2);
if (!matrixFile || !receiptFile || !outputRoot || process.argv.length !== 5) {
  throw new Error('usage: stage-platform-promotion MATRIX PROMOTED_RECEIPT OUTPUT_ROOT');
}

const readJsonFile = (file, maximumBytes) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximumBytes) {
    throw new Error(`unsafe promotion source: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const writeExclusive = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
};

const output = path.resolve(outputRoot);
if (fs.existsSync(output)) {
  const stat = fs.lstatSync(output);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(output).length !== 0) {
    throw new Error('promotion output must be an existing empty directory or a new path');
  }
} else {
  fs.mkdirSync(output, { recursive: false, mode: 0o700 });
}

const matrix = readJsonFile(matrixFile, 2_097_152);
const receipt = readJsonFile(receiptFile, 16_777_216);
if (receipt.schemaVersion !== 3 || receipt.evidenceClass !== 'real-host-canary' || receipt.result !== 'passed') {
  throw new Error('only an independently promoted passing real-host receipt may be staged');
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(receipt.receiptId ?? '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(receipt.cellId ?? '')) {
  throw new Error('receipt and cell identifiers must be safe lowercase kebab-case');
}
const matching = matrix.cells?.filter(cell => cell.id === receipt.cellId) ?? [];
if (matching.length !== 1) throw new Error('receipt must identify exactly one declared platform cell');
const cell = matching[0];
if (cell.status === 'unsupported') throw new Error('unsupported platform cells require an explicit source-reviewed support change');

const relativeReceipt = `.agent/evidence/platform-canaries/${receipt.cellId}/${receipt.receiptId}.json`;
cell.status = 'verified';
cell.evidence = [{ kind: 'canary-receipt', path: relativeReceipt }];

const stagedMatrix = path.join(output, 'scripts', 'platform-support-matrix.json');
const stagedReceipt = path.join(output, relativeReceipt);
writeExclusive(stagedMatrix, `${JSON.stringify(matrix, null, 2)}\n`);
writeExclusive(stagedReceipt, `${JSON.stringify(receipt)}\n`);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const validator = path.join(scriptDirectory, 'validate-platform-support-matrix.mjs');
const validationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tools-promotion-validation-'));
try {
  const copiedEvidence = new Set();
  for (const evidence of matrix.cells.flatMap(candidate => candidate.evidence ?? [])) {
    const relative = evidence.path;
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split('/').includes('..')) {
      throw new Error(`unsafe matrix evidence path: ${relative}`);
    }
    if (copiedEvidence.has(relative)) continue;
    copiedEvidence.add(relative);
    const stagedSource = path.join(output, relative);
    const source = fs.existsSync(stagedSource) ? stagedSource : path.join(repositoryRoot, relative);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe matrix evidence source: ${relative}`);
    const destination = path.join(validationRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
  const validation = spawnSync(process.execPath, [validator, stagedMatrix, validationRoot], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    maxBuffer: 1_048_576,
  });
  if (validation.status !== 0) {
    throw new Error(`staged promotion failed platform validation: ${validation.stderr.trim() || validation.stdout.trim()}`);
  }
} catch (error) {
  fs.rmSync(output, { recursive: true, force: true });
  throw error;
} finally {
  fs.rmSync(validationRoot, { recursive: true, force: true });
}
process.stdout.write(`${relativeReceipt}\n`);
