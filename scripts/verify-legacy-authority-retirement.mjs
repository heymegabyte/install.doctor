#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyCatalogAuthority } from './reconcile-catalog-authority.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, process.argv[2] ?? 'config/legacy-authority-retirement.json');
const categories = ['writer', 'credential', 'scheduler', 'collector', 'catalog-generator', 'release-path', 'compatibility-shim'];
const states = new Set(['retained-migration-authority', 'retained-compatibility-authority', 'retired-with-rollback', 'absent']);
const exact = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${label} has an invalid field set`);
};
const text = (value, label) => {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new Error(`${label} must be non-empty trimmed text`);
};
const array = (value, label) => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) throw new Error(`${label} must be a string array`);
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
};
const contained = (path) => {
  text(path, 'repository path'); const absolute = resolve(root, path); const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`path escapes repository: ${path}`);
  return absolute;
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
exact(manifest, ['schemaVersion', 'catalogAuthority', 'authorities'], 'retirement manifest');
if (manifest.schemaVersion !== 1 || manifest.catalogAuthority !== 'config/catalog-authority.json') throw new Error('unsupported retirement authority');
if (!Array.isArray(manifest.authorities) || manifest.authorities.length !== categories.length) throw new Error('every retirement category must appear exactly once');

for (const [index, entry] of manifest.authorities.entries()) {
  exact(entry, ['category', 'state', 'paths', 'successor', 'reason', 'blockers', 'evidenceTests'], `authorities[${index}]`);
  if (entry.category !== categories[index]) throw new Error(`retirement categories must be ordered and complete; expected ${categories[index]}`);
  if (!states.has(entry.state)) throw new Error(`${entry.category} has an invalid state`);
  array(entry.paths, `${entry.category}.paths`); array(entry.blockers, `${entry.category}.blockers`);
  array(entry.evidenceTests, `${entry.category}.evidenceTests`); text(entry.successor, `${entry.category}.successor`);
  text(entry.reason, `${entry.category}.reason`);
  if (entry.evidenceTests.length === 0) throw new Error(`${entry.category} requires executable evidence`);
  if (entry.successor.includes('/') && !entry.successor.includes(' ') && !existsSync(contained(entry.successor))) {
    throw new Error(`${entry.category} successor path is missing`);
  }
  for (const testPath of entry.evidenceTests) if (!existsSync(contained(testPath))) throw new Error(`${entry.category} evidence test is missing: ${testPath}`);
  if (entry.state.startsWith('retained-')) {
    if (entry.paths.length === 0 || entry.blockers.length === 0) throw new Error(`${entry.category} retained authority needs paths and exact blockers`);
    for (const path of entry.paths) if (!existsSync(contained(path))) throw new Error(`${entry.category} retained path is missing: ${path}`);
  } else if (entry.state === 'retired-with-rollback') {
    if (entry.category !== 'catalog-generator' || entry.blockers.length > 0 || entry.paths.some(path => existsSync(contained(path)))) {
      throw new Error(`${entry.category} retirement is inconsistent with repository state`);
    }
  } else if (entry.paths.length > 0 || entry.blockers.length > 0) throw new Error(`${entry.category} absent state cannot carry paths or blockers`);
}

const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
if (tracked.some(path => /(?:^|[/_.-])promtail(?:[/_.-]|$)/i.test(path))) throw new Error('tracked Promtail collector authority is undeclared');
const catalog = verifyCatalogAuthority();
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: 'verified', categories: categories.length,
  retiredAuthorities: catalog.retiredAuthorities, retainedAuthorities: manifest.authorities.filter(item => item.state.startsWith('retained-')).length,
  absentAuthorities: manifest.authorities.filter(item => item.state === 'absent').length })}\n`);
