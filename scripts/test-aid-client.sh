#!/usr/bin/env bash
# aid client gate (machine-side consumer of the device token from aid-pair).
#   static : source present (chezmoi executable_) + bash -n + shellcheck clean.
#   e2e    : no token -> not-paired (exit 2). If CONTROL_PLANE_URL + admin token — mint a _default
#            device token, then `aid status` -> paired summary, `aid pull` -> writes ENVIRONMENT.md.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/home/dot_local/bin/executable_aid"
CP="$ROOT/packages/control-plane"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
skip() { command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0
F=0

say "aid client"

if [ ! -f "$SRC" ]; then
  fail "aid source missing ($SRC)"
else
  pass "aid source present (chezmoi executable_)"
  bash -n "$SRC" 2>/dev/null && pass "bash -n clean" || fail "bash -n failed"
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -S warning "$SRC" >/tmp/aid-sc.log 2>&1 && pass "shellcheck clean" || { fail "shellcheck findings"; tail -6 /tmp/aid-sc.log 2>/dev/null; }
  else
    skip "shellcheck not installed"
  fi
fi

if [ -f "$SRC" ]; then
  RUN="$(mktemp)"
  cp "$SRC" "$RUN"
  chmod +x "$RUN"
  # no-token -> not paired (exit 2) — independent of the control plane
  rc=0
  AID_TOKEN_PATH="/nonexistent/aid-token-$$" bash "$RUN" status >/dev/null 2>&1 || rc=$?
  [ "$rc" = 2 ] && pass "aid status (no token) -> not-paired (exit 2)" || fail "aid status no-token exit=$rc (want 2)"
  rc=0
  AID_TOKEN_PATH="/nonexistent/aid-token-$$" bash "$RUN" up >/dev/null 2>&1 || rc=$?
  [ "$rc" = 2 ] && pass "aid up (no token) -> not-paired (exit 2)" || fail "aid up no-token exit=$rc (want 2)"
  # aid apply DRY-RUN (LOCAL, offline, no token) — crafted env with a missing pkg; MUST print a plan + install NOTHING
  CENV="$(mktemp)"
  printf '# E\n\n```install-doctor+json\n{ "defaults": { "packages": ["bash","zzz-nope-apply-xyz"] } }\n```\n' >"$CENV"
  ap="$(AID_TOKEN_PATH="/nonexistent/aid-token-$$" AID_ENV_PATH="$CENV" bash "$RUN" apply 2>&1)"
  { echo "$ap" | grep -qi 'DRY-RUN' && echo "$ap" | grep -q 'would install' && ! echo "$ap" | grep -qi 'installed'; } && pass "aid apply (dry-run, offline) -> prints plan, installs nothing" || fail "aid apply dry-run -> $ap"
  rm -f "$CENV"
  # fire #193 — A11 offline resilience: an UNREACHABLE control plane must fail FAST (an honest error, then
  # the user falls back to local `aid plan`), NOT hang on curl's multi-minute default connect timeout.
  # Assert every control-plane curl in the client carries --connect-timeout. RED pre-fix (none did).
  missing_to="$(grep -nE '\bcurl ' "$SRC" | grep -cvE -- '--connect-timeout')"
  { [ "$missing_to" = 0 ]; } && pass "A11 — every aid control-plane curl carries --connect-timeout (unreachable CP fails fast, never hangs)" || fail "$missing_to aid curl call(s) lack --connect-timeout (would hang on an unreachable control plane)"
  # _bin-aware presence (fire #27): a package whose BINARY differs from its key is NOT false-missing.
  # Fixture cnf index: pkgalias -> bin bash (always installed); missalias -> bin zzznope (absent).
  IDX="$(mktemp)"
  printf 'bash\tpkgalias\nzzznope-xyz\tmissalias\n' >"$IDX"
  BENV="$(mktemp)"
  printf '# E\n\n```install-doctor+json\n{ "defaults": { "packages": ["pkgalias","missalias"] } }\n```\n' >"$BENV"
  bp="$(AID_TOKEN_PATH="/nonexistent/aid-token-$$" AID_CNF_INDEX="$IDX" AID_ENV_PATH="$BENV" bash "$RUN" plan 2>&1)"
  { echo "$bp" | grep -q 'present: 1' && echo "$bp" | grep -q 'missing: 1' && echo "$bp" | grep -q 'missalias' && ! echo "$bp" | grep -q 'to install:.*pkgalias'; } && pass "aid plan _bin-aware: key!=binary (pkgalias->bash) counts present, not false-missing" || fail "aid _bin -> $bp"
  rm -f "$IDX" "$BENV"

  # aid exec / aid prewarm (§4.E authorized install-on-demand + prewarming) over the CNF_NO_EXEC
  # primitive. Hermetic: repo cnf hook + fixture index + fake brew; no control plane, no real install.
  HOOK_SRC="$ROOT/home/dot_config/shell/not-found-hook.sh"
  xbin="$(mktemp -d)"
  xidx="$(mktemp)"
  printf 'exectool\texectool\texectool\npwtool\tpwtool\tpwtool\n' >"$xidx"
  cat >"$xbin/brew" <<BREW
#!/usr/bin/env bash
case "\$2" in
  exectool) printf '#!/usr/bin/env bash\necho EXECTOOL_RAN_42\n' >"$xbin/exectool"; chmod +x "$xbin/exectool";;
  pwtool)   printf '#!/usr/bin/env bash\n: > "$xbin/pwtool_ran"\n' >"$xbin/pwtool"; chmod +x "$xbin/pwtool";;
