#!/usr/bin/env bash
# Phase-A control-plane skeleton gate.
#   build gate : `wrangler deploy --dry-run` bundles the Hono Worker (fails if src/imports break).
#   prod  gate : if CONTROL_PLANE_URL is set, assert the live skeleton — /health 200 {status:ok},
#                /api/ai/v1/<known-route> 501 (provider wiring pending), /api/ai/v1/<bogus> 404.
# The Worker imports aid-core's route contracts (ROUTES/chooseRoute) by relative path so
# esbuild bundles them — no workspace link needed. See docs/aid/MASTER-PROMPT.md §2,§8,§17.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CP="$ROOT/packages/control-plane"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0; F=0

say "control-plane skeleton"

if [ ! -f "$CP/wrangler.toml" ] || [ ! -f "$CP/src/index.ts" ]; then
  fail "control-plane not scaffolded (packages/control-plane/{wrangler.toml,src/index.ts})"
else
  pass "control-plane scaffolded"
  # build gate: dry-run bundles the Worker (needs hono installed + wrangler available via npx)
  if ( cd "$CP" && npx --yes wrangler deploy --dry-run --outdir /tmp/cp-dist ) >/tmp/cp-build.log 2>&1; then
    pass "wrangler dry-run build OK"
  else
    fail "wrangler dry-run build failed (see /tmp/cp-build.log)"; tail -5 /tmp/cp-build.log 2>/dev/null
  fi
fi

