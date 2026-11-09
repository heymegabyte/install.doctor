#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { importMarkdown } from '@install-doctor/aid-core';
import { serializePortableProfileExport } from '@install-doctor/aid-core/profile-export';
import { createCatalogBoundProfileExport } from '../dist/portable-profile.js';

function usage(message) {
  throw new Error(`${message}; usage: desktop-tools-profile-export export --environment /abs/ENVIRONMENT.md --machine id --facts /abs/facts.json --catalog /abs/catalog.json --catalog-sha256 <sha256> --output /abs/profile.json`);
}

function parse(argv) {
  if (argv.shift() !== 'export') usage('expected export command');
  const allowed = new Set(['environment', 'machine', 'facts', 'catalog', 'catalog-sha256', 'output']);
  const values = Object.create(null);
  while (argv.length > 0) {
    const flag = argv.shift(); const value = argv.shift();
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) usage('options must be --name value pairs');
    const name = flag.slice(2);
    if (!allowed.has(name) || values[name] !== undefined) usage(`unsupported or repeated option ${flag}`);
    values[name] = value;
  }
  for (const name of allowed) if (values[name] === undefined) usage(`missing --${name}`);
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(values.machine)) usage('invalid machine id');
  if (!/^[a-f0-9]{64}$/.test(values['catalog-sha256'])) usage('invalid catalog digest');
  return values;
}

async function boundedFile(pathInput, maximum, label) {
  if (!isAbsolute(pathInput) || pathInput.includes('\0')) usage(`${label} path must be absolute`);
  const path = resolve(pathInput);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size < 1 || metadata.size > maximum) throw new Error(`${label} must be one bounded regular file`);
  return { path, bytes: await readFile(path) };
}

async function main(argv) {
  const values = parse([...argv]);
  const environmentFile = await boundedFile(values.environment, 2_000_000, 'environment');
  const factsFile = await boundedFile(values.facts, 262_144, 'facts');
  const catalogFile = await boundedFile(values.catalog, 8_388_608, 'catalog');
  let facts;
  try { facts = JSON.parse(factsFile.bytes.toString('utf8')); } catch { throw new Error('facts must be valid JSON'); }
  const environmentText = environmentFile.bytes.toString('utf8');
  let environment;
  try { environment = importMarkdown(environmentText); } catch (markdownError) {
    try { environment = JSON.parse(environmentText); } catch { throw markdownError; }
  }
  const profile = await createCatalogBoundProfileExport({
    environment,
    machineId: values.machine,
    facts,
    catalogBytes: catalogFile.bytes,
    catalogSha256: values['catalog-sha256'],
  });
  if (!isAbsolute(values.output) || values.output.includes('\0')) usage('output path must be absolute');
  const output = resolve(values.output);
  const handle = await open(output, 'wx', 0o600);
  try {
    await handle.writeFile(await serializePortableProfileExport(profile));
    await handle.sync();
  } finally { await handle.close(); }
  return { schemaVersion: 1, output, exportDigest: profile.exportDigest, catalogSha256: profile.catalog.sha256 };
}

main(process.argv.slice(2))
  .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch(error => { process.stderr.write(`desktop-tools-profile-export: ${error instanceof Error ? error.message : 'unknown failure'}\n`); process.exitCode = 1; });
