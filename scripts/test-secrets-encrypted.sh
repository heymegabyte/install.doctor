#!/usr/bin/env bash
# Plaintext-secret envelope gate (SEC-20 from the wave-two security removal catalog).
#
# The secrets store home/.chezmoitemplates/secrets/** must ship ONLY age-encrypted values, so every
# regular file in it MUST begin with the `-----BEGIN AGE ENCRYPTED FILE-----` envelope. Eleven
# Previously committed plaintext credential files have now been converted to verified age envelopes.
# This gate blocks any plaintext secret from landing and keeps the historical known-debt mechanism
# empty unless a future explicitly reviewed exception is introduced.
#
# Non-vacuity: (a) the detector is re-run against a planted temp fixture to prove it actually flags a
# plaintext file, and (b) the known-debt allowlist is asserted to still be plaintext — the moment a
# name is age-encrypted or deleted, this gate FAILS and requires its removal from the allowlist, so the
# allowlist can never silently mask a future re-plaintexting of a name it once exempted.
#
# Pure file-header assertions — no secret VALUES are ever read or printed; only paths/names are emitted.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

SECRETS="$ROOT/home/.chezmoitemplates/secrets"
ENVELOPE="-----BEGIN AGE ENCRYPTED FILE-----"
# The non-armored age binary format. It is ENCRYPTED, not plaintext, but it violates the store's
# armored-envelope invariant; classifying it as "plaintext debt" would hide a real ciphertext behind a
# human-rotation allowlist entry (this is exactly how UNKEY_DATABASE_PRIMARY was mis-triaged).
BINARY_AGE_MAGIC="age-encryption.org/v1"

# Reviewed committed-plaintext debt. Keep empty while the store satisfies the age-envelope invariant.
KNOWN_PLAINTEXT=''

say "secrets-encrypted (AGE envelope invariant; no secret VALUES read)"

if [ ! -d "$SECRETS" ]; then
  fail "secrets store home/.chezmoitemplates/secrets is missing"
  say "secrets-encrypted: $P passed, $F failed"
  exit 1
fi
pass "secrets store present"

# Enumerate every regular file. Three classes: armored ciphertext (the invariant), non-armored binary
# age ciphertext (encrypted but non-conforming), and genuine plaintext (the known-debt class).
# Symlinks and directories are skipped (secrets-macbook-pro is a tracked symlink alias, not a secret).
plaintext=""
binary_age=""
total=0
for f in "$SECRETS"/*; do
  [ -f "$f" ] || continue
  total=$((total + 1))
  if [ "$(head -c "${#ENVELOPE}" "$f")" = "$ENVELOPE" ]; then
    continue
  fi
  if [ "$(head -c "${#BINARY_AGE_MAGIC}" "$f")" = "$BINARY_AGE_MAGIC" ]; then
    binary_age="$binary_age $(basename "$f")"
  else
    plaintext="$plaintext $(basename "$f")"
  fi
done
[ "$total" -gt 0 ] && pass "secrets store is non-empty ($total files enumerated)" || fail "secrets store enumerated zero regular files"

# 0. No unarmored binary-age ciphertext: it is encrypted (so it must NOT be listed as plaintext debt),
#    but every store entry must carry the armored envelope so a human can tell ciphertext from plaintext.
if [ -z "$binary_age" ]; then
  pass "no unarmored binary-age ciphertext (every encrypted entry uses the armored envelope)"
else
  for name in $binary_age; do
    fail "unarmored binary-age ciphertext (re-armor with 'age -a'): $name"
  done
fi

# 1. No NEW plaintext: every non-envelope file must already be in the known-debt allowlist.
new=0
for name in $plaintext; do
  case " $KNOWN_PLAINTEXT " in
    *" $name "*) : ;;
    *) fail "plaintext secret outside the known-debt allowlist (path only): $name"; new=1 ;;
  esac
done
[ "$new" -eq 0 ] && pass "no new plaintext secret — every non-envelope file is recorded known debt"

# 2. The allowlist stays tight: every known-debt name must still be plaintext right now. If it was
#    age-encrypted or removed, drop it from KNOWN_PLAINTEXT, else the entry would silently exempt a
#    future re-plaintexting of that exact name.
stale=0
for name in $KNOWN_PLAINTEXT; do
  case " $plaintext " in
    *" $name "*) : ;;
    *) fail "known-debt name '$name' is no longer plaintext — remove it from KNOWN_PLAINTEXT (a stale allowlist entry masks future regressions)"; stale=1 ;;
  esac
done
[ "$stale" -eq 0 ] && pass "known-plaintext allowlist is current (no stale exemptions)"

# 3. Non-vacuous self-test: the exact classifier, re-run against planted temp fixtures, must flag a
#    plaintext file as plaintext, a binary-age file as binary-age (NOT plaintext), and pass an armored one.
tmp="$(mktemp -d)"
printf '%s\n' "$ENVELOPE" > "$tmp/encrypted.age"
printf '%s\n' 'raw-secret-value' > "$tmp/plaintext.secret"
printf '%s\n' "$BINARY_AGE_MAGIC" > "$tmp/binary.age"
found=""
binfound=""
for f in "$tmp"/*; do
  [ "$(head -c "${#ENVELOPE}" "$f")" = "$ENVELOPE" ] && continue
  if [ "$(head -c "${#BINARY_AGE_MAGIC}" "$f")" = "$BINARY_AGE_MAGIC" ]; then
    binfound="$binfound $(basename "$f")"
  else
    found="$found $(basename "$f")"
  fi
done
rm -rf "$tmp"
case " $found " in
  *" plaintext.secret "*) pass "detector flags a planted plaintext file (non-vacuous)" ;;
  *) fail "detector missed a planted plaintext file — the envelope check is vacuous" ;;
esac
case " $binfound " in
  *" binary.age "*) pass "classifier separates binary-age ciphertext from plaintext (non-vacuous)" ;;
  *) fail "classifier missed a planted binary-age file — it would be mis-triaged as plaintext debt" ;;
esac
case " $found " in
  *" binary.age "*) fail "classifier wrongly reported encrypted binary-age ciphertext as plaintext" ;;
  *) pass "encrypted binary-age ciphertext is never counted as plaintext debt" ;;
esac

say "secrets-encrypted: $P passed, $F failed"
[ "$F" -eq 0 ]
