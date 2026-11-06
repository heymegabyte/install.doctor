#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AID_CORE = resolve(ROOT, 'packages', 'aid-core');
const CONTRACT = resolve(AID_CORE, 'dist', 'installer-contracts.js');
const CONTRACT_SOURCE = resolve(AID_CORE, 'src', 'installer-contracts.ts');
let schemaPromise;

async function loadSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      if (!existsSync(CONTRACT) || statSync(CONTRACT_SOURCE).mtimeMs > statSync(CONTRACT).mtimeMs) {
        try {
          execFileSync('npm', ['run', 'build'], { cwd: AID_CORE, stdio: 'inherit' });
        } catch (error) {
          throw new Error('immutable artifact contract is unavailable; run `cd packages/aid-core && npm install && npm run build`', { cause: error });
        }
      }
      try {
        const module = await import(pathToFileURL(CONTRACT).href);
        return module.ImmutableArtifactDescriptorSchema;
      } catch (error) {
        throw new Error('immutable artifact contract could not be loaded; run `cd packages/aid-core && npm install && npm run build`', { cause: error });
      }
    })();
  }
  return schemaPromise;
}

export async function validateArtifactDeclarations(declarations) {
  const schema = await loadSchema();
  const byPackage = new Map();
  for (const declaration of declarations) {
    if (!declaration || typeof declaration.key !== 'string' || !Array.isArray(declaration.artifacts)
      || declaration.artifacts.length < 1 || declaration.artifacts.length > 16) {
      throw new Error('catalog _artifacts must be a non-empty array of at most 16 descriptors');
    }
    const artifacts = declaration.artifacts.map((value, index) => {
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new Error(`invalid _artifacts descriptor for ${declaration.key}[${index}]: ${parsed.error.issues[0]?.message ?? 'invalid descriptor'}`);
      }
      if (parsed.data.id !== declaration.key) {
        throw new Error(`artifact id ${parsed.data.id} does not match catalog key ${declaration.key}`);
      }
      return parsed.data;
    });
    const tuple = ({ platform }) => `${platform.os}/${platform.arch}`;
    const tuples = artifacts.map(tuple);
    if (new Set(tuples).size !== tuples.length) {
      throw new Error(`catalog _artifacts for ${declaration.key} contains a duplicate platform tuple`);
    }
    artifacts.sort((left, right) => tuple(left).localeCompare(tuple(right)));
    byPackage.set(declaration.key, artifacts);
  }
  return byPackage;
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('usage: validate-catalog-artifacts.mjs <catalog.json>');
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(catalog)) throw new Error('catalog is not a JSON array');
  const declarations = catalog
    .filter((entry) => entry && Object.hasOwn(entry, 'artifacts'))
    .map((entry) => ({ key: entry.name, artifacts: entry.artifacts }));
  const validated = await validateArtifactDeclarations(declarations);
  for (const declaration of declarations) {
    if (JSON.stringify(declaration.artifacts) !== JSON.stringify(validated.get(declaration.key))) {
      throw new Error(`catalog artifacts for ${declaration.key} are not in canonical platform order`);
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`catalog artifact validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
