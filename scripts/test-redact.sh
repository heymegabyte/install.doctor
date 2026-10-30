#!/usr/bin/env bash
# Q08/U02 — unit-test the pure secret-redaction helper (redactSecrets) that scrubs device-reported
# `summary`/`detail` BEFORE they are persisted to the D1 `history` table (`POST /api/device/report`).
# The architecture invariant: "Record safe terminal output and execution events; suppress secret-bearing
# input ... secret values must not enter ... recordings, or generic logs." This is the BOUNDARY backstop
# (defense-in-depth) — the primary source-suppression (a recorder that never captures raw secret input)
# remains U02 ⬜. Imports the REAL shipped module (packages/control-plane/src/redact.ts) via node's native
# TS strip (zero drift — tests the ACTUAL function). The integration proof (report a secret → GET history
# → [REDACTED]) lives in test-control-plane.sh; this suite verifies the DECISION logic deterministically.
set -u
CP="$(cd "$(dirname "$0")/.." && pwd)/packages/control-plane"
MOD="$CP/src/redact.ts"
export MOD
if [ ! -f "$MOD" ]; then
  printf 'FAIL redact module missing: %s\n' "$MOD"
  echo "redact: 0 passed, 1 failed"
  exit 1
fi
# Run node from the control-plane dir so Volta selects the modern node that strips TS types natively; the
# repo ROOT pins an older node via Volta which cannot import a .ts module (ERR_UNKNOWN_FILE_EXTENSION).
cd "$CP" || { printf 'FAIL cannot cd to %s\n' "$CP"; echo "redact: 0 passed, 1 failed"; exit 1; }
node --input-type=module <<'NODE'
const { redactSecrets } = await import(process.env.MOD);
const R = '[REDACTED]';
let P = 0, F = 0;
const ok = (d, cond) => { if (cond) { P++; console.log('PASS ' + d); } else { F++; console.log('FAIL ' + d); } };
const has = (o, s) => typeof o === 'string' && o.includes(s);
const gone = (o, s) => typeof o === 'string' && !o.includes(s);

// k=v secret assignments (the common accidental-leak shape in a reported command/error)
ok('token=<value> redacted (value scrubbed, key kept)', (() => { const o = redactSecrets('ran: deploy --token=abcdefghij1234567890XY'); return has(o, R) && gone(o, 'abcdefghij1234567890XY') && has(o, 'token'); })());
ok('password=<value> redacted', (() => { const o = redactSecrets('mysql --password=hunter2hunter2'); return has(o, R) && gone(o, 'hunter2hunter2'); })());
ok('json "api_key":"..." redacted', (() => { const o = redactSecrets('{"api_key":"k9f8s7d6f5g4h3j2l1q0"}'); return has(o, R) && gone(o, 'k9f8s7d6f5g4h3j2l1q0'); })());
ok('client_secret=<value> redacted', (() => { const o = redactSecrets('client_secret=zzzxxxcccvvvbbbnnn99'); return has(o, R) && gone(o, 'zzzxxxcccvvvbbbnnn99'); })());

// known credential SHAPES (caught regardless of surrounding key)
ok('Authorization: Bearer <token> redacted, keyword kept', (() => { const o = redactSecrets('header Authorization: Bearer abcdefgh12345678wxyz'); return has(o, R) && /[Bb]earer/.test(o) && gone(o, 'abcdefgh12345678wxyz'); })());
ok('AWS AKIA key redacted', (() => { const o = redactSecrets('env AWS_ACCESS_KEY_ID AKIA1234567890ABCDEF set'); return has(o, R) && gone(o, 'AKIA1234567890ABCDEF'); })());
ok('GitHub ghp_ token redacted (bare)', (() => { const o = redactSecrets('cloned with ghp_ABCDEFGHIJ1234567890KLMN today'); return has(o, R) && gone(o, 'ghp_ABCDEFGHIJ1234567890KLMN'); })());
ok('GitHub fine-grained github_pat_ redacted', (() => { const o = redactSecrets('github_pat_11ABCDEFG0abcdefghij1234'); return has(o, R) && gone(o, 'github_pat_11ABCDEFG0abcdefghij1234'); })());
ok('OpenAI/Anthropic sk- token redacted', (() => { const o = redactSecrets('OPENAI sk-ant-api03-ABCDEFGHIJ1234567890 live'); return has(o, R) && gone(o, 'sk-ant-api03-ABCDEFGHIJ1234567890'); })());
ok('Slack xoxb- token redacted', (() => { const o = redactSecrets('slack xoxb-123456789012-abcdefghijkl here'); return has(o, R) && gone(o, 'xoxb-123456789012-abcdefghijkl'); })());
ok('PEM private key block redacted', (() => { const o = redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAISEKRET\n-----END RSA PRIVATE KEY-----'); return has(o, R) && gone(o, 'MIIEpAISEKRET'); })());

// NO false positives on ordinary machine-event prose (the real content of a History summary/detail)
ok('ordinary install prose unchanged', redactSecrets('installed ripgrep via brew (1069 of 1069 apps)') === 'installed ripgrep via brew (1069 of 1069 apps)');
ok('plan summary prose unchanged', redactSecrets('apply: 3 packages, 2 services, revision 42') === 'apply: 3 packages, 2 services, revision 42');
ok('"secret" word with SPACE after colon (prose) NOT redacted', redactSecrets('the secret: it works well now') === 'the secret: it works well now');
ok('"token" as a plain word (no assignment) unchanged', redactSecrets('the auth token flow completed') === 'the auth token flow completed');

// safety / stability
ok('idempotent (redact of redacted == redacted)', (() => { const a = redactSecrets('--token=abcdefghij1234567890XY done'); return redactSecrets(a) === a; })());
ok('empty string → empty', redactSecrets('') === '');
ok('non-string null → passthrough', redactSecrets(null) === null);
ok('non-string undefined → passthrough', redactSecrets(undefined) === undefined);

console.log('redact: ' + P + ' passed, ' + F + ' failed');
process.exit(F === 0 ? 0 : 1);
NODE
