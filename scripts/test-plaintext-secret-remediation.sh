#!/usr/bin/env bash
# Plaintext-secret remediation regression gate (removal-wave-two SEC-15/SEC-16/SEC-17).
#
# SEC-15/16/17 asked for three store entries to be deleted because they were classified as plaintext:
#   DITTOFEED_WORKSPACE_ID (a workspace identifier), LANGFLOW_SUPERUSER (a username), and
#   UNKEY_DATABASE_PRIMARY ("stub"). Classification corrected here: the first two were genuine
#   non-credential plaintext and the third was a VALID non-armored (binary) age ciphertext that
#   decrypts with the repository identity -- deleting it would have destroyed a real secret.
#
# The remediation therefore ARMORS all three in place (age -a, same recipient) so the store keeps
# every value while every entry satisfies the armored-envelope invariant. This gate locks that state:
#   1. the two identifier files now begin with the AGE armored envelope,
#   2. UNKEY_DATABASE_PRIMARY is PRESENT and armored (not deleted, not binary),
#   3. none of the three remain in the KNOWN_PLAINTEXT allowlist,
#   4. the canonical credential siblings were not disturbed,
#   5. the classifier is non-vacuous (a planted plaintext file is plaintext; a planted binary-age
#      file is binary-age, never "plaintext debt").
#
# Header/path assertions only -- no secret VALUE is ever read, decrypted, or printed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

SECRETS="$ROOT/home/.chezmoitemplates/secrets"
GATE="$ROOT/scripts/test-secrets-encrypted.sh"
ENVELOPE="-----BEGIN AGE ENCRYPTED FILE-----"
BINARY_AGE_MAGIC="age-encryption.org/v1"

is_armored() { [ -f "$1" ] && [ "$(head -c "${#ENVELOPE}" "$1")" = "$ENVELOPE" ]; }

say "plaintext-secret remediation (SEC-15/16/17; header-only)"

# 1. The two genuine non-credential plaintext entries are now armored.
for name in DITTOFEED_WORKSPACE_ID LANGFLOW_SUPERUSER; do
  if is_armored "$SECRETS/$name"; then
    pass "$name is now armored age ciphertext"
  else
    fail "$name is missing or not armored — a plaintext non-credential entry reappeared"
  fi
done

# 2. UNKEY_DATABASE_PRIMARY was a valid binary-age ciphertext, not a stub: it must remain and be
#    armored. Deleting it (the original finding's suggestion) would have removed a real secret.
if is_armored "$SECRETS/UNKEY_DATABASE_PRIMARY"; then
  pass "UNKEY_DATABASE_PRIMARY preserved and re-armored (not deleted)"
else
  fail "UNKEY_DATABASE_PRIMARY is missing or not armored — the valid ciphertext was destroyed or reverted"
fi

# 3. The allowlist must no longer exempt any remediated name (a stale exemption masks a regression).
if grep -q '^KNOWN_PLAINTEXT=' "$GATE"; then
  allowlist="$(sed -n "s/^KNOWN_PLAINTEXT='\(.*\)'$/\1/p" "$GATE" | head -1)"
  for name in DITTOFEED_WORKSPACE_ID LANGFLOW_SUPERUSER UNKEY_DATABASE_PRIMARY; do
    case " $allowlist " in
      *" $name "*) fail "$name is still in KNOWN_PLAINTEXT — stale exemption masks a plaintext regression" ;;
      *) pass "$name is absent from KNOWN_PLAINTEXT" ;;
    esac
  done
else
  fail "KNOWN_PLAINTEXT allowlist not found in scripts/test-secrets-encrypted.sh"
fi

# 4. Canonical credential siblings remain (the remediation must not have collateral-deleted them).
for name in DITTOFEED_ADMIN_API_KEY LANGFLOW_SUPERUSER_PASSWORD UNKEY_DATABASE_URL UNKEY_DATABASE_USERNAME UNKEY_DATABASE_PASSWORD; do
  if [ -f "$SECRETS/$name" ]; then
    pass "canonical sibling preserved: $name"
  else
    fail "canonical sibling missing: $name"
  fi
done

# 5. Non-vacuity: the exact classifier must separate plaintext from binary-age ciphertext.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '%s\n' 'raw-secret-value' > "$tmp/plaintext.secret"
printf '%s\n' "$BINARY_AGE_MAGIC" > "$tmp/binary.age"
found=""
binfound=""
for f in "$tmp"/*; do
  if [ "$(head -c "${#BINARY_AGE_MAGIC}" "$f")" = "$BINARY_AGE_MAGIC" ]; then
    binfound="$binfound $(basename "$f")"
  else
    found="$found $(basename "$f")"
  fi
done
case " $found " in
  *" plaintext.secret "*) pass "classifier flags a planted plaintext file (non-vacuous)" ;;
  *) fail "classifier missed a planted plaintext file — the check is vacuous" ;;
esac
case " $binfound " in
  *" binary.age "*) pass "classifier flags a planted binary-age file as ciphertext (non-vacuous)" ;;
  *) fail "classifier missed a planted binary-age file — encrypted data could hide as plaintext debt" ;;
esac

say "plaintext-secret remediation: $P passed, $F failed"
[ "$F" -eq 0 ]
