#!/usr/bin/env node
// Strict source-catalog load-policy validation. Missing policy fields normalize
// to the deterministic lazy/default-lazy pair; eager exceptions must be
// explicit and must match their bounded preload classification.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const source = resolve(process.argv[2] || 'software.yml');
const classifications = new Map([
  ['bootstrap-critical', ['eager-bootstrap', 'bootstrap:scripts/provision.sh']],
  ['lazy-installer-substrate', ['eager-bootstrap', 'lazy-resolver:home/dot_config/shell/not-found-hook.sh']],
  ['security-recovery-prerequisite', ['eager-security-recovery', 'security-recovery:pre-lazy-offline']],
  ['desired-state-service', ['eager-service', 'desired-state:_serviceEnabled']],
  ['shell-profile-core', ['eager-supported-path', 'supported-path:shell-profile-core']],
  ['web-dev-core', ['eager-supported-path', 'supported-path:web-dev-core']],
  ['media-management-core', ['eager-supported-path', 'supported-path:media-management-core']],
  ['lsp-core', ['eager-supported-path', 'supported-path:lsp-core']],
]);

let document;
try {
  document = JSON.parse(execFileSync('yq', ['-o=json', '.', source], { encoding: 'utf8' }));
} catch (error) {
  process.stderr.write(`load-policy schema: cannot parse ${source}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const packages = document?.softwarePackages;
const problems = [];
if (packages === null || typeof packages !== 'object' || Array.isArray(packages)) {
  problems.push('softwarePackages must be a mapping');
} else {
  for (const [name, entry] of Object.entries(packages)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${name}: entry must be a mapping`);
      continue;
    }
    const eager = entry._preload === true;
    const hasPolicy = Object.hasOwn(entry, '_loadPolicy');
    const hasRationale = Object.hasOwn(entry, '_loadRationale');
    if (eager) {
      const expected = classifications.get(entry._preloadReason);
      if (!expected) {
        problems.push(`${name}: missing or invalid _preloadReason`);
        continue;
      }
      if (entry._loadPolicy !== expected[0]) {
        problems.push(`${name}: _loadPolicy must be ${JSON.stringify(expected[0])} for _preloadReason ${JSON.stringify(entry._preloadReason)}`);
      }
      if (entry._loadRationale !== expected[1]) {
        problems.push(`${name}: _loadRationale must be ${JSON.stringify(expected[1])} for _preloadReason ${JSON.stringify(entry._preloadReason)}`);
      }
    } else {
      if (Object.hasOwn(entry, '_preloadReason')) {
        problems.push(`${name}: _preloadReason requires _preload: true`);
      }
      if (hasPolicy !== hasRationale) {
        problems.push(`${name}: _loadPolicy and _loadRationale must be declared together`);
      } else if (hasPolicy && (entry._loadPolicy !== 'lazy' || entry._loadRationale !== 'default-lazy')) {
        problems.push(`${name}: explicit lazy policy must be _loadPolicy "lazy" with _loadRationale "default-lazy"`);
      }
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`load-policy schema conflicts (${problems.length}):\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`OK: ${Object.keys(packages).length} software entries have deterministic load policy\n`);
