#!/usr/bin/env bash
# Focused B10 checks for protected, redacted, bounded local bootstrap evidence.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if bash -n "$PROVISION"; then pass 'provisioner remains valid Bash'; else fail 'provisioner has invalid Bash syntax'; fi

if XDG_STATE_HOME="$TMP/state" HOST='Host With Spaces/And=Noise' WORK_ENVIRONMENT='prod/unsafe=value' \
  OBSERVABILITY_TEST_SECRET='do-not-record-this-value' bash -c '
    set -e
    source "$1"
    idProvisionEvidenceInit
    idEmitProvisionStatus provision started 0
    idEmitProvisionStatus provision success 0
    printf "%s\n%s\n" "$INSTALL_DOCTOR_EVENT_LOG" "$INSTALL_DOCTOR_TERMINAL_RECEIPT"
  ' _ "$PROVISION" > "$TMP/paths"; then
  EVENT_LOG="$(sed -n '1p' "$TMP/paths")"
  RECEIPT="$(sed -n '2p' "$TMP/paths")"
  pass 'local evidence initializes and records a terminal receipt'
else
  fail 'local evidence initialization failed'
  EVENT_LOG=''; RECEIPT=''
fi

for file in "$EVENT_LOG" "$RECEIPT"; do
  if [ -n "$file" ] && [ -f "$file" ] && [ ! -L "$file" ] \
    && [ "$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file")" = 600 ]; then
    pass "$(basename "$file") is a private regular file"
  else
    fail "local evidence file is missing, linked, or not mode 0600: $file"
  fi
done

if node - "$EVENT_LOG" "$RECEIPT" <<'NODE'
const fs = require('node:fs');
const [eventsPath, receiptPath] = process.argv.slice(2);
const events = fs.readFileSync(eventsPath, 'utf8').trim().split('\n').map(JSON.parse);
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
if (events.length !== 2 || events[0].status !== 'started' || events[1].status !== 'success') process.exit(1);
for (const value of [...events, receipt]) {
  const expectedSchema = value.type === 'provision-terminal-receipt' ? 2 : 1;
  if (value.schemaVersion !== expectedSchema || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0) process.exit(2);
  if (!Number.isSafeInteger(value.rssKiB) || value.rssKiB < 0) process.exit(3);
  if (!value.labels || Object.keys(value.labels).join(',') !== 'host,environment,service') process.exit(4);
  for (const label of Object.values(value.labels)) if (!/^[a-z0-9._-]{1,64}$/.test(label)) process.exit(5);
}
if (receipt.status !== 'success' || receipt.exitCode !== 0 || receipt.terminal !== true || receipt.engineEvidence !== null) process.exit(6);
NODE
then
  pass 'evidence carries bounded duration/resource metrics, labels, and terminal truth'
else
  fail 'local evidence schema or metrics are invalid'
fi

mkdir -p "$TMP/engine-evidence"
PLAN_DIGEST="$(printf 'a%.0s' {1..64})"
ENGINE_RECEIPT="$TMP/engine-evidence/verified.receipt.json"
printf '%s\n' "{\"schemaVersion\":1,\"runId\":\"run-verified\",\"planDigest\":\"$PLAN_DIGEST\",\"status\":\"success\",\"startedAt\":\"2026-11-09T00:00:00.000Z\",\"finishedAt\":\"2026-11-09T00:00:01.000Z\",\"taskCounts\":{\"verified\":1,\"inapplicable\":0,\"skipped\":0,\"blocked\":0,\"pending\":0,\"failed\":0},\"evidencePaths\":[\"$ENGINE_RECEIPT\"],\"nextAction\":null}" > "$ENGINE_RECEIPT"
ENGINE_RECEIPT_SHA="$(node -e 'const fs=require("node:fs"),c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$ENGINE_RECEIPT")"
cat > "$TMP/engine-evidence/result.json" <<EOF
{"schemaVersion":1,"runId":"run-verified","planDigest":"$PLAN_DIGEST","authority":"committed","problems":[],"receipt":$(cat "$ENGINE_RECEIPT"),"commitPath":"$TMP/engine-evidence/commit.json"}
EOF
if XDG_STATE_HOME="$TMP/bound-state" INSTALL_DOCTOR_RUNTIME_NODE="$(command -v node)" \
  INSTALL_DOCTOR_ENGINE_EVIDENCE_REQUIRED=true bash -c '
    set -e
    source "$1"
    idProvisionEvidenceInit
    idAdmitEngineEvidenceBinding "$2"
    idEmitProvisionStatus provision success 0
    node -e "const r=JSON.parse(require(\"node:fs\").readFileSync(process.env.INSTALL_DOCTOR_TERMINAL_RECEIPT,\"utf8\"));if(r.engineEvidence?.runId!==\"run-verified\"||r.engineEvidence?.planDigest!==\"a\".repeat(64)||r.engineEvidence?.receiptSha256!==process.argv[1])process.exit(1)" "$3"
  ' _ "$PROVISION" "$TMP/engine-evidence/result.json" "$ENGINE_RECEIPT_SHA"; then
  pass 'terminal success binds the exact verified engine run, plan, and receipt digest'
else
  fail 'verified engine evidence was not bound to terminal success'
fi

UNBOUND_PATHS="$TMP/unbound-paths"
if XDG_STATE_HOME="$TMP/unbound-state" INSTALL_DOCTOR_ENGINE_EVIDENCE_REQUIRED=true bash -c '
  source "$1"; idProvisionEvidenceInit
  printf "%s\n%s\n" "$INSTALL_DOCTOR_EVENT_LOG" "$INSTALL_DOCTOR_TERMINAL_RECEIPT" > "$2"
  idEmitProvisionStatus provision success 0
' _ "$PROVISION" "$UNBOUND_PATHS" >/dev/null 2>&1; then
  fail 'engine-owned terminal success accepted missing authoritative evidence'
else
  UNBOUND_EVENT="$(sed -n '1p' "$UNBOUND_PATHS")"
  UNBOUND_RECEIPT="$(sed -n '2p' "$UNBOUND_PATHS")"
  if ! grep -Fq '"status":"success"' "$UNBOUND_EVENT" && [ ! -e "$UNBOUND_RECEIPT" ]; then
    pass 'engine-owned terminal success rejects missing authority before publishing success'
  else
    fail 'rejected engine evidence left a false-success event or receipt'
  fi
fi

if ! grep -R -Fq 'do-not-record-this-value' "$TMP/state"; then pass 'unrelated secret environment values are absent from evidence'; else fail 'secret leaked into local evidence'; fi

if XDG_STATE_HOME="$TMP/failed-state" bash -c '
  set -e
  source "$1"
  idProvisionEvidenceInit
  idEmitProvisionStatus provision failed 7
  node -e "const r=JSON.parse(require(\"node:fs\").readFileSync(process.env.INSTALL_DOCTOR_TERMINAL_RECEIPT,\"utf8\")); if(r.status!==\"failed\"||r.exitCode!==7||r.terminal!==true) process.exit(1)"
' _ "$PROVISION"; then
  pass 'failed terminal receipt preserves the real exit code'
else
  fail 'failed terminal receipt is not truthful'
fi

mkdir -p "$TMP/unsafe"
ln -s "$TMP/unsafe" "$TMP/link-state"
if XDG_STATE_HOME="$TMP/link-state" bash -c 'source "$1"; idProvisionEvidenceInit' _ "$PROVISION" >/dev/null 2>&1; then
  fail 'symlinked evidence root was accepted'
else
  pass 'symlinked evidence root is rejected before writing'
fi

printf 'provision-local-evidence: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
