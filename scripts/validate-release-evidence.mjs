#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); if (index < 0 || !args[index + 1]) throw new Error(`${flag} is required`); return args[index + 1]; };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  const spdxBytes = readFileSync(resolve(value('--spdx')));
  const spdx = JSON.parse(spdxBytes);
  const vex = JSON.parse(readFileSync(resolve(value('--exploitability')), 'utf8'));
  if (spdx['@context'] !== 'https://spdx.org/rdf/3.0.1/spdx-context.jsonld' || !Array.isArray(spdx['@graph'])) throw new Error('SPDX envelope is invalid');
  const ids = new Set();
  for (const element of spdx['@graph']) {
    const id = element.spdxId ?? element['@id'];
    if (typeof id !== 'string' || ids.has(id)) throw new Error('SPDX element identity is missing or duplicated');
    ids.add(id);
  }
  const document = spdx['@graph'].find((element) => element.type === 'SpdxDocument');
  const bom = spdx['@graph'].find((element) => element.type === 'software_Sbom');
  if (!document || !bom || document.profileConformance?.join(',') !== 'core,software') throw new Error('SPDX profile conformance is invalid');
  for (const reference of [...document.rootElement, ...document.element, ...bom.rootElement, ...bom.element]) if (!ids.has(reference)) throw new Error(`unresolved SPDX reference: ${reference}`);
  for (const file of spdx['@graph'].filter((element) => element.type === 'software_File')) {
    const hashes = file.verifiedUsing?.filter((method) => method.type === 'Hash' && method.algorithm === 'sha256' && /^[a-f0-9]{64}$/.test(method.hashValue));
    if (hashes?.length !== 1) throw new Error(`file lacks one SHA-256 integrity method: ${file.name}`);
  }
  if (vex.schemaVersion !== 1 || vex.kind !== 'desktop-tools-release-exploitability' || vex.spdx?.specVersion !== '3.0.1'
    || vex.spdx.sha256 !== digest(spdxBytes) || !Array.isArray(vex.assessments)) throw new Error('exploitability statement is not bound to SPDX bytes');
  const closure = Object.fromEntries(Object.entries(vex.releaseClosure?.artifacts ?? {}).sort());
  if (vex.releaseClosure?.sha256 !== digest(Buffer.from(`${JSON.stringify(closure)}\n`))) throw new Error('exploitability statement closure digest is invalid');
  process.stdout.write(`${JSON.stringify({ status: 'PASS', releaseId: vex.releaseId, files: spdx['@graph'].filter((element) => element.type === 'software_File').length, assessments: vex.assessments.length })}\n`);
} catch (error) {
  process.stderr.write(`release evidence rejected: ${error.message}\n`);
  process.exitCode = 1;
}
