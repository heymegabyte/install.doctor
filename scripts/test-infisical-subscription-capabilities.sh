#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/config/infisical/subscription-capabilities.json"

node --input-type=module - "$FILE" <<'NODE'
import { readFile } from 'node:fs/promises';

const value = JSON.parse(await readFile(process.argv[2], 'utf8'));
const exact = (object, keys, label) => {
  if (!object || typeof object !== 'object' || Array.isArray(object)
    || JSON.stringify(Object.keys(object).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has an invalid field set`);
  }
};
exact(value, ['schemaVersion', 'observedAt', 'authority', 'subscription', 'mechanisms', 'fallbacks', 'mutation', 'purchaseOrTierChange'], 'capability record');
if (value.schemaVersion !== 1 || value.mutation !== 'none' || value.purchaseOrTierChange !== 'none') throw new Error('discovery must remain read-only');
if (Number.isNaN(Date.parse(value.observedAt))) throw new Error('observedAt must be an RFC 3339 instant');
exact(value.authority, ['cliVersion', 'service', 'readOnlyEndpoints', 'organizationIdentifierRecorded', 'credentialMaterialRecorded'], 'authority');
if (!/^0\.43\.\d+$/.test(value.authority.cliVersion) || value.authority.service !== 'https://app.infisical.com'
  || value.authority.organizationIdentifierRecorded !== false || value.authority.credentialMaterialRecorded !== false) throw new Error('authority must be secret-safe and version-bound');
if (value.subscription.planName !== 'Free' || value.subscription.state !== 'no-subscription'
  || value.subscription.activeProductEntitlements.length !== 0) throw new Error('record must match the observed subscription');
const ids = new Set();
for (const mechanism of value.mechanisms) {
  exact(mechanism, ['id', 'status', 'reason'], `mechanism ${mechanism.id ?? '<unknown>'}`);
  if (ids.has(mechanism.id) || !['canary-required', 'not-subscribed'].includes(mechanism.status)
    || typeof mechanism.reason !== 'string' || mechanism.reason.length < 40) throw new Error('mechanisms must be unique, explicit, and evidenced');
  ids.add(mechanism.id);
}
for (const required of ['static-secret-read', 'universal-auth', 'github-oidc', 'project-rbac', 'dynamic-secrets', 'temporary-access', 'gateways', 'sso-mfa-enforcement', 'audit-log-streaming']) {
  if (!ids.has(required)) throw new Error(`missing mechanism ${required}`);
}
if (value.fallbacks.length !== 3 || value.fallbacks.some((fallback) => !fallback.when || !fallback.action
  || /controller.*fallback/i.test(fallback.action))) throw new Error('fallbacks must preserve isolation and fail-closed authority');
console.log(`PASS Infisical subscription discovery is read-only, secret-safe, and explicit (${ids.size} mechanisms)`);
NODE