if [ -n "${CONTROL_PLANE_URL:-}" ]; then
  u="${CONTROL_PLANE_URL%/}"
  code="$(curl -fsS -o /tmp/cp-health.json -w '%{http_code}' "$u/health" 2>/dev/null || echo 000)"
  if [ "$code" = 200 ] && grep -q '"status":"ok"' /tmp/cp-health.json 2>/dev/null; then pass "GET /health 200 {status:ok}"; else fail "GET /health -> $code"; fi
  # browser surface (fire: app.install.doctor availability) — landing + pairing-approval page
  land="$(curl -s "$u/" 2>/dev/null)"
  { echo "$land" | grep -q 'install.doctor' && echo "$land" | grep -qi 'pair a machine'; } && pass "GET / -> landing page (aid + pairing instructions)" || fail "landing -> $(printf '%s' "$land" | head -c 80)"
  pairp="$(curl -s "$u/pair?code=ABC12345" 2>/dev/null)"
  { echo "$pairp" | grep -q 'ABC12345' && echo "$pairp" | grep -qi 'approve pairing'; } && pass "GET /pair?code -> shows code + approve surface" || fail "pair page -> $(printf '%s' "$pairp" | head -c 80)"
  pc="$(curl -s "$u/api/provider-config" 2>/dev/null)"
  echo "$pc" | jq -e '(.enabled_providers[0]=="install-doctor") and (.provider["install-doctor"].options.baseURL|test("/api/ai/v1$")) and (.provider["install-doctor"].options.apiKey=="{env:AID_INFERENCE_TOKEN}")' >/dev/null 2>&1 && pass "GET /api/provider-config -> OpenCode config (install-doctor provider, {env} apiKey — no secret)" || fail "provider-config -> $(printf '%s' "$pc" | head -c 140)"
  hp="$(curl -s "$u/history" 2>/dev/null)"
  { echo "$hp" | grep -qi 'fleet activity' && echo "$hp" | grep -q 'AID_ADMIN_TOKEN' && echo "$hp" | grep -qi 'Load history'; } && pass "GET /history -> fleet dashboard page (admin-token load of /api/history)" || fail "history page -> $(printf '%s' "$hp" | head -c 80)"
  # inference route pre-flight (fire #8): POST-only; restricted fails closed; fail-closed when unconfigured
  rc="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rc" = 503 ] && pass "POST /api/ai/v1/economy -> 503 (provider not configured, fail-closed)" || fail "economy POST -> $rc (want 503)"
  rr="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$u/api/ai/v1/restricted" 2>/dev/null || echo 000)"
  [ "$rr" = 451 ] && pass "POST /api/ai/v1/restricted -> 451 (restricted fails closed — no public gateway)" || fail "restricted POST -> $rr (want 451)"
  rg="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rg" = 405 ] && pass "GET /api/ai/v1/economy -> 405 (inference uses POST)" || fail "economy GET -> $rg (want 405)"
  rb="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/ai/v1/definitely-not-a-route" 2>/dev/null || echo 000)"
  [ "$rb" = 404 ] && pass "GET /api/ai/v1/<bogus> -> 404" || fail "bogus route -> $rb (want 404)"

  # cost-reservation gate (fire #9): fail-closed BEFORE any provider work
  rov="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"estimateMicros":300000}' "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rov" = 402 ] && pass "over-ceiling estimate -> 402 (cost reservation, fail-closed)" || fail "over-budget -> $rov (want 402)"
  rneg="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"estimateMicros":-1}' "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rneg" = 400 ] && pass "negative estimate -> 400 (Zod boundary)" || fail "negative estimate -> $rneg (want 400)"

  # routing-policy decisions — reuses aid-core chooseRoute at the HTTP boundary (no inference performed)
  rp(){ curl -s -X POST -H 'content-type: application/json' -d "$1" "$u/api/ai/v1/resolve" 2>/dev/null; }
  echo "$(rp '{}')"                                                                                | grep -q '"route":"economy"'    && pass "resolve {} -> economy (routine default)"          || fail "resolve {} -> $(rp '{}')"
  echo "$(rp '{"sensitivity":"restricted","kind":"code","verificationFailed":true,"allowPremium":true}')" | grep -q '"route":"restricted"' && pass "restricted fails closed (ignores premium)"    || fail "restricted not failing closed"
  echo "$(rp '{"kind":"architecture","allowPremium":false}')"                                      | grep -q '"route":"code"'      && pass "architecture w/o premium -> code (opt-in gate)"  || fail "architecture gate wrong"
  echo "$(rp '{"kind":"code","verificationFailed":true,"allowPremium":true}')"                      | grep -q '"route":"critical"'  && pass "verified-failure + premium -> critical"          || fail "escalation wrong"
  rbad="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"sensitivity":"bogus"}' "$u/api/ai/v1/resolve" 2>/dev/null || echo 000)"
  [ "$rbad" = 400 ] && pass "invalid body -> 400 (Zod boundary)" || fail "invalid body -> $rbad (want 400)"

  # ENVIRONMENT.md round-trip (S01 / MASTER-PROMPT §9) — aid-core validate/export/import/digest
  bpf="$(mktemp)"; mdf="$(mktemp)"
  cat > "$bpf" <<'JSON'
{"schemaVersion":1,"revision":"r1","appUrl":"https://app.install.doctor","routing":{"engine":"projectsites","preferredProvider":"deepseek","allowPremium":false,"maxTaskCostMicros":250000},"skills":{"repository":"heymegabyte/agent-skills","commit":"0000000000000000000000000000000000000000","include":["desktop-provisioning"]},"defaults":{"packages":["git","chezmoi","mise"],"shellHistory":"hishtory"},"machines":[{"id":"runner","os":"linux","role":"runner","packages":["alloy"]},{"id":"laptop","os":"darwin","role":"workstation","packages":[]}],"services":[{"id":"logs","kind":"loki","pushUrl":"https://logs.example.invalid/loki/api/v1/push","credentialRef":"infisical://fleet/loki","machineIds":["runner","laptop"]}],"privacy":{"shellAnalysis":"local","screenshots":"off","terminalInput":false,"productLearning":false}}
JSON
  vd="$(curl -s -X POST -H 'content-type: application/json' --data-binary @"$bpf" "$u/api/environment/validate" 2>/dev/null)"
  echo "$vd" | grep -q '"valid":true' && pass "env validate -> valid + digest" || fail "env validate -> $vd"
  d1="$(printf '%s' "$vd" | grep -oE '"digest":"[0-9a-f]+"' | head -1)"
  ec="$(curl -s -o "$mdf" -w '%{http_code}' -X POST -H 'content-type: application/json' --data-binary @"$bpf" "$u/api/environment/export" 2>/dev/null || echo 000)"
  { [ "$ec" = 200 ] && grep -q 'install-doctor+json' "$mdf"; } && pass "env export -> ENVIRONMENT.md markdown" || fail "env export -> $ec"
  id="$(curl -s -X POST -H 'content-type: text/markdown' --data-binary @"$mdf" "$u/api/environment/import" 2>/dev/null | grep -oE '"digest":"[0-9a-f]+"' | head -1)"
  { [ -n "$d1" ] && [ "$d1" = "$id" ]; } && pass "env round-trip lossless (import(export).digest == validate.digest)" || fail "round-trip digest mismatch ($d1 vs $id)"
  iv="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$u/api/environment/validate" 2>/dev/null || echo 000)"
  [ "$iv" = 400 ] && pass "env validate {} -> 400 (invalid blueprint)" || fail "invalid blueprint -> $iv (want 400)"

  # ENVIRONMENT.md diff (§9 Environment "Diff" action) — structured blueprint-vs-blueprint diff
  bpf2="$(mktemp)"; jq '.defaults.packages += ["ripgrep"]' "$bpf" > "$bpf2" 2>/dev/null
  same="$(curl -s -X POST -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" '{from:$a[0],to:$a[0]}')" "$u/api/environment/diff" 2>/dev/null)"
  echo "$same" | grep -q '"changed":false' && pass "env diff (identical) -> changed:false" || fail "diff identical -> $same"
  chg="$(curl -s -X POST -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" --slurpfile b "$bpf2" '{from:$a[0],to:$b[0]}')" "$u/api/environment/diff" 2>/dev/null)"
  { echo "$chg" | grep -q '"changed":true' && echo "$chg" | grep -q 'ripgrep'; } && pass "env diff (added package) -> changed:true + ripgrep" || fail "diff changed -> $chg"
  dbad="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"from":{},"to":{}}' "$u/api/environment/diff" 2>/dev/null || echo 000)"
  [ "$dbad" = 400 ] && pass "env diff (invalid blueprint) -> 400" || fail "diff invalid -> $dbad (want 400)"

  # persistence read path (§9) — D1-stored "current" blueprint (seeded _default)
  cur="$(curl -s "$u/api/environment/current?tenant=_default" 2>/dev/null)"
  echo "$cur" | grep -q '"digest"' && pass "env current (_default) -> stored blueprint + digest (D1 read)" || fail "env current _default -> $cur"
  nf="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/environment/current?tenant=__nope__" 2>/dev/null || echo 000)"
  [ "$nf" = 404 ] && pass "env current (unknown tenant) -> 404" || fail "env current unknown -> $nf (want 404)"

  # authed WRITE path (§9) — PUT /api/environment/current, optimistic revision-check, AID_ADMIN_TOKEN bearer.
  # Unauthed is rejected the moment the Worker secret is set (503 before it's set — honest SKIP, never a false pass).
  un="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'content-type: application/json' -d '{"tenant":"_test","blueprint":{}}' "$u/api/environment/current" 2>/dev/null || echo 000)"
  case "$un" in
    401) pass "PUT current (no bearer) -> 401 (fail-closed auth)";;
    503) skip "PUT current -> 503 (AID_ADMIN_TOKEN not yet set on Worker)";;
    *)   fail "PUT current (no bearer) -> $un (want 401)";;
  esac
  ADMIN="${AID_ADMIN_TOKEN:-}"; [ -z "$ADMIN" ] && ADMIN="$(get-secret AID_ADMIN_TOKEN 2>/dev/null || true)"; [ -z "$ADMIN" ] && [ -f "$CP/.aid-admin-token" ] && ADMIN="$(cat "$CP/.aid-admin-token" 2>/dev/null || true)"
  if [ -n "$ADMIN" ]; then
    wr="$(curl -s -X PUT -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" '{tenant:"_test",blueprint:$a[0]}')" "$u/api/environment/current" 2>/dev/null)"
    echo "$wr" | grep -q '"digest"' && pass "PUT current (bearer, valid) -> 200 + digest" || fail "authed PUT -> $wr"
    rb="$(curl -s "$u/api/environment/current?tenant=_test" 2>/dev/null)"
    echo "$rb" | grep -q '"revision":"r1"' && pass "GET current (_test) -> stored r1 (write persisted to D1)" || fail "read-back -> $rb"
    sc="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" '{tenant:"_test",expectedRevision:"STALE",blueprint:$a[0]}')" "$u/api/environment/current" 2>/dev/null || echo 000)"
    [ "$sc" = 409 ] && pass "PUT current (stale expectedRevision) -> 409 (optimistic lock)" || fail "stale revision -> $sc (want 409)"
    mc="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" '{tenant:"_test",expectedRevision:"r1",blueprint:$a[0]}')" "$u/api/environment/current" 2>/dev/null || echo 000)"
    [ "$mc" = 200 ] && pass "PUT current (matching expectedRevision r1) -> 200" || fail "matching revision -> $mc (want 200)"
    ib="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"tenant":"_test","blueprint":{}}' "$u/api/environment/current" 2>/dev/null || echo 000)"
    [ "$ib" = 400 ] && pass "PUT current (authed, invalid blueprint) -> 400" || fail "authed invalid -> $ib (want 400)"
  else
    skip "AID_ADMIN_TOKEN unset (env + get-secret) — authed PUT assertions skipped"
  fi

  # apply-PREVIEW (§9 / S02,S03,S12) — reconciliation plan observed->desired, dry-run, no mutation.
  # Derive a known-good observed from the seeded _default (GET current -> import markdown -> blueprint),
  # so these run unauthenticated + deterministic every fire.
  dmd="$(curl -s "$u/api/environment/current?tenant=_default" 2>/dev/null | jq -r '.markdown')"
  obp="$(printf '%s' "$dmd" | curl -s -X POST -H 'content-type: text/markdown' --data-binary @- "$u/api/environment/import" 2>/dev/null | jq -c '.blueprint')"
  if [ -n "$obp" ] && [ "$obp" != "null" ]; then
    noop="$(curl -s -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" '{tenant:"_default",observed:$o}')" "$u/api/environment/apply" 2>/dev/null)"
    echo "$noop" | jq -e '.dryRun==true and .applied==false and .plan.total==0 and .plan.noop==true' >/dev/null 2>&1 && pass "apply (observed==desired _default) -> dryRun plan, 0 changes (noop)" || fail "apply noop -> $noop"
    obp2="$(printf '%s' "$obp" | jq -c '.defaults.packages += ["zzz-drift-probe"]')"
    drift="$(curl -s -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp2" '{tenant:"_default",observed:$o}')" "$u/api/environment/apply" 2>/dev/null)"
    { echo "$drift" | jq -e '.plan.remove>=1' >/dev/null 2>&1 && echo "$drift" | grep -q 'zzz-drift-probe'; } && pass "apply (observed has extra pkg) -> plan.remove>=1 + names the drift" || fail "apply drift -> $drift"
    na="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" '{tenant:"_default",observed:$o,dryRun:false}')" "$u/api/environment/apply" 2>/dev/null || echo 000)"
    [ "$na" = 501 ] && pass "apply dryRun:false -> 501 (mutation needs the on-device supervisor, Phase B)" || fail "apply real -> $na (want 501)"
    ua="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" '{tenant:"__nope__",observed:$o}')" "$u/api/environment/apply" 2>/dev/null || echo 000)"
    [ "$ua" = 404 ] && pass "apply (unknown tenant, no desired) -> 404" || fail "apply no-desired -> $ua (want 404)"
  else
    fail "apply-preview setup — could not derive observed blueprint from _default (import returned '$obp')"
  fi
  ia="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"tenant":"_default","observed":{}}' "$u/api/environment/apply" 2>/dev/null || echo 000)"
  [ "$ia" = 400 ] && pass "apply (invalid observed) -> 400 (Zod boundary)" || fail "apply invalid -> $ia (want 400)"

  # device identity lifecycle (Phase B / S04 enrollment, S27 revocation) — enroll(admin)->me->revoke->denied.
  eun="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"tenant":"_test"}' "$u/api/devices/enroll" 2>/dev/null || echo 000)"
  case "$eun" in
    401) pass "enroll (no admin bearer) -> 401 (fail-closed)";;
    503) skip "enroll -> 503 (AID_ADMIN_TOKEN not set on Worker)";;
    *)   fail "enroll (no bearer) -> $eun (want 401)";;
  esac
  mbog="$(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer aid_bogus_nonexistent_token' "$u/api/devices/me" 2>/dev/null || echo 000)"
  [ "$mbog" = 401 ] && pass "devices/me (unknown token) -> 401" || fail "me bogus -> $mbog (want 401)"
  dcn="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/device/current" 2>/dev/null || echo 000)"
  [ "$dcn" = 401 ] && pass "device/current (no bearer) -> 401" || fail "device/current no-bearer -> $dcn (want 401)"
  dan="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"observed":{}}' "$u/api/device/apply" 2>/dev/null || echo 000)"
  [ "$dan" = 401 ] && pass "device/apply (no bearer) -> 401" || fail "device/apply no-bearer -> $dan (want 401)"
  rpn="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"kind":"run"}' "$u/api/device/report" 2>/dev/null || echo 000)"
  [ "$rpn" = 401 ] && pass "device/report (no bearer) -> 401" || fail "report no-bearer -> $rpn (want 401)"
  hsn="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/device/history" 2>/dev/null || echo 000)"
  [ "$hsn" = 401 ] && pass "device/history (no bearer) -> 401" || fail "history no-bearer -> $hsn (want 401)"
  ahn="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/history?tenant=_default" 2>/dev/null || echo 000)"
  [ "$ahn" = 401 ] && pass "GET /api/history (no admin bearer) -> 401 (fail-closed)" || fail "admin history no-bearer -> $ahn (want 401)"

  # browser-first PAIRING (fire #19 / S04) — start (unauthenticated) + poll-before-approval + bad polls
  pstart="$(curl -s -X POST -H 'content-type: application/json' -d '{"tenant":"_default","label":"pair-probe"}' "$u/api/devices/pair/start" 2>/dev/null)"
  pcode="$(printf '%s' "$pstart" | jq -r '.code // empty')"; psecret="$(printf '%s' "$pstart" | jq -r '.pollSecret // empty')"
  echo "$pstart" | jq -e '(.code|type=="string") and (.pollSecret|type=="string") and (.verifyUrl|test("/pair\\?code="))' >/dev/null 2>&1 && pass "pair/start -> 201 code + pollSecret + verifyUrl" || fail "pair/start -> $pstart"
  ppend="$(curl -s -H "authorization: Bearer $psecret" "$u/api/devices/pair/poll" 2>/dev/null)"
  echo "$ppend" | jq -e '.status=="pending"' >/dev/null 2>&1 && pass "pair/poll (pre-approval) -> pending" || fail "pair/poll pending -> $ppend"
  pbog="$(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer aidp_bogus' "$u/api/devices/pair/poll" 2>/dev/null || echo 000)"
  [ "$pbog" = 404 ] && pass "pair/poll (unknown secret) -> 404" || fail "pair/poll bogus -> $pbog (want 404)"
  pnb="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/devices/pair/poll" 2>/dev/null || echo 000)"
  [ "$pnb" = 401 ] && pass "pair/poll (no bearer) -> 401" || fail "pair/poll no-bearer -> $pnb (want 401)"
  DADM="${AID_ADMIN_TOKEN:-}"; [ -z "$DADM" ] && DADM="$(get-secret AID_ADMIN_TOKEN 2>/dev/null || true)"; [ -z "$DADM" ] && [ -f "$CP/.aid-admin-token" ] && DADM="$(cat "$CP/.aid-admin-token" 2>/dev/null || true)"
  if [ -n "$DADM" ]; then
    enr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_test","label":"e2e-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    did="$(printf '%s' "$enr" | jq -r '.deviceId // empty')"; dtok="$(printf '%s' "$enr" | jq -r '.token // empty')"
    { [ -n "$did" ] && [ -n "$dtok" ]; } && pass "enroll (admin) -> 201 deviceId + one-time token" || fail "enroll -> $enr"
    who="$(curl -s -H "authorization: Bearer $dtok" "$u/api/devices/me" 2>/dev/null)"
    echo "$who" | jq -e --arg d "$did" '.deviceId==$d and .tenant=="_test"' >/dev/null 2>&1 && pass "devices/me (issued token) -> identity (deviceId + tenant)" || fail "me -> $who"
    rv="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$did/revoke" 2>/dev/null || echo 000)"
    [ "$rv" = 200 ] && pass "revoke (admin) -> 200" || fail "revoke -> $rv (want 200)"
    whor="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $dtok" "$u/api/devices/me" 2>/dev/null || echo 000)"
    [ "$whor" = 401 ] && pass "devices/me (revoked token) -> 401 (S27 per-device revocation)" || fail "me after revoke -> $whor (want 401)"
    rvb="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $DADM" "$u/api/devices/dev_nonexistent/revoke" 2>/dev/null || echo 000)"
    [ "$rvb" = 404 ] && pass "revoke (unknown deviceId) -> 404" || fail "revoke bogus -> $rvb (want 404)"

    # device-SCOPED environment access (fire #17) — tenant resolved FROM the token (no tenant in URL)
    enr2="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_default","label":"scoped-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    did2="$(printf '%s' "$enr2" | jq -r '.deviceId // empty')"; dtok2="$(printf '%s' "$enr2" | jq -r '.token // empty')"
    dcur="$(curl -s -H "authorization: Bearer $dtok2" "$u/api/device/current" 2>/dev/null)"
    echo "$dcur" | jq -e '.tenant=="_default" and (.digest|type=="string")' >/dev/null 2>&1 && pass "device/current (device token) -> own tenant blueprint (_default, no tenant in URL)" || fail "device/current -> $dcur"
    dap="$(curl -s -X POST -H "authorization: Bearer $dtok2" -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" '{observed:$o}')" "$u/api/device/apply" 2>/dev/null)"
    echo "$dap" | jq -e --arg d "$did2" '.dryRun==true and .tenant=="_default" and .deviceId==$d and .plan.total==0' >/dev/null 2>&1 && pass "device/apply (device token) -> scoped dry-run plan (noop vs _default)" || fail "device/apply -> $dap"
    dmd2="$(curl -s -H "authorization: Bearer $dtok2" "$u/api/device/current.md" 2>/dev/null)"
    echo "$dmd2" | grep -q 'install-doctor+json' && pass "device/current.md (device token) -> raw ENVIRONMENT.md (§9 Export)" || fail "device/current.md -> $(printf '%s' "$dmd2" | head -c 80)"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$did2/revoke" >/dev/null 2>&1
    dcr="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $dtok2" "$u/api/device/current" 2>/dev/null || echo 000)"
    [ "$dcr" = 401 ] && pass "device/current (revoked token) -> 401 (S27)" || fail "device/current revoked -> $dcr (want 401)"

    # History (fire #18 / S14,S15) — a device reports a run, then reads it back newest-first
    enr4="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_default","label":"history-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    dtok4="$(printf '%s' "$enr4" | jq -r '.token // empty')"; did4="$(printf '%s' "$enr4" | jq -r '.deviceId // empty')"
    rep="$(curl -s -X POST -H "authorization: Bearer $dtok4" -H 'content-type: application/json' -d '{"kind":"apply","status":"success","revision":"r1","summary":"e2e report","detail":{"plan":{"total":0}}}' "$u/api/device/report" 2>/dev/null)"
    echo "$rep" | jq -e '(.id|type=="string") and .kind=="apply" and .status=="success"' >/dev/null 2>&1 && pass "device/report (device token) -> 201 + event id" || fail "report -> $rep"
    hst="$(curl -s -H "authorization: Bearer $dtok4" "$u/api/device/history" 2>/dev/null)"
    echo "$hst" | jq -e '.count>=1 and (.items[0].kind=="apply") and (.items[0].status=="success")' >/dev/null 2>&1 && pass "device/history (device token) -> lists the reported run (newest-first)" || fail "history -> $hst"
    rpb="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $dtok4" -H 'content-type: application/json' -d '{"kind":"bogus_kind"}' "$u/api/device/report" 2>/dev/null || echo 000)"
    [ "$rpb" = 400 ] && pass "device/report (invalid kind) -> 400 (Zod boundary)" || fail "report invalid -> $rpb (want 400)"
    ah="$(curl -s -H "authorization: Bearer $DADM" "$u/api/history?tenant=_default&limit=5" 2>/dev/null)"
    echo "$ah" | jq -e '.tenant=="_default" and (.count>=1) and (.items[0].deviceId|type=="string") and (.items[0].kind|type=="string")' >/dev/null 2>&1 && pass "GET /api/history?tenant (admin) -> fleet events across devices (S15)" || fail "admin history -> $(printf '%s' "$ah" | head -c 160)"
    [ -n "$did4" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$did4/revoke" >/dev/null 2>&1

    # pairing: owner approves (admin leg) then the machine claims its token (fire #19 / S04)
    pabog="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"code":"ZZZZZZZZ"}' "$u/api/devices/pair/approve" 2>/dev/null || echo 000)"
    [ "$pabog" = 404 ] && pass "pair/approve (unknown code) -> 404" || fail "pair/approve bogus -> $pabog (want 404)"
    if [ -n "$pcode" ] && [ -n "$psecret" ]; then
      pap="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d "$(jq -nc --arg c "$pcode" '{code:$c}')" "$u/api/devices/pair/approve" 2>/dev/null)"
      echo "$pap" | jq -e '.status=="approved"' >/dev/null 2>&1 && pass "pair/approve (admin) -> approved" || fail "pair/approve -> $pap"
      pclaim="$(curl -s -H "authorization: Bearer $psecret" "$u/api/devices/pair/poll" 2>/dev/null)"
      ptok="$(printf '%s' "$pclaim" | jq -r '.token // empty')"
      echo "$pclaim" | jq -e '.status=="claimed" and (.token|type=="string") and (.deviceId|type=="string")' >/dev/null 2>&1 && pass "pair/poll (post-approval) -> claimed + one-time device token" || fail "pair/poll claim -> $pclaim"
      pme="$(curl -s -H "authorization: Bearer $ptok" "$u/api/devices/me" 2>/dev/null)"
      echo "$pme" | jq -e '.tenant=="_default"' >/dev/null 2>&1 && pass "paired token works -> devices/me resolves (tenant _default)" || fail "paired me -> $pme"
      prepoll="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $psecret" "$u/api/devices/pair/poll" 2>/dev/null || echo 000)"
      [ "$prepoll" = 410 ] && pass "pair/poll (already claimed) -> 410 (token delivered once)" || fail "pair/poll re-claim -> $prepoll (want 410)"
    else
      fail "pairing setup — start did not return code/pollSecret"
    fi
    skip "AID_ADMIN_TOKEN unset — device enroll/me/revoke lifecycle assertions skipped"
  fi

  rm -f "$bpf" "$mdf" "$bpf2"
else
  skip "CONTROL_PLANE_URL unset — prod /health + routing E2E skipped (set after deploy)"
fi

say "control-plane: $P passed, $F failed"
[ "$F" -eq 0 ]
