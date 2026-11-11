#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

node --input-type=module - "$TMP" "$ROOT" <<'NODE'
import { generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { canonicalBytes, keyIdFor, ROLES } from './scripts/lib/release-metadata.mjs';
const [out] = process.argv.slice(2);
const pairs = Array.from({ length: 2 }, () => generateKeyPairSync('ed25519'));
const publicKeys = pairs.map(({ publicKey }) => publicKey.export({ type: 'spki', format: 'pem' }).toString());
const ids = publicKeys.map(keyIdFor);
const keys = Object.fromEntries(ids.map((id, index) => [id, { algorithm: 'ed25519', publicKey: publicKeys[index] }]));
const roles = Object.fromEntries(ROLES.map((role) => [role, { keyIds: ids, threshold: role === 'root' ? 2 : 1 }]));
const envelope = (role, version = 3) => ({
  schemaVersion: 1, role, version, expiresAt: '2030-01-01T00:00:00.000Z',
  signed: { productId: 'desktop-tools', role, subject: { releaseId: role === 'root' ? null : 'r1', platform: role === 'platform' ? 'linux-x64' : null, channel: role === 'channel' ? 'stable' : null }, payload: role === 'root' ? { keys, roles } : { parentRole: 'root', parentVersion: 3, parentDigest: 'a'.repeat(64), sequence: 8, artifacts: [], claims: {} } },
  signatures: [],
});
const seal = (metadata, indexes) => { metadata.signatures = indexes.map((index) => ({ keyId: ids[index], algorithm: 'ed25519', signature: sign(null, canonicalBytes(metadata), pairs[index].privateKey).toString('base64url') })); return metadata; };
const root = seal(envelope('root'), [0, 1]);
const valid = seal(envelope('targets'), [0]);
writeFileSync(`${out}/root.json`, JSON.stringify(root));
writeFileSync(`${out}/valid.json`, JSON.stringify(valid));
const fixture = (name, edit, resign = true) => { const value = structuredClone(valid); edit(value); if (resign) seal(value, [0]); writeFileSync(`${out}/${name}.json`, JSON.stringify(value)); };
fixture('expired', (value) => { value.expiresAt = '2020-01-01T00:00:00.000Z'; });
fixture('rollback', (value) => { value.version = 1; });
fixture('role-substitution', (value) => { value.signed.role = 'channel'; });
fixture('subject-substitution', (value) => { value.signed.subject.releaseId = 'r2'; });
fixture('unknown-field', (value) => { value.signed.payload.surprise = true; });
fixture('tampered', (value) => { value.signed.payload.sequence = 9; }, false);
writeFileSync(`${out}/threshold.json`, JSON.stringify({ ...root, signatures: root.signatures.slice(0, 1) }));
NODE

PASS=0; FAIL=0
accept() { if node "$ROOT/scripts/verify-release-metadata.mjs" "$@" >/dev/null 2>&1; then PASS=$((PASS+1)); printf 'PASS accepts %s\n' "$1"; else FAIL=$((FAIL+1)); printf 'FAIL accepts %s\n' "$1"; fi; }
reject() { if node "$ROOT/scripts/verify-release-metadata.mjs" "$@" >/dev/null 2>&1; then FAIL=$((FAIL+1)); printf 'FAIL rejects %s\n' "$1"; else PASS=$((PASS+1)); printf 'PASS rejects %s\n' "$1"; fi; }
accept valid --metadata "$TMP/valid.json" --trusted-root "$TMP/root.json" --now 2028-01-01T00:00:00Z --minimum-version 2 --release-id r1
accept root-threshold --metadata "$TMP/root.json" --now 2028-01-01T00:00:00Z
reject expired --metadata "$TMP/expired.json" --trusted-root "$TMP/root.json" --now 2028-01-01T00:00:00Z
reject rollback --metadata "$TMP/rollback.json" --trusted-root "$TMP/root.json" --now 2028-01-01T00:00:00Z --minimum-version 2
reject role-substitution --metadata "$TMP/role-substitution.json" --trusted-root "$TMP/root.json" --now 2028-01-01T00:00:00Z
reject subject-substitution --metadata "$TMP/subject-substitution.json" --trusted-root "$TMP/root.json" --now 2028-01-01T00:00:00Z --release-id r1
reject unknown-field --metadata "$TMP/unknown-field.json" --trusted-root "$TMP/root.json" --now 2028-01-01T00:00:00Z
reject tampered --metadata "$TMP/tampered.json" --trusted-root "$TMP/root.json" --now 2028-01-01T00:00:00Z
reject threshold --metadata "$TMP/threshold.json" --now 2028-01-01T00:00:00Z
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
