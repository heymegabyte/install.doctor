#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/test-linux.yml"
MATRIX="$ROOT/scripts/platform-support-matrix.json"
HARNESS="$ROOT/scripts/test-all.sh"

node - "$WORKFLOW" "$MATRIX" "$HARNESS" <<'NODE'
const fs = require('node:fs');

const workflow = fs.readFileSync(process.argv[2], 'utf8');
const support = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const harness = fs.readFileSync(process.argv[4], 'utf8');
const failures = [];
const requireMatch = (pattern, message) => {
  if (!pattern.test(workflow)) failures.push(message);
};

const include = workflow.match(/^[ \t]+include:\s*\n([\s\S]*?)^[ \t]+container:\s*$/m)?.[1] ?? '';
const rows = [...include.matchAll(/^\s*- cell: ([a-z0-9-]+)\s*\n\s*image: ([^\s]+@sha256:[a-f0-9]{64})\s*\n\s*osId: ([a-z0-9-]+)\s*\n\s*version: "?([A-Za-z0-9.]+)"?\s*\n\s*architecture: (x86_64)\s*\n\s*role: ([a-z0-9-]+)\s*$/gm)]
  .map(match => ({ cell: match[1], image: match[2], osId: match[3], version: match[4], architecture: match[5], role: match[6] }));

const expected = [
  { cell: 'ubuntu-22-04-x64-container', osId: 'ubuntu', version: '22.04', architecture: 'x86_64', role: 'ubuntu' },
  { cell: 'ubuntu-24-04-x64-container', osId: 'ubuntu', version: '24.04', architecture: 'x86_64', role: 'ubuntu' },
  { cell: 'debian-12-x64-container', osId: 'debian', version: '12', architecture: 'x86_64', role: 'debian' },
  { cell: 'fedora-44-x64-container', osId: 'fedora', version: '44', architecture: 'x86_64', role: 'fedora' },
  { cell: 'arch-rolling-x64-container', osId: 'arch', version: 'rolling', architecture: 'x86_64', role: 'arch' },
];
const normalizedRows = rows.map(({ image: _image, ...row }) => row);
if (JSON.stringify(normalizedRows) !== JSON.stringify(expected)) {
  failures.push(`container matrix must exactly match declared best-effort Linux container cells; observed ${JSON.stringify(normalizedRows)}`);
}
for (const row of rows) {
  const cell = support.cells.find(candidate => candidate.id === row.cell);
  if (!cell || cell.status !== 'best-effort' || cell.environment !== 'container' || cell.arch !== 'x64' || cell.role !== row.role) {
    failures.push(`${row.cell} must be an exact best-effort x64 container cell with role ${row.role}`);
  }
  if (!cell?.evidence.some(item => item.kind === 'workflow-definition' && item.path === '.github/workflows/test-linux.yml')) {
    failures.push(`${row.cell} must cite this workflow as definition-only evidence`);
  }
}

if (rows.some(row => !/@sha256:[a-f0-9]{64}$/.test(row.image))) failures.push('every container image must be immutable by digest');
for (const forbidden of ['alpine', 'centos', 'opensuse', 'fedora-39', 'fedora-41', 'latest']) {
  if (rows.some(row => row.cell.includes(forbidden) || row.image.includes(`${forbidden}:`))) failures.push(`${forbidden} must not be an active successful install tuple`);
}
if (/^\s*test-vm:/m.test(workflow)) failures.push('unversioned mutable VM jobs must not masquerade as exact support cells');

requireMatch(/name: Assert observed container tuple[\s\S]*EXPECTED_OS_ID: \$\{\{ matrix\.osId \}\}[\s\S]*EXPECTED_VERSION: \$\{\{ matrix\.version \}\}[\s\S]*EXPECTED_ARCHITECTURE: \$\{\{ matrix\.architecture \}\}/,
  'workflow must bind every declared tuple to an observed platform assertion');
requireMatch(/observed_id=.*\/etc\/os-release/, 'platform assertion must observe distro identity from /etc/os-release');
requireMatch(/observed_version=.*\/etc\/os-release/, 'platform assertion must observe distro version from /etc/os-release');
requireMatch(/observed_architecture="\$\(uname -m\)"/, 'platform assertion must observe machine architecture');
requireMatch(/\[ -f \/\.dockerenv \]/, 'platform assertion must prove container execution');
requireMatch(/\[ "\$observed_id" = "\$EXPECTED_OS_ID" \]/, 'platform assertion must reject an unexpected distro');
requireMatch(/\[ "\$observed_version" = "\$EXPECTED_VERSION" \]/, 'platform assertion must reject an unexpected distro version');
requireMatch(/\[ "\$observed_architecture" = "\$EXPECTED_ARCHITECTURE" \]/, 'platform assertion must reject an unexpected architecture');
requireMatch(/name: Assert support-matrix admission[\s\S]*status == "best-effort"/, 'workflow must validate the checked-out support authority before provisioning');
requireMatch(/name: "Structural checks — \$\{\{ matrix\.cell \}\}"/, 'structural job name must identify its evidence class');
requireMatch(/name: "Best-effort checked-out bootstrap smoke — \$\{\{ matrix\.cell \}\} \(not signed lifecycle proof\)"/,
  'bootstrap smoke must explicitly disclaim signed lifecycle proof');
requireMatch(/INSTALL_DOCTOR_CONSENT_PRIVILEGED=true[\s\S]*INSTALL_DOCTOR_CONSENT_BEST_EFFORT=true/,
  'best-effort smoke must provide explicit privileged and best-effort consent');
if (/curl[^\n]*install\.doctor\/start/.test(workflow)) failures.push('structural PR CI must execute the checked-out revision, not mutable production');
if (/status:\s*verified|full-lifecycle canary|canary-receipt/.test(workflow)) failures.push('structural workflow must not mint or claim verified lifecycle evidence');
if (!/test-linux\.sh\|test-macos\.sh\)\s+echo harness/.test(harness) || !/\[ "\$req" = harness \]/.test(harness)) {
  failures.push('test-all must skip platform orchestration harnesses instead of invoking them as zero-argument suites');
}

if (failures.length > 0) {
  console.error('Linux CI platform contract rejected:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Linux CI platform contract valid: ${rows.map(row => row.cell).join(', ')}`);
NODE

printf 'linux-ci-platform-contract: 1 passed, 0 failed\n'
