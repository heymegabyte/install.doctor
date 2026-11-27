#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
launcher="$root/home/dot_local/bin/executable_infisical-workload-run"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/infisical-workload-run.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin"

cat >"$fixture/manifest.json" <<'JSON'
{"schemaVersion":1,"workloads":[{"id":"test-service","identityId":"identity-test-service","projectId":"00000000-0000-4000-8000-000000000001","environment":"prod","secretPath":"/workloads/test-service","principal":{"kind":"service","authMode":"workload-identity","provider":"infisical"},"delivery":"environment","secrets":[{"secretName":"TEST_PASSWORD","environmentVariable":"APP_PASSWORD"}]}]}
JSON
cat >"$fixture/bin/infisical" <<'SH'
#!/bin/sh
[ "$1" = secrets ] && [ "$2" = get ] && [ "$3" = TEST_PASSWORD ] || exit 1
[ "$4" = --projectId ] && [ "$5" = 00000000-0000-4000-8000-000000000001 ] && [ "$6" = --env ] && [ "$7" = prod ] || exit 2
[ "$8" = --path ] && [ "$9" = /workloads/test-service ] && [ "${10}" = --plain ] || exit 3
printf '%s' 'test-value'
SH
chmod 700 "$fixture/bin/infisical"

PATH="$fixture/bin:$PATH" UNRELATED_TOKEN='parent-leak' INFISICAL_TOKEN='bootstrap-leak' PLAIN_SETTING='preserved' \
  node "$launcher" --manifest "$fixture/manifest.json" --workload test-service -- \
  node -e 'const fs=require("node:fs");if(process.env.APP_PASSWORD!=="test-value"||process.env.UNRELATED_TOKEN||process.env.INFISICAL_TOKEN||process.env.PLAIN_SETTING!=="preserved")process.exit(8);fs.writeFileSync(process.argv[1],"ok")' \
  "$fixture/result"
test "$(cat "$fixture/result")" = ok

cat >"$fixture/bin/infisical" <<'SH'
#!/bin/sh
exit 1
SH
if PATH="$fixture/bin:$PATH" node "$launcher" --manifest "$fixture/manifest.json" --workload test-service -- sh -c "touch '$fixture/should-not-exist'" >/dev/null 2>&1; then
  echo 'launcher accepted an unavailable declared secret' >&2
  exit 1
fi
test ! -e "$fixture/should-not-exist"

echo 'infisical workload launcher tests passed'
