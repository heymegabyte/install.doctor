#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

node --input-type=module - "$TMP" <<'NODE'
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { canonicalBytes, keyIdFor, ROLES } from './scripts/lib/release-metadata.mjs';
const out = process.argv[2];
const pairs = Array.from({ length: 3 }, () => generateKeyPairSync('ed25519'));
const publicKeys = pairs.map(({ publicKey }) => publicKey.export({ type: 'spki', format: 'pem' }).toString());
const ids = publicKeys.map(keyIdFor);
const key = (index) => [ids[index], { algorithm: 'ed25519', publicKey: publicKeys[index] }];
const roles = (keyIds) => Object.fromEntries(ROLES.map((role) => [role, { keyIds, threshold: role === 'root' ? 2 : 1 }]));
const root = (version, indexes) => ({ schemaVersion: 1, role: 'root', version, expiresAt: '2030-01-01T00:00:00.000Z', signed: { productId: 'desktop-tools', role: 'root', subject: { releaseId: null, platform: null, channel: null }, payload: { keys: Object.fromEntries(indexes.map(key)), roles: roles(indexes.map((index) => ids[index])) } }, signatures: [] });
const signWith = (value, indexes) => { value.signatures = indexes.map((index) => ({ keyId: ids[index], algorithm: 'ed25519', signature: sign(null, canonicalBytes(value), pairs[index].privateKey).toString('base64url') })); return value; };
const current = signWith(root(1, [0, 1]), [0, 1]);
const next = signWith(root(2, [0, 1, 2]), [0, 1, 2]);
const parentDigest = createHash('sha256').update(canonicalBytes(next)).digest('hex');
const revocation = { schemaVersion: 1, role: 'revocation', version: 1, expiresAt: '2030-01-01T00:00:00.000Z', signed: { productId: 'desktop-tools', role: 'revocation', subject: { releaseId: null, platform: null, channel: null }, payload: { parentRole: 'root', parentVersion: 2, parentDigest, sequence: 1, artifacts: [], claims: { effectiveAt: '2028-01-01T00:00:00.000Z', reason: 'emergency signer compromise', revokedKeyIds: [ids[0]] } } }, signatures: [] };
signWith(revocation, [1]);
for (const [name, value] of Object.entries({ current, next, revocation })) writeFileSync(`${out}/${name}.json`, JSON.stringify(value));
const noNew = signWith(root(2, [0, 1]), [0, 1]); writeFileSync(`${out}/no-new.json`, JSON.stringify(noNew));
const noOverlap = signWith(root(2, [1, 2]), [1, 2]); writeFileSync(`${out}/no-overlap.json`, JSON.stringify(noOverlap));
const unknown = structuredClone(revocation); unknown.signed.payload.claims.revokedKeyIds = ['f'.repeat(64)]; signWith(unknown, [1]); writeFileSync(`${out}/unknown.json`, JSON.stringify(unknown));
NODE

PASS=0; FAIL=0
run() { node "$ROOT/scripts/verify-release-key-ceremony.mjs" --current-root "$TMP/current.json" --next-root "$1" --revocation "$2" --now 2028-02-01T00:00:00Z >/dev/null 2>&1; }
if run "$TMP/next.json" "$TMP/revocation.json"; then PASS=$((PASS+1)); echo 'PASS valid rotation and revocation'; else FAIL=$((FAIL+1)); echo 'FAIL valid rotation and revocation'; fi
for fixture in no-new no-overlap; do if run "$TMP/$fixture.json" "$TMP/revocation.json"; then FAIL=$((FAIL+1)); echo "FAIL rejects $fixture"; else PASS=$((PASS+1)); echo "PASS rejects $fixture"; fi; done
if run "$TMP/next.json" "$TMP/unknown.json"; then FAIL=$((FAIL+1)); echo 'FAIL rejects unknown revoked key'; else PASS=$((PASS+1)); echo 'PASS rejects unknown revoked key'; fi
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
