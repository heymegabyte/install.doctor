#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`${flag} is required`);
  return args[index + 1];
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const releaseDirectory = resolve(value('--release-dir'));
const releaseId = value('--release-id');
const sourceCommit = value('--source-commit');
const createdAt = value('--created-at');
const output = resolve(value('--output'));
if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(releaseId)) throw new Error('release identifier is invalid');
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('source commit is invalid');
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(createdAt) || Number.isNaN(Date.parse(createdAt))) throw new Error('created-at must be canonical RFC3339 UTC without fractional seconds');
const rootInfo = lstatSync(releaseDirectory);
if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('release directory must be a real directory');
const root = realpathSync(releaseDirectory);
const files = [];
const walk = (directory) => {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error(`release closure contains a symlink: ${relative(root, path)}`);
    if (info.isDirectory()) walk(path);
    else if (info.isFile()) files.push({ path, size: info.size });
    else throw new Error(`release closure contains a special file: ${relative(root, path)}`);
  }
};
walk(root);
files.sort((left, right) => relative(root, left.path).localeCompare(relative(root, right.path), 'en'));
const namespace = `https://desktop.tools/spdx/releases/${encodeURIComponent(releaseId)}`;
const creation = '_:creationinfo';
const supplier = `${namespace}#organization-desktop-tools`;
const documentId = namespace;
const bomId = `${namespace}#sbom`;
const packageId = `${namespace}#package`;
const elements = files.map(({ path, size }) => {
  const name = relative(root, path).split(sep).join('/');
  const digest = sha256(readFileSync(path));
  return {
    type: 'software_File', spdxId: `${namespace}#file-${digest}-${encodeURIComponent(name)}`,
    creationInfo: creation, name, software_primaryPurpose: name.endsWith('.json') ? 'source' : 'other',
    builtTime: createdAt, originatedBy: [supplier],
    verifiedUsing: [{ type: 'Hash', algorithm: 'sha256', hashValue: digest }],
    comment: `release closure size=${size}`,
  };
});
const fileIds = elements.map(({ spdxId }) => spdxId);
const relationshipId = `${namespace}#relationship-contains`;
const document = {
  '@context': 'https://spdx.org/rdf/3.0.1/spdx-context.jsonld',
  '@graph': [
    { type: 'CreationInfo', '@id': creation, createdBy: [supplier], specVersion: '3.0.1', created: createdAt },
    { type: 'Organization', spdxId: supplier, creationInfo: creation, name: 'Desktop Tools' },
    { type: 'SpdxDocument', spdxId: documentId, creationInfo: creation, rootElement: [bomId],
      element: [bomId, supplier, packageId, relationshipId, ...fileIds], profileConformance: ['core', 'software'],
      comment: 'AI and Dataset profiles are not applicable: this closure contains no model weights or training datasets.' },
    { type: 'software_Sbom', spdxId: bomId, creationInfo: creation, rootElement: [packageId],
      element: [packageId, relationshipId, ...fileIds], software_sbomType: ['build'] },
    { type: 'software_Package', spdxId: packageId, creationInfo: creation, name: 'desktop-tools-release',
      software_packageVersion: releaseId, software_downloadLocation: `https://desktop.tools/releases/${encodeURIComponent(releaseId)}/`,
      software_primaryPurpose: 'application', builtTime: createdAt, releaseTime: createdAt, suppliedBy: supplier,
      originatedBy: [supplier], software_sourceInfo: `git+https://github.com/heymegabyte/install.doctor@${sourceCommit}` },
    ...elements,
    { type: 'Relationship', spdxId: relationshipId, creationInfo: creation, from: packageId,
      relationshipType: 'contains', to: fileIds, completeness: 'complete' },
  ],
};
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
process.stdout.write(`${JSON.stringify({ output, files: files.length, sha256: sha256(readFileSync(output)) })}\n`);
