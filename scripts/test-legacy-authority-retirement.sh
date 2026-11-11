#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0 FAIL=0
pass(){ PASS=$((PASS+1)); printf 'PASS %s\n' "$1"; }
fail(){ FAIL=$((FAIL+1)); printf 'FAIL %s\n' "$1"; }

if node "$ROOT/scripts/verify-legacy-authority-retirement.mjs" >"$TMP/report"; then pass 'current authority retirement ledger verifies'; else fail 'current authority retirement ledger verifies'; fi
jq -e '.status=="verified" and .categories==7 and .retiredAuthorities==2 and .retainedAuthorities==5 and .absentAuthorities==1' "$TMP/report" >/dev/null \
  && pass 'report distinguishes retired, retained, and absent authorities' || fail 'report distinguishes retired, retained, and absent authorities'

node --input-type=module - "$ROOT/config/legacy-authority-retirement.json" "$TMP" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const source=JSON.parse(readFileSync(process.argv[2],'utf8')), out=process.argv[3];
const emit=(name,edit)=>{const value=structuredClone(source);edit(value);writeFileSync(`${out}/${name}.json`,JSON.stringify(value));};
emit('premature-retirement', value=>{const row=value.authorities.find(item=>item.category==='writer');row.state='retired-with-rollback';row.blockers=[];});
emit('missing-rollback', value=>{const row=value.authorities.find(item=>item.category==='catalog-generator');row.evidenceTests=[];});
emit('hidden-compatibility', value=>{value.authorities=value.authorities.filter(item=>item.category!=='compatibility-shim');});
NODE
for fixture in premature-retirement missing-rollback hidden-compatibility; do
  if node "$ROOT/scripts/verify-legacy-authority-retirement.mjs" "$TMP/$fixture.json" >/dev/null 2>&1; then fail "rejects $fixture"; else pass "rejects $fixture"; fi
done

printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
