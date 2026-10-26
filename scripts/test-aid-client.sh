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
  # _bin-aware presence (fire #27): a package whose BINARY differs from its key is NOT false-missing.
  # Fixture cnf index: pkgalias -> bin bash (always installed); missalias -> bin zzznope (absent).
  IDX="$(mktemp)"
  printf 'bash\tpkgalias\nzzznope-xyz\tmissalias\n' >"$IDX"
  BENV="$(mktemp)"
  printf '# E\n\n```install-doctor+json\n{ "defaults": { "packages": ["pkgalias","missalias"] } }\n```\n' >"$BENV"
  bp="$(AID_TOKEN_PATH="/nonexistent/aid-token-$$" AID_CNF_INDEX="$IDX" AID_ENV_PATH="$BENV" bash "$RUN" plan 2>&1)"
  { echo "$bp" | grep -q 'present: 1' && echo "$bp" | grep -q 'missing: 1' && echo "$bp" | grep -q 'missalias' && ! echo "$bp" | grep -q 'to install:.*pkgalias'; } && pass "aid plan _bin-aware: key!=binary (pkgalias->bash) counts present, not false-missing" || fail "aid _bin -> $bp"
  rm -f "$IDX" "$BENV"

  if [ -n "${CONTROL_PLANE_URL:-}" ]; then
    u="${CONTROL_PLANE_URL%/}"
    ADMIN="${AID_ADMIN_TOKEN:-}"
    [ -z "$ADMIN" ] && ADMIN="$(get-secret AID_ADMIN_TOKEN 2>/dev/null || true)"
    [ -z "$ADMIN" ] && [ -f "$CP/.aid-admin-token" ] && ADMIN="$(cat "$CP/.aid-admin-token" 2>/dev/null || true)"
    if [ -n "$ADMIN" ]; then
      TOK="$(mktemp -u)"
      ENVF="$(mktemp -u)"
      enr="$(curl -s -X POST -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"tenant":"_default","label":"aid-client-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
      tok="$(printf '%s' "$enr" | jq -r '.token // empty')"
      did="$(printf '%s' "$enr" | jq -r '.deviceId // empty')"
      printf '%s' "$tok" >"$TOK"
      st="$(AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" bash "$RUN" status 2>&1)"
      echo "$st" | grep -q 'tenant=_default' && pass "aid status -> paired summary (tenant=_default)" || fail "aid status -> $st"
      AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" AID_ENV_PATH="$ENVF" bash "$RUN" pull >/dev/null 2>&1
      { [ -s "$ENVF" ] && grep -q 'install-doctor+json' "$ENVF"; } && pass "aid pull -> wrote desired ENVIRONMENT.md (fenced blueprint)" || fail "aid pull -> $(head -c 80 "$ENVF" 2>/dev/null)"
      pl="$(AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" AID_ENV_PATH="$ENVF" bash "$RUN" plan 2>&1)"
      echo "$pl" | grep -qE 'desired packages: [1-9]' && pass "aid plan -> reconciles desired packages (present/missing, local+offline)" || fail "aid plan -> $pl"
      rp="$(AID_TOKEN_PATH="$TOK" AID_CONTROL_PLANE_URL="$u" bash "$RUN" report --kind run --status success --summary "e2e-report-probe" 2>&1)"
      { echo "$rp" | grep -q 'reported' && echo "$rp" | grep -q 'hist_'; } && pass "aid report -> records a run to History (event id)" || fail "aid report -> $rp"
      hist="$(curl -s -H "authorization: Bearer $(cat "$TOK")" "$u/api/device/history" 2>/dev/null)"
      echo "$hist" | jq -e '[.items[].kind] | any(. == "check")' >/dev/null 2>&1 && pass "aid plan auto-registered a 'check' event to History (S14)" || fail "history lacks check event -> $(printf '%s' "$hist" | head -c 120)"
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

say "aid client: $P passed, $F failed"
[ "$F" -eq 0 ]
