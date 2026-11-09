#!/usr/bin/env node
import { lstat, open, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { importMarkdown } from '@install-doctor/aid-core';
import { serializePortableProfileExport } from '@install-doctor/aid-core/profile-export';
import { createCatalogBoundProfileExport } from '../dist/portable-profile.js';

function usage(message) {
  throw new Error(`${message}; usage: desktop-tools-profile-export export --environment /abs/ENVIRONMENT.md --machine id --facts /abs/facts.json --catalog /abs/catalog.json --release-manifest /abs/manifest --release-signature /abs/manifest.sig --release-id ID --signer-id ID --signer-public-key /abs/key.pub --output /abs/profile.json`);
}

function parse(argv) {
  if (argv.shift() !== 'export') usage('expected export command');
  const allowed = new Set(['environment', 'machine', 'facts', 'catalog', 'release-manifest', 'release-signature', 'release-id', 'signer-id', 'signer-public-key', 'output']);
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
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(values['release-id'])) usage('invalid release id');
  if (!/^desktop-[a-z0-9][a-z0-9._-]{0,119}$/.test(values['signer-id'])) usage('invalid signer id');
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
  const manifestFile = await boundedFile(values['release-manifest'], 16_384, 'release manifest');
  const signatureFile = await boundedFile(values['release-signature'], 8_192, 'release signature');
  const publicKeyFile = await boundedFile(values['signer-public-key'], 8_192, 'signer public key');
  const publicKey = publicKeyFile.bytes.toString('utf8').trim();
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/.test(publicKey)) throw new Error('signer public key is invalid');
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
    release: { manifestPath: manifestFile.path, signaturePath: signatureFile.path,
      trust: { keyId: values['signer-id'], publicKey }, expectedReleaseId: values['release-id'] },
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