esac
BREW
  chmod +x "$xbin/brew"
  rc=0
  AID_TOKEN_PATH="/nonexistent/aid-$$" bash "$RUN" exec >/dev/null 2>&1 || rc=$?
  [ "$rc" = 2 ] && pass "aid exec (no command) -> usage (exit 2)" || fail "aid exec no-arg exit=$rc (want 2)"
  eo="$(AID_TOKEN_PATH="/nonexistent/aid-$$" bash "$RUN" exec echo AIDEXEC_OK 2>/dev/null)"
  [ "$eo" = "AIDEXEC_OK" ] && pass "aid exec <present> -> runs it, stdout clean (argv preserved via exec)" || fail "aid exec present -> '$eo'"
  rm -f "$xbin/exectool"
  eo2="$(AID_CNF_HOOK="$HOOK_SRC" CNF_INDEX="$xidx" CNF_LOCK_DIR="$(mktemp -d)" PATH="$xbin:$PATH" AID_TOKEN_PATH="/nonexistent/aid-$$" bash "$RUN" exec exectool 2>/dev/null)"
  [ "$eo2" = "EXECTOOL_RAN_42" ] && pass "aid exec <missing> -> installs via the ONE resolver (CNF_NO_EXEC) then runs it" || fail "aid exec missing -> '$eo2'"
  rm -f "$xbin/pwtool" "$xbin/pwtool_ran"
  AID_CNF_HOOK="$HOOK_SRC" CNF_INDEX="$xidx" CNF_LOCK_DIR="$(mktemp -d)" PATH="$xbin:$PATH" AID_TOKEN_PATH="/nonexistent/aid-$$" bash "$RUN" prewarm pwtool >/dev/null 2>&1
  { [ -x "$xbin/pwtool" ] && [ ! -f "$xbin/pwtool_ran" ]; } && pass "aid prewarm <missing> -> installs but does NOT run (§4.E prewarm)" || fail "aid prewarm installed=$([ -x "$xbin/pwtool" ] && echo y || echo n) ran=$([ -f "$xbin/pwtool_ran" ] && echo y || echo n)"
  rm -rf "$xbin" "$xidx"

  # aid installs (U09/U10) — summarize the cnf lazy-install telemetry journal. Seed a journal, assert summary.
  ijrnl="$(mktemp)"
  printf '{"ts":"t","cmd":"rg","mgr":"brew","pkg":"ripgrep","outcome":"installed","duration_ms":1200}\n{"ts":"t","cmd":"fd","mgr":"brew","pkg":"fd","outcome":"installed","duration_ms":800}\n{"ts":"t","cmd":"rg","mgr":"brew","pkg":"ripgrep","outcome":"concurrent-skip","duration_ms":0}\n' > "$ijrnl"
  isum="$(AID_CNF_JOURNAL="$ijrnl" AID_TOKEN_PATH="/nonexistent/aid-$$" bash "$RUN" installs 2>/dev/null)"
  if command -v jq >/dev/null 2>&1; then
    echo "$isum" | jq -e '.total==3 and .installed==2 and .warm_skips==1 and .avg_install_ms==1000' >/dev/null 2>&1 && pass "aid installs -> telemetry summary (total/installed/warm/avg latency, U09/U10)" || fail "aid installs -> $isum"
  else
    skip "jq absent — aid installs summary assertion skipped"
  fi
  rm -f "$ijrnl"

  if [ -n "${CONTROL_PLANE_URL:-}" ]; then
    u="${CONTROL_PLANE_URL%/}"
    ADMIN="${AID_ADMIN_TOKEN:-}"
    [ -z "$ADMIN" ] && ADMIN="$(get-secret AID_ADMIN_TOKEN 2>/dev/null || true)"
    [ -z "$ADMIN" ] && [ -f "$CP/.aid-admin-token" ] && ADMIN="$(cat "$CP/.aid-admin-token" 2>/dev/null || true)"
    # aid provider — write OpenCode config (public endpoint, no token needed)
    PCF="$(mktemp -u)"
    AID_CONTROL_PLANE_URL="$u" AID_OPENCODE_CONFIG_PATH="$PCF" bash "$RUN" provider >/dev/null 2>&1
    { [ -s "$PCF" ] && grep -q 'install-doctor' "$PCF" && grep -q 'AID_INFERENCE_TOKEN' "$PCF"; } && pass "aid provider -> wrote OpenCode config (install-doctor provider + {env} token)" || fail "aid provider -> $(head -c 80 "$PCF" 2>/dev/null)"
    rc=0
    AID_CONTROL_PLANE_URL="$u" AID_OPENCODE_CONFIG_PATH="$PCF" bash "$RUN" provider >/dev/null 2>&1 || rc=$?
    [ "$rc" = 1 ] && pass "aid provider (config exists, no --force) -> refuses (exit 1)" || fail "aid provider clobber-guard rc=$rc (want 1)"
    rm -f "$PCF"
    if [ -n "$ADMIN" ]; then
      TOK="$(mktemp -u)"
      ENVF="$(mktemp -u)"
      enr="$(curl -s -X POST -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"tenant":"_default","label":"aid-client-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
      tok="$(printf '%s' "$enr" | jq -r '.token // empty')"
      did="$(printf '%s' "$enr" | jq -r '.deviceId // empty')"
      printf '%s' "$tok" >"$TOK"
      st="$(AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" bash "$RUN" status 2>&1)"
      echo "$st" | grep -q 'tenant=_default' && pass "aid status -> paired summary (tenant=_default)" || fail "aid status -> $st"
      # fire #55 — aid status surfaces the device's GRANTED scope (client-side completion of the scope loop).
      # both-scope device: status prints "authorized for: … pull-desired-state … report-status".
      TOK2="$(mktemp -u)"
      enr2="$(curl -s -X POST -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"tenant":"_default","label":"aid-scope-both","permissions":["pull-desired-state","report-status"]}' "$u/api/devices/enroll" 2>/dev/null)"
      tok2="$(printf '%s' "$enr2" | jq -r '.token // empty')"; did2="$(printf '%s' "$enr2" | jq -r '.deviceId // empty')"
      printf '%s' "$tok2" >"$TOK2"
      st2="$(AID_TOKEN_PATH="$TOK2" AID_CONTROL_PLANE_URL="$u" bash "$RUN" status 2>&1)"
      { echo "$st2" | grep -qi 'authorized for' && echo "$st2" | grep -q 'pull-desired-state' && echo "$st2" | grep -q 'report-status'; } && pass "aid status -> surfaces granted scope (authorized for: pull-desired-state, report-status)" || fail "aid status scope -> $st2"
      [ -n "$did2" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $ADMIN" "$u/api/devices/$did2/revoke" >/dev/null 2>&1
      rm -f "$TOK2"
      # report-only device: status EXPLAINS the desired-state 403 (lacks pull-desired-state), not a bare error.
      TOK3="$(mktemp -u)"
      enr3="$(curl -s -X POST -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"tenant":"_default","label":"aid-scope-report","permissions":["report-status"]}' "$u/api/devices/enroll" 2>/dev/null)"
      tok3="$(printf '%s' "$enr3" | jq -r '.token // empty')"; did3="$(printf '%s' "$enr3" | jq -r '.deviceId // empty')"
      printf '%s' "$tok3" >"$TOK3"
      st3="$(AID_TOKEN_PATH="$TOK3" AID_CONTROL_PLANE_URL="$u" bash "$RUN" status 2>&1)"
      { echo "$st3" | grep -qi 'not authorized' && echo "$st3" | grep -q 'pull-desired-state'; } && pass "aid status (report-only) -> explains desired-state scope gap (needs pull-desired-state)" || fail "aid status scope-gap -> $st3"
      [ -n "$did3" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $ADMIN" "$u/api/devices/$did3/revoke" >/dev/null 2>&1
      rm -f "$TOK3"
      AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" AID_ENV_PATH="$ENVF" bash "$RUN" pull >/dev/null 2>&1
      { [ -s "$ENVF" ] && grep -q 'install-doctor+json' "$ENVF"; } && pass "aid pull -> wrote desired ENVIRONMENT.md (fenced blueprint)" || fail "aid pull -> $(head -c 80 "$ENVF" 2>/dev/null)"
      pl="$(AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" AID_ENV_PATH="$ENVF" bash "$RUN" plan 2>&1)"
      echo "$pl" | grep -qE 'desired packages: [1-9]' && pass "aid plan -> reconciles desired packages (present/missing, local+offline)" || fail "aid plan -> $pl"
      rp="$(AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" bash "$RUN" report --kind run --status success --summary "e2e-report-probe" 2>&1)"
      { echo "$rp" | grep -q 'reported' && echo "$rp" | grep -q 'hist_'; } && pass "aid report -> records a run to History (event id)" || fail "aid report -> $rp"
      hist="$(curl -s -H "authorization: Bearer $(cat "$TOK")" "$u/api/device/history" 2>/dev/null)"
      echo "$hist" | jq -e '[.items[].kind] | any(. == "check")' >/dev/null 2>&1 && pass "aid plan auto-registered a 'check' event to History (S14)" || fail "history lacks check event -> $(printf '%s' "$hist" | head -c 120)"
      # fire #89 — the aid client STAMPS a per-invocation run-id as correlationId on EVERY report (U03 client).
      # AID_RUN_ID is env-overridable (a parent shares correlation) + AID_PARENT_RUN_ID links this run as a
      # child. Report with known ids, then confirm they landed in History (RED pre-change: correlationId null).
      aidrun="aidrun-$$-$(od -A n -N 4 -t x1 /dev/urandom 2>/dev/null | tr -d ' \n')"; aidpar="aidpar-$$"
      AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" AID_RUN_ID="$aidrun" AID_PARENT_RUN_ID="$aidpar" bash "$RUN" report --kind run --status success --summary "u03 aid-client correlation" >/dev/null 2>&1
      histc="$(curl -s -H "authorization: Bearer $(cat "$TOK")" "$u/api/device/history" 2>/dev/null)"
      echo "$histc" | jq -e --arg c "$aidrun" '([.items[].correlationId]|index($c))!=null' >/dev/null 2>&1 && pass "aid report -> stamps AID_RUN_ID as correlationId on the event (U03 client)" || fail "aid correlationId -> $(printf '%s' "$histc" | jq -c '[.items[]|{summary,correlationId}]' 2>/dev/null | head -c 200)"
      echo "$histc" | jq -e --arg p "$aidpar" '([.items[].parentRunId]|index($p))!=null' >/dev/null 2>&1 && pass "aid report -> stamps AID_PARENT_RUN_ID as parentRunId (U03 parent/child linkage)" || fail "aid parentRunId -> $(printf '%s' "$histc" | jq -c '[.items[]|{summary,parentRunId}]' 2>/dev/null | head -c 200)"
      ap2="$(AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" AID_ENV_PATH="$ENVF" bash "$RUN" apply 2>&1)"
      echo "$ap2" | grep -qiE 'DRY-RUN|nothing to install' && pass "aid apply (dry-run, prod) -> plan or noop (installs nothing, opt-in to execute)" || fail "aid apply prod -> $ap2"
      hist2="$(curl -s -H "authorization: Bearer $(cat "$TOK")" "$u/api/device/history" 2>/dev/null)"
      echo "$hist2" | jq -e '[.items[].kind] | any(. == "apply")' >/dev/null 2>&1 && pass "aid apply auto-registered an 'apply' event to History (S14)" || fail "history lacks apply event -> $(printf '%s' "$hist2" | head -c 120)"
      UENVF="$(mktemp -u)"
      up="$(AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" AID_ENV_PATH="$UENVF" bash "$RUN" up 2>&1)"
      { [ -s "$UENVF" ] && echo "$up" | grep -q 'desired packages' && echo "$up" | grep -q 'aid up ✓'; } && pass "aid up -> one-command sync (pull wrote env + plan reconciled + done)" || fail "aid up -> $up / env=$([ -s "$UENVF" ] && echo written || echo missing)"
      rm -f "$UENVF"
      [ -n "$did" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $ADMIN" "$u/api/devices/$did/revoke" >/dev/null 2>&1
      rm -f "$TOK" "$ENVF"
    else
      skip "admin token unavailable — aid status/pull E2E skipped"
    fi
  else
    skip "CONTROL_PLANE_URL unset — aid status/pull E2E skipped"
  fi
  rm -f "$RUN"
fi

# provisioning lifecycle hook (run_after_30-aid-report) — auto pull+plan for a PAIRED box; skip unpaired;
# NEVER apply. Verified with a stub AID_BIN (no control plane needed).
HOOK="$ROOT/home/.chezmoiscripts/universal/run_after_30-aid-report.sh.tmpl"
if [ ! -f "$HOOK" ]; then
  fail "aid-report run_after missing ($HOOK)"
else
  pass "aid-report run_after present"
  REND="$(mktemp)"
  if command -v chezmoi >/dev/null 2>&1; then chezmoi execute-template <"$HOOK" >"$REND" 2>/dev/null || cp "$HOOK" "$REND"; else cp "$HOOK" "$REND"; fi
  bash -n "$REND" 2>/dev/null && pass "aid-report bash -n clean (rendered)" || fail "aid-report bash -n failed"
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -S warning "$REND" >/tmp/aidhook-sc.log 2>&1 && pass "aid-report shellcheck clean" || { fail "aid-report shellcheck findings"; tail -5 /tmp/aidhook-sc.log 2>/dev/null; }
  else
    skip "shellcheck not installed"
  fi
  STUB="$(mktemp)"
  CALLS="$(mktemp)"
  printf '#!/usr/bin/env bash\necho "$@" >> "%s"\n' "$CALLS" >"$STUB"
  chmod +x "$STUB"
  rc=0
  AID_TOKEN_PATH="/nonexistent/aid-$$" AID_BIN="$STUB" bash "$REND" || rc=$?
  { [ "$rc" = 0 ] && [ ! -s "$CALLS" ]; } && pass "aid-report (unpaired) -> skips, invokes aid 0 times" || fail "aid-report unpaired rc=$rc calls=$(cat "$CALLS" 2>/dev/null)"
  TOKF="$(mktemp)"
  printf 'aid_faketoken' >"$TOKF"
  : >"$CALLS"
  rc=0
  AID_TOKEN_PATH="$TOKF" AID_BIN="$STUB" bash "$REND" || rc=$?
  { [ "$rc" = 0 ] && grep -q '^pull$' "$CALLS" && grep -q '^plan$' "$CALLS" && ! grep -q 'apply' "$CALLS"; } && pass "aid-report (paired) -> runs pull + plan, never apply" || fail "aid-report paired rc=$rc calls=$(cat "$CALLS" 2>/dev/null)"
  rm -f "$REND" "$STUB" "$CALLS" "$TOKF"
fi

# fire #190 — Q08/U02 SOURCE-suppression: the aid client scrubs known secret shapes from the OUTGOING
# report body BEFORE it leaves the host (the invariant's PRIMARY control — "disable sensitive capture at
# its source"; defense-in-depth with the control-plane #189 boundary redaction). The reusable jq filter
# home/dot_local/bin/aid-redact.jq walks every string in the body. Tests the REAL filter (zero drift) +
# asserts postReport WIRES it. RED before the filter file + the wiring exist.
RJQ="$ROOT/home/dot_local/bin/aid-redact.jq"
if [ ! -f "$RJQ" ]; then
  fail "aid-redact.jq filter missing ($RJQ)"
elif ! command -v jq >/dev/null 2>&1; then
  skip "jq not installed — aid-redact filter unit test skipped"
else
  RD='[REDACTED]'
  out="$(printf '%s' '{"kind":"run","status":"success","summary":"deploy --token=ghp_ABCDEF1234567890GHIJ1234","detail":{"cmd":"push --token=ghp_ABCDEF1234567890GHIJ1234","note":"Authorization: Bearer abcdefgh12345678wxyz"}}' | jq -c -f "$RJQ" 2>/dev/null)"
  { printf '%s' "$out" | jq -e . >/dev/null 2>&1 && printf '%s' "$out" | grep -qF "$RD" && ! printf '%s' "$out" | grep -qF 'ghp_ABCDEF1234567890GHIJ1234' && ! printf '%s' "$out" | grep -qF 'abcdefgh12345678wxyz'; } && pass "aid-redact: ghp_ + Bearer scrubbed from summary+detail, body stays valid JSON" || fail "aid-redact ghp/bearer -> $out"
  out2="$(printf '%s' '{"summary":"login password=hunter2hunter2 AKIA1234567890ABCDEF key sk-ant-ABCDEFGHIJ1234567890"}' | jq -c -f "$RJQ" 2>/dev/null)"
  { printf '%s' "$out2" | grep -qF "$RD" && ! printf '%s' "$out2" | grep -qF 'hunter2hunter2' && ! printf '%s' "$out2" | grep -qF 'AKIA1234567890ABCDEF' && ! printf '%s' "$out2" | grep -qF 'sk-ant-ABCDEFGHIJ1234567890'; } && pass "aid-redact: password=/AKIA/sk- shapes all scrubbed" || fail "aid-redact shapes -> $out2"
  out3="$(printf '%s' '{"kind":"run","status":"success","summary":"apply: 3 packages, 2 services, revision 42","correlationId":"run_abc123def456"}' | jq -c -f "$RJQ" 2>/dev/null)"
  { printf '%s' "$out3" | grep -qF 'apply: 3 packages, 2 services, revision 42' && printf '%s' "$out3" | grep -qF 'run_abc123def456' && ! printf '%s' "$out3" | grep -qF "$RD"; } && pass "aid-redact: prose + correlationId + kind/status NOT mangled (no false positive)" || fail "aid-redact prose -> $out3"
  once="$(printf '%s' '{"summary":"--token=ghp_ABCDEF1234567890GHIJ1234"}' | jq -c -f "$RJQ" 2>/dev/null)"; twice="$(printf '%s' "$once" | jq -c -f "$RJQ" 2>/dev/null)"
  { [ -n "$once" ] && [ "$once" = "$twice" ]; } && pass "aid-redact: idempotent (redact of redacted == redacted)" || fail "aid-redact idempotent -> once=$once twice=$twice"
  { grep -q 'aid-redact.jq' "$SRC" && grep -qE 'jq -c -f|jq -cf' "$SRC"; } && pass "aid client: postReport WIRES aid-redact.jq (source-suppression before the report leaves the host)" || fail "aid client: postReport does NOT pipe the outgoing body through aid-redact.jq"
fi

say "aid client: $P passed, $F failed"
[ "$F" -eq 0 ]
