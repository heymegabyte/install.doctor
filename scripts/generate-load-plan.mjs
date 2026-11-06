#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { buildLoadPlan } from '../packages/installer-engine/dist/lazy-plan.js';

const { values } = parseArgs({
  strict: true,
  allowPositionals: false,
  options: {
    platform: { type: 'string' },
    architecture: { type: 'string' },
    role: { type: 'string', multiple: true, default: [] },
    package: { type: 'string', multiple: true, default: [] },
    service: { type: 'string', multiple: true, default: [] },
    'supported-path': { type: 'string', multiple: true, default: [] },
    resolver: { type: 'string', multiple: true, default: [] },
  },
});

if (!values.platform) throw new Error('--platform is required');
if (!values.architecture) throw new Error('--architecture is required');
const catalogUrl = new URL('../packages/control-plane/src/catalog.json', import.meta.url);
const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
const report = buildLoadPlan({
  schemaVersion: 1,
  platform: values.platform,
  architecture: values.architecture,
  roles: values.role,
  selectedPackages: values.package,
  selectedServices: values.service,
  selectedSupportedPaths: values['supported-path'],
  lazyResolverRequirements: values.resolver,
  catalog,
});
process.stdout.write(`${JSON.stringify(report)}\n`);
