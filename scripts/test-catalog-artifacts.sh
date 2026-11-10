#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GENERATOR="$ROOT/packages/control-plane/scripts/gen-catalog.mjs"
VALIDATOR="$ROOT/scripts/validate-catalog.py"
FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT

SOURCE="$FIXTURE_ROOT/software.yml"
OUTPUT="$FIXTURE_ROOT/catalog.json"

make_source() {
  cp "$ROOT/software.yml" "$SOURCE"
  SOURCE="$SOURCE" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.env.SOURCE;
const source = readFileSync(path, 'utf8');
const marker = '  ack:\n';
const artifact = `  ack:\n    _artifacts:\n    - schemaVersion: 1\n      id: ack\n      version: 3.7.0\n      platform: { os: linux, arch: x64 }\n      source:\n        url: https://github.com/beyondgrep/ack3/releases/download/v3.7.0/ack-v3.7.0-linux-x64\n        sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n        sizeBytes: 12345\n      destination: { root: user-bin, filename: ack, mode: '0700' }\n`;
if (!source.includes(marker)) throw new Error('ack fixture marker missing');
const artifactOnly = `\n  fixture-artifact:\n    _name: Fixture Artifact\n    _bin: fixture-artifact\n    _artifacts:\n    - schemaVersion: 1\n      id: fixture-artifact\n      version: 1.0.0\n      platform: { os: win32, arch: x64 }\n      source:\n        url: https://github.com/example/fixture/releases/download/v1.0.0/fixture-artifact.exe\n        sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n        sizeBytes: 23456\n      destination: { root: user-bin, filename: fixture-artifact.exe, mode: '0700' }\n`;
writeFileSync(path, source.replace(marker, artifact) + artifactOnly);
NODE
}

make_source
node "$GENERATOR" "$SOURCE" "$OUTPUT" >/dev/null
python3 "$VALIDATOR" "$OUTPUT" >/dev/null
cp "$OUTPUT" "$FIXTURE_ROOT/catalog.first.json"
node "$GENERATOR" "$SOURCE" "$OUTPUT" >/dev/null
cmp "$FIXTURE_ROOT/catalog.first.json" "$OUTPUT"
python3 - "$OUTPUT" <<'PY'
import json, sys
items = json.load(open(sys.argv[1], encoding="utf-8"))
ack = next(item for item in items if item["name"] == "ack" and item["bin"] == "ack")
assert ack["artifacts"] == [{
    "schemaVersion": 1,
    "id": "ack",
    "version": "3.7.0",
    "platform": {"os": "linux", "arch": "x64"},
    "source": {
        "url": "https://github.com/beyondgrep/ack3/releases/download/v3.7.0/ack-v3.7.0-linux-x64",
        "sha256": "a" * 64,
        "sizeBytes": 12345,
    },
    "destination": {"root": "user-bin", "filename": "ack", "mode": "0700"},
}]
artifact_only = next(item for item in items if item["name"] == "fixture-artifact")
assert artifact_only["bin"] == "fixture-artifact"
assert artifact_only["providers"] == []
assert artifact_only["pkgs"] == {}
assert artifact_only["platforms"] == ["windows"]
assert artifact_only["artifacts"][0]["id"] == "fixture-artifact"
rclone = next(item for item in items if item["name"] == "rclone")
assert rclone["systemIdentityReconciliation"] is True
assert rclone["configured"] is True
assert rclone["postInstall"] == "post-rclone.sh"
# A legacy hook is not execution authority and must not be advertised as an
# automated configuration step until it adopts the signed typed-hook protocol.
atuin = next(item for item in items if item["name"] == "atuin")
assert "configured" not in atuin
assert "postInstall" not in atuin
vim = next(item for item in items if item["name"] == "vim")
assert vim["configured"] is True
assert vim["postInstall"] == "post-vim.sh"
nginx = next(item for item in items if item["name"] == "nginx")
assert nginx["configured"] is True
assert nginx["postInstall"] == "post-nginx.sh"
ripgrep = next(item for item in items if item["name"] == "ripgrep")
assert "systemIdentityReconciliation" not in ripgrep
PY

# A dependency is hard install authority. Generation must reject an unresolved
# reference rather than publishing a catalog that fails on every target.
SOURCE="$SOURCE" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.env.SOURCE;
const source = readFileSync(path, 'utf8');
const marker = '  ack:\n';
if (!source.includes(marker)) throw new Error('ack fixture marker missing');
writeFileSync(path, source.replace(marker, '  ack:\n    _deps:\n    - missing-runtime-dependency\n'));
NODE
if node "$GENERATOR" "$SOURCE" "$OUTPUT" >/dev/null 2>&1; then
  printf 'FAIL generator accepted an unresolved runtime dependency\n' >&2
  exit 1
fi

# Unknown descriptor fields are rejected by the shared strict schema.
make_source
sed -i.bak "/sizeBytes: 12345/a\\
        unexpected: true" "$SOURCE"
if node "$GENERATOR" "$SOURCE" "$OUTPUT" >/dev/null 2>&1; then
  printf 'FAIL generator accepted an unknown artifact field\n' >&2
  exit 1
fi

# Descriptor ownership is part of the catalog boundary, not merely the reusable shape.
make_source
sed -i.bak 's/      id: ack$/      id: another-tool/' "$SOURCE"
if node "$GENERATOR" "$SOURCE" "$OUTPUT" >/dev/null 2>&1; then
  printf 'FAIL generator accepted a cross-package artifact id\n' >&2
  exit 1
fi

# A mutable GitHub release alias must never become executable catalog authority.
make_source
sed -i.bak 's@/download/v3.7.0/@/download/latest/@' "$SOURCE"
if node "$GENERATOR" "$SOURCE" "$OUTPUT" >/dev/null 2>&1; then
  printf 'FAIL generator accepted a mutable artifact URL\n' >&2
  exit 1
fi

# The standalone deploy gate independently rejects malformed generated descriptors.
cp "$ROOT/packages/control-plane/src/catalog.json" "$OUTPUT"
OUTPUT="$OUTPUT" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.env.OUTPUT;
const items = JSON.parse(readFileSync(path, 'utf8'));
items[0].artifacts = [{ schemaVersion: 1, id: items[0].name }];
writeFileSync(path, JSON.stringify(items) + '\n');
NODE
if python3 "$VALIDATOR" "$OUTPUT" >/dev/null 2>&1; then
  printf 'FAIL validator accepted a malformed artifact descriptor\n' >&2
  exit 1
fi

# Direct validation from a clean tree deterministically builds the canonical
# contract instead of failing with an opaque missing-dist import.
ISOLATED="$FIXTURE_ROOT/isolated"
mkdir -p "$ISOLATED/scripts" "$ISOLATED/packages/aid-core"
cp "$ROOT/scripts/validate-catalog-artifacts.mjs" "$ISOLATED/scripts/"
cp "$ROOT/packages/aid-core/package.json" "$ROOT/packages/aid-core/package-lock.json" "$ISOLATED/packages/aid-core/"
cp -R "$ROOT/packages/aid-core/src" "$ISOLATED/packages/aid-core/"
ln -s "$ROOT/packages/aid-core/node_modules" "$ISOLATED/packages/aid-core/node_modules"
printf '[]\n' > "$ISOLATED/catalog.json"
node "$ISOLATED/scripts/validate-catalog-artifacts.mjs" "$ISOLATED/catalog.json" >/dev/null
test -f "$ISOLATED/packages/aid-core/dist/installer-contracts.js"

printf 'catalog-artifacts: 9 passed, 0 failed\n'
