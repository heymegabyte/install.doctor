#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUDIT="$ROOT/scripts/audit-desktop-tools-program.mjs"
MANIFEST="$ROOT/config/desktop-tools-program.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); printf 'PASS %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "$1"; }
assert_ok() { if "$@" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }

node "$AUDIT" --manifest "$MANIFEST" >"$TMP/one.json" || exit 1
node "$AUDIT" --manifest "$MANIFEST" >"$TMP/two.json" || exit 1
cmp -s "$TMP/one.json" "$TMP/two.json" && ok "report is deterministic" || bad "report is deterministic"

node --input-type=module - "$TMP/one.json" <<'NODE' && ok "ledger, authorities, gates, ownership, and horizons are coherent" || bad "ledger, authorities, gates, ownership, and horizons are coherent"
import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (report.summary.initiatives !== 50) throw new Error('initiative count');
for (const domain of ['release', 'host-mutation', 'identity', 'operational-secrets', 'desired-state', 'observed-state', 'telemetry', 'data-protection', 'ui', 'platform-evidence']) {
  if (!report.authorities.some((entry) => entry.domain === domain)) throw new Error(`missing ${domain}`);
}
if (report.authorities.find((entry) => entry.domain === 'desired-state').authority === report.authorities.find((entry) => entry.domain === 'observed-state').authority) throw new Error('authority collision');
if (!report.admissionGates.some((gate) => gate.status === 'BLOCKED') || !report.admissionGates.some((gate) => gate.status === 'UNVERIFIED')) throw new Error('gate states');
if (!report.initiatives.some((item) => item.effectiveStatus === 'BLOCKED') || !report.initiatives.some((item) => item.effectiveStatus === 'planned')) throw new Error('independent work state');
if (!report.owners.every((owner) => owner.tasksDigest && owner.total > 0)) throw new Error('owner evidence freshness');
if (!report.horizons.some((horizon) => horizon.status === 'waiting-on-dependency') || !report.horizons.some((horizon) => horizon.ready.length > 0)) throw new Error('critical path');
if (!report.initiatives.every((item) => item.completionEligible === false)) throw new Error('unevidenced completion eligibility');
for (const item of report.initiatives) {
  for (const dimension of ['code', 'deployment', 'host', 'verification']) {
    if (item.completionEvidence[dimension].status !== 'MISSING') throw new Error(`unexpected ${item.id} ${dimension} evidence`);
  }
}
NODE

node --input-type=module - "$MANIFEST" "$TMP" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const source = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3];
const emit = (name, edit) => { const value = structuredClone(source); edit(value); writeFileSync(`${out}/${name}.json`, `${JSON.stringify(value)}\n`); };
emit('owner-array', (value) => { value.initiatives[0].ownerChange = ['invalid']; });
emit('authority-collision', (value) => { value.authorities[1].domain = value.authorities[0].domain; });
emit('unevidenced-pass', (value) => { value.admissionGates[0].status = 'PASS'; });
emit('unknown-owner', (value) => { value.initiatives[0].ownerChange = 'missing-change'; });
emit('complete-without-evidence', (value) => { value.initiatives[0].status = 'complete'; });
emit('planning-as-evidence', (value) => {
  value.completionEvidence.push({ id: 'fake-planning', initiativeId: 'I01', dimension: 'code',
    evidenceClass: 'source-attestation', path: 'openspec/changes/desktop-tools-50-initiative-program/tasks.md',
    sha256: '0'.repeat(64), target: 'desktop-tools', observedAt: '2026-11-10T00:00:00.000Z', expiresAt: null });
});
NODE
for fixture in owner-array authority-collision unevidenced-pass unknown-owner complete-without-evidence planning-as-evidence; do
  if node "$AUDIT" --manifest "$TMP/$fixture.json" >/dev/null 2>&1; then bad "rejects $fixture"; else ok "rejects $fixture"; fi
done

grep -q 'Planning and contracts are not shipped capability' "$ROOT/docs/desktop-tools/program.md" && ok "documentation preserves capability truth boundary" || bad "documentation preserves capability truth boundary"
grep -q 'Completion is a four-part claim' "$ROOT/docs/desktop-tools/program.md" && ok "documentation requires four-dimensional completion evidence" || bad "documentation requires four-dimensional completion evidence"

printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
