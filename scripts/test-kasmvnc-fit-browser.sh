#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/source" "$TMP/home/.config"
printf '<html><head></head><body>index</body></html>\n' > "$TMP/source/index.html"
printf '<html><head></head><body>screen</body></html>\n' > "$TMP/source/screen.html"
cat > "$TMP/home/.config/monitors.xml" <<'XML'
<monitors><configuration><logicalmonitor><monitor><mode><width>1920</width><height>1080</height></mode></monitor></logicalmonitor></configuration></monitors>
XML

HOME="$TMP/home" KASMVNC_SOURCE_WEBROOT="$TMP/source" KASMVNC_WEB_ROOT="$TMP/target" \
  bash "$ROOT/home/dot_local/bin/executable_kasmvnc-fit-browser" > "$TMP/output"

grep -q 'KASMVNC_GEOMETRY=1920x1080' "$TMP/output"
grep -q 'resize.*scale' "$TMP/target/index.html"
grep -q 'resize.*scale' "$TMP/target/screen.html"
[ "$(grep -c 'install-doctor-default-local-scaling' "$TMP/target/index.html")" -eq 1 ]

HOME="$TMP/home" KASMVNC_SOURCE_WEBROOT="$TMP/source" KASMVNC_WEB_ROOT="$TMP/target" \
  bash "$ROOT/home/dot_local/bin/executable_kasmvnc-fit-browser" >/dev/null
[ "$(grep -c 'install-doctor-default-local-scaling' "$TMP/target/index.html")" -eq 1 ]
printf 'PASS kasmvnc-fit-browser\n'
