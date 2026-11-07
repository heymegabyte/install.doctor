#!/usr/bin/env bash
# Generate either a host package inventory or an exact release-bound CycloneDX SBOM.
set -euo pipefail
export LC_ALL=C

OUTPUT_FILE=""
COMPACT=false
RELEASE_DIR=""
RELEASE_ID=""
SOURCE_COMMIT=""
CREATED_AT=""

usage() {
  cat >&2 <<'EOF'
usage: generate-sbom.sh [--compact] [--file PATH]
       generate-sbom.sh --release-dir DIR --release-id ID --source-commit SHA \
         --created-at RFC3339 [--compact] [--file PATH]
EOF
  exit 64
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --compact) COMPACT=true; shift ;;
    --file|--release-dir|--release-id|--source-commit|--created-at)
      [ "$#" -ge 2 ] || usage
      case "$1" in
        --file) OUTPUT_FILE="$2" ;;
        --release-dir) RELEASE_DIR="$2" ;;
        --release-id) RELEASE_ID="$2" ;;
        --source-commit) SOURCE_COMMIT="$2" ;;
        --created-at) CREATED_AT="$2" ;;
      esac
      shift 2
      ;;
    --file=*|--release-dir=*|--release-id=*|--source-commit=*|--created-at=*)
      value="${1#*=}"
      case "$1" in
        --file=*) OUTPUT_FILE="$value" ;;
        --release-dir=*) RELEASE_DIR="$value" ;;
        --release-id=*) RELEASE_ID="$value" ;;
        --source-commit=*) SOURCE_COMMIT="$value" ;;
        --created-at=*) CREATED_AT="$value" ;;
      esac
      shift
      ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

command -v node >/dev/null 2>&1 || { printf 'node is required to generate an SBOM\n' >&2; exit 69; }

emit() {
  if [ -n "$OUTPUT_FILE" ]; then
    [ ! -d "$OUTPUT_FILE" ] || { printf 'SBOM output must not be a directory\n' >&2; exit 73; }
    umask 077
    if $COMPACT; then node -e 'const fs=require("node:fs");process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,"utf8")))+"\n")' >"$OUTPUT_FILE"
    else node -e 'const fs=require("node:fs");process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,"utf8")),null,2)+"\n")' >"$OUTPUT_FILE"
    fi
    printf 'SBOM written to %s\n' "$OUTPUT_FILE" >&2
  elif $COMPACT; then
    node -e 'const fs=require("node:fs");process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,"utf8")))+"\n")'
  else
    node -e 'const fs=require("node:fs");process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,"utf8")),null,2)+"\n")'
  fi
}

if [ -n "$RELEASE_DIR" ]; then
  [ -n "$RELEASE_ID" ] && [ -n "$SOURCE_COMMIT" ] && [ -n "$CREATED_AT" ] || usage
  case "$RELEASE_ID" in ''|[!a-z0-9]*|*[!a-z0-9._-]*) printf 'invalid release identifier\n' >&2; exit 65 ;; esac
  case "$SOURCE_COMMIT" in *[!0-9a-f]*|'') printf 'invalid source commit\n' >&2; exit 65 ;; esac
  [ "${#SOURCE_COMMIT}" -eq 40 ] || { printf 'invalid source commit\n' >&2; exit 65; }

  RELEASE_DIR="$RELEASE_DIR" RELEASE_ID="$RELEASE_ID" SOURCE_COMMIT="$SOURCE_COMMIT" CREATED_AT="$CREATED_AT" node <<'NODE' | emit
const { createHash } = require('node:crypto');
const { lstatSync, readFileSync, readdirSync, realpathSync } = require('node:fs');
const { join, relative, sep } = require('node:path');

