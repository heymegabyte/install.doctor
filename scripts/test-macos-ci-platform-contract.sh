#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/test-macos.yml"
MATRIX="$ROOT/scripts/platform-support-matrix.json"

node - "$WORKFLOW" "$MATRIX" <<'NODE'
const fs = require('node:fs');

const workflow = fs.readFileSync(process.argv[2], 'utf8');
const support = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const failures = [];
const requireMatch = (pattern, message) => {
  if (!pattern.test(workflow)) failures.push(message);
};

const include = workflow.match(/^[ \t]+include:\s*\n([\s\S]*?)^[ \t]+steps:\s*$/m)?.[1] ?? '';
const rows = [...include.matchAll(/^\s*- osMajor: "([0-9]+)"\s*\n\s*architecture: (arm64|x64)\s*\n\s*unameArchitecture: (arm64|x86_64)\s*\n\s*runner: ([a-z0-9-]+)\s*$/gm)]
  .map(match => ({ osMajor: match[1], architecture: match[2], unameArchitecture: match[3], runner: match[4] }));

const expected = [
  { osMajor: '15', architecture: 'arm64', unameArchitecture: 'arm64', runner: 'macos-15' },
  { osMajor: '15', architecture: 'x64', unameArchitecture: 'x86_64', runner: 'macos-15-intel' },
];
if (JSON.stringify(rows) !== JSON.stringify(expected)) {
  failures.push(`matrix must declare exactly the current macOS 15 ARM64 and Intel tuples; observed ${JSON.stringify(rows)}`);
}

const runnerArchitectures = new Map();
for (const row of rows) {
  const prior = runnerArchitectures.get(row.runner);
  if (prior && prior !== row.unameArchitecture) failures.push(`${row.runner} claims both ${prior} and ${row.unameArchitecture}`);
  runnerArchitectures.set(row.runner, row.unameArchitecture);
}

requireMatch(/name: Assert observed platform tuple[\s\S]*EXPECTED_OS_MAJOR: \$\{\{ matrix\.osMajor \}\}[\s\S]*EXPECTED_UNAME_ARCHITECTURE: \$\{\{ matrix\.unameArchitecture \}\}/,
  'workflow must bind each declared tuple to the platform assertion step');
requireMatch(/observed_version="\$\(sw_vers -productVersion\)"/, 'platform assertion must observe macOS with sw_vers');
requireMatch(/observed_architecture="\$\(uname -m\)"/, 'platform assertion must observe machine architecture with uname -m');
requireMatch(/\[ "\$observed_major" = "\$EXPECTED_OS_MAJOR" \]/, 'platform assertion must reject an unexpected macOS major');
requireMatch(/\[ "\$observed_architecture" = "\$EXPECTED_UNAME_ARCHITECTURE" \]/, 'platform assertion must reject an unexpected architecture');
requireMatch(/name: "Structural checks — macOS \$\{\{ matrix\.osMajor \}\} \$\{\{ matrix\.architecture \}\}"/,
  'job name must report the asserted tuple rather than an unverified prose label');
requireMatch(/uses: actions\/setup-node@[a-f0-9]{40}[\s\S]*node-version: 24\.22\.2/,
  'workflow must use the pinned supported Node runtime');
requireMatch(/uses: actions\/setup-python@[a-f0-9]{40}[\s\S]*python-version: 3\.13\.11/,
  'workflow must use a pinned Python runtime with cross-architecture PyYAML wheels');
requireMatch(/name: Install pinned test prerequisites[\s\S]*PyYAML==6\.0\.3[\s\S]*packages\/aid-core ci[\s\S]*packages\/installer-engine ci[\s\S]*packages\/control-plane ci/,
  'workflow must install YAML support and locked package test dependencies');
if (/CONTROL_PLANE_URL:\s*https?:\/\//.test(workflow)) failures.push('revision tests must not depend on a mutable production control plane');
requireMatch(/name: "Best-effort checked-out platform admission — macOS \$\{\{ matrix\.osMajor \}\} \$\{\{ matrix\.architecture \}\} \(not signed lifecycle proof\)"[\s\S]*idResolvePlatform[\s\S]*idAuthorizePlatform[\s\S]*INSTALL_DOCTOR_PLATFORM_CELL.*EXPECTED_CELL/,
  'workflow must execute checked-out read-only platform admission and disclaim signed lifecycle proof');
if (/bash scripts\/provision\.sh\s*$/m.test(workflow)) failures.push('unsigned macOS jobs must not invoke full provisioning without a verified release closure');
if (/macos-14/.test(workflow)) failures.push('retired macos-14 runner labels must not remain in the active workflow');

const activeIds = new Set(rows.map(row => `macos-${row.osMajor}-${row.architecture}-native`));
for (const id of activeIds) {
  const cell = support.cells.find(candidate => candidate.id === id);
  if (!cell || cell.status !== 'best-effort' || !cell.evidence.some(item => item.kind === 'workflow-definition' && item.path === '.github/workflows/test-macos.yml')) {
    failures.push(`${id} must be an explicit best-effort cell backed by this workflow definition`);
  }
}
for (const cell of support.cells.filter(candidate => candidate.os === 'macOS')) {
  const citesWorkflow = cell.evidence.some(item => item.kind === 'workflow-definition' && item.path === '.github/workflows/test-macos.yml');
  if (citesWorkflow && !activeIds.has(cell.id)) failures.push(`${cell.id} cites the workflow but has no active asserted job`);
}

if (failures.length > 0) {
  console.error('macOS CI platform contract rejected:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`macOS CI platform contract valid: ${rows.map(row => `${row.osMajor}/${row.architecture}@${row.runner}`).join(', ')}`);
NODE

printf 'macos-ci-platform-contract: 1 passed, 0 failed\n'
