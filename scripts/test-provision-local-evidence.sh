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
    && [ "$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file")" = 600 ]; then
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
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0) process.exit(2);
  if (!Number.isSafeInteger(value.rssKiB) || value.rssKiB < 0) process.exit(3);
  if (!value.labels || Object.keys(value.labels).join(',') !== 'host,environment,service') process.exit(4);
  for (const label of Object.values(value.labels)) if (!/^[a-z0-9._-]{1,64}$/.test(label)) process.exit(5);
}
if (receipt.status !== 'success' || receipt.exitCode !== 0 || receipt.terminal !== true) process.exit(6);
NODE
then
  pass 'evidence carries bounded duration/resource metrics, labels, and terminal truth'
else
  fail 'local evidence schema or metrics are invalid'
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