const releaseDir = process.env.RELEASE_DIR;
const releaseId = process.env.RELEASE_ID;
const sourceCommit = process.env.SOURCE_COMMIT;
const createdAt = process.env.CREATED_AT;
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(createdAt) || Number.isNaN(Date.parse(createdAt))) {
  throw new Error('created-at must be canonical RFC3339 UTC');
}
const rootStat = lstatSync(releaseDir);
if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('release directory must be a real directory');
const root = realpathSync(releaseDir);
const files = [];
const walk = directory => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`release directory contains a symbolic link: ${relative(root, path)}`);
    if (stat.isDirectory()) walk(path);
    else if (stat.isFile()) files.push({ path, size: stat.size });
    else throw new Error(`release directory contains a special file: ${relative(root, path)}`);
  }
};
walk(root);
files.sort((left, right) => {
  const a = relative(root, left.path).split(sep).join('/');
  const b = relative(root, right.path).split(sep).join('/');
  return a < b ? -1 : a > b ? 1 : 0;
});
const components = files.map(file => {
  const name = relative(root, file.path).split(sep).join('/');
  const digest = createHash('sha256').update(readFileSync(file.path)).digest('hex');
  return {
    type: 'file',
    name,
    'bom-ref': `file:${digest}:${encodeURIComponent(name)}`,
    hashes: [{ alg: 'SHA-256', content: digest }],
    properties: [{ name: 'install.doctor:file-size', value: String(file.size) }],
  };
});
const rootRef = `pkg:generic/install.doctor@${encodeURIComponent(releaseId)}?commit=${sourceCommit}`;
const identityDigest = createHash('sha1').update(JSON.stringify({ releaseId, sourceCommit, components })).digest('hex');
const uuid = `${identityDigest.slice(0, 8)}-${identityDigest.slice(8, 12)}-5${identityDigest.slice(13, 16)}-a${identityDigest.slice(17, 20)}-${identityDigest.slice(20, 32)}`;
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${uuid}`,
  version: 1,
  metadata: {
    timestamp: createdAt,
    tools: { components: [{ type: 'application', name: 'generate-sbom', group: 'install.doctor', version: '2.0.0' }] },
    component: {
      type: 'application',
      name: 'install.doctor-bootstrap-release',
      version: releaseId,
      'bom-ref': rootRef,
      properties: [{ name: 'install.doctor:source-commit', value: sourceCommit }],
    },
  },
  components,
  dependencies: [{ ref: rootRef, dependsOn: components.map(component => component['bom-ref']) }],
};
process.stdout.write(`${JSON.stringify(bom)}\n`);
NODE
  exit 0
fi

[ -z "$RELEASE_ID$SOURCE_COMMIT$CREATED_AT" ] || usage

# Host inventory mode is intentionally distinct from a release SBOM. It records
# every package reported by each available native manager; no arbitrary cap may
# silently omit the tail of a large workstation or server inventory.
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HOSTNAME_VALUE="$(hostname -s 2>/dev/null || printf unknown)"
RECORDS="$(mktemp "${TMPDIR:-/tmp}/install-doctor-host-sbom.XXXXXXXX")"
cleanup() { rm -f -- "$RECORDS"; }
trap cleanup EXIT HUP INT TERM

if command -v brew >/dev/null 2>&1; then
  brew list --versions 2>/dev/null | awk 'NF >= 2 { name=$1; $1=""; sub(/^ /, ""); print "brew\t" name "\t" $0 }' >>"$RECORDS"
fi
if command -v dpkg-query >/dev/null 2>&1; then
  dpkg-query -W -f='${Package}\t${Version}\n' 2>/dev/null | awk -F '\t' 'NF == 2 { print "deb\t" $1 "\t" $2 }' >>"$RECORDS"
fi
if command -v rpm >/dev/null 2>&1 && ! command -v dpkg-query >/dev/null 2>&1; then
  rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\n' 2>/dev/null | awk -F '\t' 'NF == 2 { print "rpm\t" $1 "\t" $2 }' >>"$RECORDS"
fi

TIMESTAMP="$TIMESTAMP" HOSTNAME_VALUE="$HOSTNAME_VALUE" RECORDS="$RECORDS" node <<'NODE' | emit
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const records = readFileSync(process.env.RECORDS, 'utf8').split('\n').filter(Boolean).map(line => {
  const [manager, name, ...versionParts] = line.split('\t');
  const version = versionParts.join('\t');
  return { manager, name, version };
}).sort((a, b) => `${a.manager}\0${a.name}\0${a.version}`.localeCompare(`${b.manager}\0${b.name}\0${b.version}`, 'en'));
const components = records.map(({ manager, name, version }) => ({
  type: 'library', name, version,
  purl: `pkg:${manager}/${encodeURIComponent(name)}@${encodeURIComponent(version)}`,
}));
const digest = createHash('sha1').update(JSON.stringify(components)).digest('hex');
const uuid = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
process.stdout.write(`${JSON.stringify({
  bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: `urn:uuid:${uuid}`, version: 1,
  metadata: {
    timestamp: process.env.TIMESTAMP,
    tools: { components: [{ type: 'application', name: 'generate-sbom', group: 'install.doctor', version: '2.0.0' }] },
    component: { type: 'application', name: 'install.doctor-host-inventory', 'bom-ref': `install.doctor-host:${process.env.HOSTNAME_VALUE}` },
  },
  components,
})}\n`);
NODE
