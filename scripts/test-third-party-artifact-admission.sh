#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf 'first immutable bytes' >"$TMP/artifact-one"
printf 'changed immutable bytes' >"$TMP/artifact-two"

node --input-type=module - "$TMP" <<'NODE'
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const out = process.argv[2];
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync(`${out}/public.pem`, publicKey.export({ type: 'spki', format: 'pem' }));
for (const name of ['artifact-one', 'artifact-two']) writeFileSync(`${out}/${name}.sig`, sign(null, readFileSync(`${out}/${name}`), privateKey).toString('base64url'));
writeFileSync(`${out}/bad.sig`, sign(null, Buffer.from('different'), privateKey).toString('base64url'));
NODE

admit() {
  node "$ROOT/scripts/admit-third-party-artifact.mjs" --artifact "$1" --signature "$2" --public-key "$TMP/public.pem" \
    --store "$TMP/store" --upstream https://example.invalid/releases/latest/tool --source-ref releases/latest \
    --license Apache-2.0 --max-bytes 1024 "${@:3}"
}
PASS=0; FAIL=0
if admit "$TMP/artifact-one" "$TMP/artifact-one.sig" >"$TMP/one.json"; then PASS=$((PASS+1)); echo 'PASS admits signed artifact'; else FAIL=$((FAIL+1)); echo 'FAIL admits signed artifact'; fi
if admit "$TMP/artifact-two" "$TMP/artifact-two.sig" >"$TMP/two.json"; then PASS=$((PASS+1)); echo 'PASS admits changed mutable reference as new candidate'; else FAIL=$((FAIL+1)); echo 'FAIL admits changed mutable reference as new candidate'; fi
node --input-type=module - "$TMP" <<'NODE' && { PASS=$((PASS+1)); echo 'PASS retains both immutable candidates'; } || { FAIL=$((FAIL+1)); echo 'FAIL retains both immutable candidates'; }
import { readFileSync } from 'node:fs';
const out = process.argv[2];
const first = JSON.parse(readFileSync(`${out}/one.json`));
const second = JSON.parse(readFileSync(`${out}/two.json`));
const index = JSON.parse(readFileSync(`${out}/store/index.json`));
if (first.candidateId === second.candidateId || index.candidates.length !== 2) throw new Error('candidate history lost');
NODE
if admit "$TMP/artifact-one" "$TMP/bad.sig" >/dev/null 2>&1; then FAIL=$((FAIL+1)); echo 'FAIL rejects bad signature'; else PASS=$((PASS+1)); echo 'PASS rejects bad signature'; fi
if admit "$TMP/artifact-one" "$TMP/artifact-one.sig" --sha256 "$(printf '0%.0s' {1..64})" >/dev/null 2>&1; then FAIL=$((FAIL+1)); echo 'FAIL rejects bad checksum'; else PASS=$((PASS+1)); echo 'PASS rejects bad checksum'; fi
if node "$ROOT/scripts/admit-third-party-artifact.mjs" --artifact "$TMP/artifact-one" --signature "$TMP/artifact-one.sig" --public-key "$TMP/public.pem" --store "$TMP/other" --upstream https://example.invalid/tool --source-ref v1 --license 'not a license!' --max-bytes 1024 >/dev/null 2>&1; then FAIL=$((FAIL+1)); echo 'FAIL rejects invalid license'; else PASS=$((PASS+1)); echo 'PASS rejects invalid license'; fi
if node "$ROOT/scripts/admit-third-party-artifact.mjs" --artifact "$TMP/artifact-one" --signature "$TMP/artifact-one.sig" --public-key "$TMP/public.pem" --store "$TMP/other" --upstream https://example.invalid/tool --source-ref v1 --license MIT --max-bytes 2 >/dev/null 2>&1; then FAIL=$((FAIL+1)); echo 'FAIL rejects oversized artifact'; else PASS=$((PASS+1)); echo 'PASS rejects oversized artifact'; fi
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
