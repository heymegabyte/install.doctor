#!/usr/bin/env bash
# Q08/U02 — CROSS-ENGINE redactor PARITY (drift guard). The secret-redaction logic lives in TWO
# implementations that MUST scrub the SAME credential shapes:
#   - server BOUNDARY: packages/control-plane/src/redact.ts  (redactSecrets, fire #189)
#   - client SOURCE:   home/dot_local/bin/aid-redact.jq       (fire #190)
# A shape added to ONE but not the OTHER is a silent HALF-leak — caught server-side but sent in plaintext
# from the host (or vice versa). This suite feeds ONE canonical sample list to BOTH engines and asserts
# they AGREE on every case (both redact a secret sample; both leave clean prose untouched). drift-detection:
# duplicate security logic in 2 places, locked together so neither can fall behind. Mirrors the
# test-provider-consistency.sh pattern (#165). Proven non-vacuous by a break→RED→restore on either engine.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CP="$ROOT/packages/control-plane"
MOD="$CP/src/redact.ts"
RJQ="$ROOT/home/dot_local/bin/aid-redact.jq"
export MOD

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "redactor parity (server redact.ts <-> client aid-redact.jq)"

if [ ! -f "$MOD" ]; then fail "server redactor missing: $MOD"; echo "redact-parity: 0 passed, 1 failed"; exit 1; fi
if [ ! -f "$RJQ" ]; then fail "client redactor missing: $RJQ"; echo "redact-parity: 0 passed, 1 failed"; exit 1; fi
if ! command -v jq >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  say "jq or node absent — parity suite skipped (needs both engines)"
  echo "redact-parity: 0 passed, 0 failed"
  exit 0
fi

# Canonical samples: EXPECT<TAB>label<TAB>sample  (EXPECT = R must-redact, or . must-NOT-change).
# One per shape covered by BOTH redactors + clean prose that must survive. (PEM multiline tested below.)
SAMPLES="$(mktemp)"
cat > "$SAMPLES" <<'EOF'
R	bearer	header Authorization: Bearer abcdefgh12345678wxyz
R	aws	env AKIA1234567890ABCDEF set
R	ghp	clone ghp_ABCDEFGHIJ1234567890KLMN today
R	ghpat	pat github_pat_11ABCDEFG0abcdefghij1234
R	sk	key sk-ant-ABCDEFGHIJ1234567890 live
R	xox	slack xoxb-123456789012-abcdefghijkl here
R	passwd	mysql --password=hunter2hunter2
R	tokenkv	api token=abcdefghij1234567890XY done
R	apikeyjson	{"api_key":"k9f8s7d6f5g4h3j2l1q0"}
.	clean_install	installed ripgrep via brew (1069 of 1069 apps)
.	clean_plan	apply: 3 packages, 2 services, revision 42
.	clean_corr	run_abc123def456 completed
EOF
export SAMPLES

# ONE node pass emits the SERVER verdict per line: EXPECT<TAB>label<TAB>serverVerdict<TAB>sample.
SV="$(cd "$CP" && node --input-type=module <<'NODE' 2>/dev/null
const { redactSecrets } = await import(process.env.MOD);
import fs from 'node:fs';
for (const line of fs.readFileSync(process.env.SAMPLES, 'utf8').split('\n').filter(Boolean)) {
  const [exp, label, ...rest] = line.split('\t');
  const sample = rest.join('\t');
  const v = redactSecrets(sample).includes('[REDACTED]') ? 'R' : '.';
  console.log([exp, label, v, sample].join('\t'));
}
NODE
)"

# For each line, compute the CLIENT verdict (jq on the sample as a JSON string value) + assert
# server == client == expected (agreement + correctness in one).
while IFS=$'\t' read -r exp label sv sample; do
  [ -n "$exp" ] || continue
  cv="$(printf '%s' "$sample" | jq -R '{s: .}' | jq -c -f "$RJQ" 2>/dev/null | grep -qF '[REDACTED]' && echo R || echo .)"
  if [ "$sv" = "$exp" ] && [ "$cv" = "$exp" ]; then
    pass "parity[$label]: server=$sv client=$cv == expected ($exp)"
  else
    fail "parity[$label]: server=$sv client=$cv expected=$exp — DRIFT (a shape one engine redacts the other does not) or wrong verdict"
  fi
done <<< "$SV"
rm -f "$SAMPLES"

# Multiline PEM private-key block — both engines must scrub the whole block.
PEM="$(printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rSECRETkey\n-----END OPENSSH PRIVATE KEY-----')"
pv="$(cd "$CP" && PEM="$PEM" node --input-type=module <<'NODE' 2>/dev/null
const { redactSecrets } = await import(process.env.MOD);
console.log(redactSecrets(process.env.PEM).includes('[REDACTED]') && !redactSecrets(process.env.PEM).includes('SECRET') ? 'R' : '.');
NODE
)"
pcj="$(printf '%s' "$PEM" | jq -R -s '{s: .}' | jq -c -f "$RJQ" 2>/dev/null)"
if [ "$pv" = "R" ] && printf '%s' "$pcj" | grep -qF '[REDACTED]' && ! printf '%s' "$pcj" | grep -qF 'SECRET'; then
  pass "parity[pem]: server=R client=R — multiline PRIVATE KEY block scrubbed by both"
else
  fail "parity[pem]: server=$pv client=$(printf '%s' "$pcj" | grep -qF '[REDACTED]' && echo R || echo .) — PEM parity broken"
fi

say "redact-parity: $P passed, $F failed"
[ "$F" -eq 0 ]
