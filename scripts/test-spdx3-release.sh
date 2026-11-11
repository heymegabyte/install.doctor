#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/release"
printf 'payload\n' >"$TMP/release/tool"
printf '{"tool":"%s"}\n' "$(shasum -a 256 "$TMP/release/tool" | awk '{print $1}')" >"$TMP/closure.json"
printf '[]\n' >"$TMP/assessments.json"

node "$ROOT/scripts/generate-spdx3-release.mjs" --release-dir "$TMP/release" --release-id test-release \
  --source-commit 0123456789abcdef0123456789abcdef01234567 --created-at 2028-01-01T00:00:00Z --output "$TMP/release.spdx.json"
node "$ROOT/scripts/generate-release-exploitability.mjs" --release-id test-release --created-at 2028-01-01T00:00:00Z \
  --spdx "$TMP/release.spdx.json" --closure-digests "$TMP/closure.json" --assessments "$TMP/assessments.json" --output "$TMP/release.exploitability.json"
node "$ROOT/scripts/validate-release-evidence.mjs" --spdx "$TMP/release.spdx.json" --exploitability "$TMP/release.exploitability.json"

# Validate against the pinned official SPDX 3.0.1 structural schema. The digest prevents a mutable remote schema substitution.
node --input-type=module - "$TMP/schema.json" <<'NODE'
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const response = await fetch('https://spdx.org/schema/3.0.1/spdx-json-schema.json');
if (!response.ok) throw new Error(`SPDX schema fetch failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== '582c64e809d5b3ef9bd0c4de13a32391b47b0284a3e8d199569fb96f649234b1') throw new Error('SPDX schema digest changed');
await writeFile(process.argv[2], bytes, { flag: 'wx' });
NODE
npx --yes ajv-cli@5.0.0 validate --spec=draft2020 -s "$TMP/schema.json" -d "$TMP/release.spdx.json"

cp "$TMP/release.exploitability.json" "$TMP/tampered.json"
node --input-type=module - "$TMP/tampered.json" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2]; const value = JSON.parse(readFileSync(path)); value.spdx.sha256 = '0'.repeat(64); writeFileSync(path, JSON.stringify(value));
NODE
if node "$ROOT/scripts/validate-release-evidence.mjs" --spdx "$TMP/release.spdx.json" --exploitability "$TMP/tampered.json" >/dev/null 2>&1; then
  echo 'FAIL accepted a mismatched SPDX digest' >&2; exit 1
fi
printf 'spdx3-release: 6 passed, 0 failed\n'
