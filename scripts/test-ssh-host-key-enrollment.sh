#!/usr/bin/env bash
# R08 contract: SSH host trust is explicit, pinned, offline, atomic, and
# reversible. This test intentionally exercises only public host keys.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBJECT="$ROOT/scripts/ssh-host-key-enrollment.sh"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

if [ -x "$SUBJECT" ]; then
  pass 'explicit SSH host-key enrollment command is executable'
else
  fail 'scripts/ssh-host-key-enrollment.sh is missing or not executable'
fi

# Production trust acquisition must never be delegated to the network. Test and
# fixture harnesses are excluded because ephemeral CI machines may deliberately
# opt out of production trust policy.
PRODUCTION_FILES=()
find "$ROOT/start.sh" "$ROOT/scripts/provision.sh" "$ROOT/qubes" "$ROOT/home" \
  -type f \
  ! -path '*/test-*' \
  ! -path '*/dot_local/share/bash-completion/*' \
  ! -path '*/dot_local/share/ansible/*' \
  ! -path '*/docs/*' \
  -print >"$TMP/production-files" 2>/dev/null
while IFS= read -r line; do PRODUCTION_FILES+=("$line"); done <"$TMP/production-files"

if ! grep -nE '(^|[^[:alnum:]_-])ssh-keyscan([^[:alnum:]_-]|$)' "${PRODUCTION_FILES[@]}" 2>/dev/null \
  | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*#' >"$TMP/keyscan"; then
  pass 'production contains no ssh-keyscan trust acquisition'
else
  fail "production invokes ssh-keyscan: $(head -1 "$TMP/keyscan")"
fi
if ! grep -nEi 'StrictHostKeyChecking[[:space:]=]+(no|accept-new)([^[:alnum:]-]|$)' "${PRODUCTION_FILES[@]}" 2>/dev/null \
  | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*#' >"$TMP/strict"; then
  pass 'production never disables or weakens strict host-key checking'
else
  fail "production weakens StrictHostKeyChecking: $(head -1 "$TMP/strict")"
fi
if ! grep -nEi 'UserKnownHostsFile[[:space:]=]+(/dev/null|none)([^[:alnum:]_/.-]|$)' "${PRODUCTION_FILES[@]}" 2>/dev/null \
  | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*#' >"$TMP/disabled-store"; then
  pass 'production never disables the known_hosts trust store'
else
  fail "production disables known_hosts: $(head -1 "$TMP/disabled-store")"
fi

if [ ! -x "$SUBJECT" ] || ! command -v ssh-keygen >/dev/null 2>&1; then
  [ -x "$SUBJECT" ] || fail 'functional enrollment assertions skipped because the command is absent'
  command -v ssh-keygen >/dev/null 2>&1 || fail 'functional enrollment assertions require ssh-keygen'
  printf 'ssh-host-key-enrollment: %d passed, %d failed\n' "$P" "$F"
  [ "$F" -eq 0 ]
  exit
fi

mkdir -m 0700 "$TMP/trust"
KNOWN_HOSTS="$TMP/trust/known_hosts"
printf 'legacy.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAXhP1hQzV7P2TeR3nE7lL1glVTLyI94Wm4d7vY0X9yQ\n' >"$KNOWN_HOSTS"
chmod 0600 "$KNOWN_HOSTS"
LEGACY_LINE="$(cat "$KNOWN_HOSTS")"

ssh-keygen -q -t ed25519 -N '' -f "$TMP/old" </dev/null
ssh-keygen -q -t ed25519 -N '' -f "$TMP/new" </dev/null
OLD_TYPE="$(awk '{print $1}' "$TMP/old.pub")"
OLD_KEY="$(awk '{print $2}' "$TMP/old.pub")"
OLD_FP="$(ssh-keygen -lf "$TMP/old.pub" -E sha256 | awk '{print $2}')"
NEW_TYPE="$(awk '{print $1}' "$TMP/new.pub")"
NEW_KEY="$(awk '{print $2}' "$TMP/new.pub")"
NEW_FP="$(ssh-keygen -lf "$TMP/new.pub" -E sha256 | awk '{print $2}')"

run_ok() {
  local label="$1"; shift
  if "$@" >"$TMP/stdout" 2>"$TMP/stderr"; then pass "$label"; else fail "$label: $(tail -1 "$TMP/stderr")"; fi
}
run_bad() {
  local label="$1"; shift
  if "$@" >"$TMP/stdout" 2>"$TMP/stderr"; then fail "$label"; else pass "$label"; fi
}
enroll_old() {
  "$SUBJECT" enroll --hostname node.example --port 2222 \
    --key-type "$OLD_TYPE" --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" \
    --known-hosts "$KNOWN_HOSTS" "$@"
}

run_ok 'an exact hostname, port, key type, key blob, and computed fingerprint enrolls' enroll_old
EXPECTED="[node.example]:2222 $OLD_TYPE $OLD_KEY"
if grep -Fxq "$EXPECTED" "$KNOWN_HOSTS" && grep -Fxq "$LEGACY_LINE" "$KNOWN_HOSTS"; then
  pass 'enrollment writes the exact endpoint and preserves unrelated trust'
else
  fail 'enrollment did not preserve exact endpoint and unrelated entries'
fi
run_ok 'an explicitly named alias can bind to the same approved key' \
  "$SUBJECT" enroll --hostname aliased.example --alias short.example --port 2022 \
  --key-type "$OLD_TYPE" --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" \
  --known-hosts "$KNOWN_HOSTS"
if { grep -Fxq "[aliased.example]:2022 $OLD_TYPE $OLD_KEY" "$KNOWN_HOSTS" \
    && grep -Fxq "[short.example]:2022 $OLD_TYPE $OLD_KEY" "$KNOWN_HOSTS"; } \
  || grep -Eq "^\[aliased\.example\]:2022,\[short\.example\]:2022 $OLD_TYPE $OLD_KEY$|^\[short\.example\]:2022,\[aliased\.example\]:2022 $OLD_TYPE $OLD_KEY$" "$KNOWN_HOSTS"; then
  pass 'approved canonical hostname and alias have one unambiguous key binding'
else
  fail 'approved alias was not bound unambiguously to the canonical endpoint'
fi
run_bad 'an alias already owned by another endpoint cannot be rebound' \
  "$SUBJECT" enroll --hostname other.example --alias short.example --port 2022 \
  --key-type "$NEW_TYPE" --key-base64 "$NEW_KEY" --fingerprint "$NEW_FP" \
  --known-hosts "$KNOWN_HOSTS"
MODE="$(stat -c '%a' "$KNOWN_HOSTS" 2>/dev/null || stat -f '%Lp' "$KNOWN_HOSTS")"
if [ "$MODE" = 600 ]; then pass 'known_hosts remains private mode 0600'; else fail "known_hosts mode is $MODE, expected 600"; fi

file_identity() {
  stat -c '%i:%Y:%s' "$1" 2>/dev/null || stat -f '%i:%m:%z' "$1"
}
sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}
BEFORE_HASH="$(sha256_file "$KNOWN_HOSTS")"
BEFORE_IDENTITY="$(file_identity "$KNOWN_HOSTS")"
sleep 1
run_ok 're-enrolling an identical pin succeeds' enroll_old
AFTER_HASH="$(sha256_file "$KNOWN_HOSTS")"
AFTER_IDENTITY="$(file_identity "$KNOWN_HOSTS")"
if [ "$BEFORE_HASH:$BEFORE_IDENTITY" = "$AFTER_HASH:$AFTER_IDENTITY" ]; then
  pass 'identical enrollment is a byte- and metadata-preserving no-op'
else
  fail 'identical enrollment rewrote the trust store'
fi

cp "$KNOWN_HOSTS" "$TMP/before-invalid"
run_bad 'a missing fingerprint cannot enroll even github.com' \
  "$SUBJECT" enroll --hostname github.com --port 22 --key-type "$OLD_TYPE" \
  --key-base64 "$OLD_KEY" --known-hosts "$KNOWN_HOSTS"
run_bad 'a mismatched computed fingerprint is rejected' \
  "$SUBJECT" enroll --hostname node2.example --port 22 --key-type "$OLD_TYPE" \
  --key-base64 "$OLD_KEY" --fingerprint "$NEW_FP" --known-hosts "$KNOWN_HOSTS"
run_bad 'a key blob whose wire type disagrees with key-type is rejected' \
  "$SUBJECT" enroll --hostname node2.example --port 22 --key-type ssh-rsa \
  --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" --known-hosts "$KNOWN_HOSTS"
run_bad 'invalid base64 key material is rejected' \
  "$SUBJECT" enroll --hostname node2.example --port 22 --key-type "$OLD_TYPE" \
  --key-base64 'not-base64!' --fingerprint "$OLD_FP" --known-hosts "$KNOWN_HOSTS"
run_bad 'an unsigned known_hosts artifact is rejected' \
  "$SUBJECT" enroll --artifact "$TMP/old.pub" --known-hosts "$KNOWN_HOSTS"
run_bad 'a wildcard hostname is rejected as ambiguous' \
  "$SUBJECT" enroll --hostname '*.example' --port 22 --key-type "$OLD_TYPE" \
  --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" --known-hosts "$KNOWN_HOSTS"
run_bad 'a comma-separated hostname alias set is rejected as ambiguous' \
  "$SUBJECT" enroll --hostname 'node2.example,node-two' --port 22 --key-type "$OLD_TYPE" \
  --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" --known-hosts "$KNOWN_HOSTS"
run_bad 'an out-of-range port is rejected' \
  "$SUBJECT" enroll --hostname node2.example --port 65536 --key-type "$OLD_TYPE" \
  --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" --known-hosts "$KNOWN_HOSTS"
if cmp -s "$KNOWN_HOSTS" "$TMP/before-invalid"; then
  pass 'all rejected enrollment inputs leave trust bytes unchanged'
else
  fail 'a rejected enrollment input mutated trust'
fi

ln -s "$KNOWN_HOSTS" "$TMP/trust/symlink-known-hosts"
run_bad 'a symlink trust target is rejected' \
  "$SUBJECT" enroll --hostname node2.example --port 22 --key-type "$OLD_TYPE" \
  --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" \
  --known-hosts "$TMP/trust/symlink-known-hosts"
mkdir -m 0777 "$TMP/public-parent"
touch "$TMP/public-parent/known_hosts"
chmod 0600 "$TMP/public-parent/known_hosts"
run_bad 'a trust store in a group/world-accessible parent is rejected' \
  "$SUBJECT" enroll --hostname node2.example --port 22 --key-type "$OLD_TYPE" \
  --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" \
  --known-hosts "$TMP/public-parent/known_hosts"

# A poisoned PATH makes any attempted network trust acquisition visible. Local
# verification through ssh-keygen remains available from its original path.
mkdir -m 0700 "$TMP/guard-bin"
NETWORK_LOG="$TMP/network.log"
for command_name in ssh-keyscan curl wget nc git ssh; do
  # shellcheck disable=SC2016
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$0 $*" >> "$NETWORK_LOG"\nexit 97\n' \
    >"$TMP/guard-bin/$command_name"
  chmod 0700 "$TMP/guard-bin/$command_name"
done
export NETWORK_LOG
run_ok 'enrollment succeeds without acquiring trust from the network' \
  env PATH="$TMP/guard-bin:$PATH" "$SUBJECT" enroll --hostname offline.example --port 2200 \
    --key-type "$OLD_TYPE" --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" \
    --known-hosts "$KNOWN_HOSTS"
if [ ! -s "$NETWORK_LOG" ]; then pass 'no network-capable trust command was invoked'; else fail "network trust was attempted: $(head -1 "$NETWORK_LOG")"; fi

run_ok 'a rotation requires and replaces the exact current fingerprint' \
  "$SUBJECT" rotate --hostname node.example --port 2222 --old-fingerprint "$OLD_FP" \
  --key-type "$NEW_TYPE" --key-base64 "$NEW_KEY" --fingerprint "$NEW_FP" \
  --known-hosts "$KNOWN_HOSTS"
if grep -Fxq "[node.example]:2222 $NEW_TYPE $NEW_KEY" "$KNOWN_HOSTS" \
  && ! grep -F "[node.example]:2222 " "$KNOWN_HOSTS" | grep -Fq "$OLD_KEY"; then
  pass 'rotation leaves exactly the approved replacement key'
else
  fail 'rotation retained the old key or omitted the replacement'
fi
cp "$KNOWN_HOSTS" "$TMP/before-bad-rotation"
run_bad 'rotation with a stale current fingerprint is rejected' \
  "$SUBJECT" rotate --hostname node.example --port 2222 --old-fingerprint "$OLD_FP" \
  --key-type "$OLD_TYPE" --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" \
  --known-hosts "$KNOWN_HOSTS"
if cmp -s "$KNOWN_HOSTS" "$TMP/before-bad-rotation"; then
  pass 'rejected stale rotation preserves trust bytes'
else
  fail 'rejected stale rotation mutated trust'
fi

run_bad 'revocation with a stale fingerprint is rejected' \
  "$SUBJECT" revoke --hostname node.example --port 2222 --fingerprint "$OLD_FP" \
  --known-hosts "$KNOWN_HOSTS"
run_ok 'revocation removes only an exact endpoint and fingerprint' \
  "$SUBJECT" revoke --hostname node.example --port 2222 --fingerprint "$NEW_FP" \
  --known-hosts "$KNOWN_HOSTS"
if ! grep -Fq '[node.example]:2222 ' "$KNOWN_HOSTS" \
  && grep -Fxq "$LEGACY_LINE" "$KNOWN_HOSTS" \
  && grep -Fq '[offline.example]:2200 ' "$KNOWN_HOSTS"; then
  pass 'revocation preserves every unrelated trust entry'
else
  fail 'revocation removed unrelated trust or retained the endpoint'
fi

# Repeated foreground rotations race a read-only observer. Every observed file
# must be one complete valid version; partial/truncated output exposes a
# non-atomic update even when the final bytes look correct.
run_ok 'atomicity fixture endpoint enrolls' enroll_old
ATOMIC_FAILURE="$TMP/atomic-failure"
(
  while [ ! -e "$TMP/atomic-stop" ]; do
    snapshot="$(grep -F '[node.example]:2222 ' "$KNOWN_HOSTS" 2>/dev/null || true)"
    case "$snapshot" in
      "$EXPECTED"|"[node.example]:2222 $NEW_TYPE $NEW_KEY") ;;
      *) printf '%s\n' "$snapshot" >"$ATOMIC_FAILURE"; break ;;
    esac
  done
) &
OBSERVER_PID=$!
for _ in 1 2 3 4 5; do
  "$SUBJECT" rotate --hostname node.example --port 2222 --old-fingerprint "$OLD_FP" \
    --key-type "$NEW_TYPE" --key-base64 "$NEW_KEY" --fingerprint "$NEW_FP" \
    --known-hosts "$KNOWN_HOSTS" >/dev/null 2>&1 || break
  "$SUBJECT" rotate --hostname node.example --port 2222 --old-fingerprint "$NEW_FP" \
    --key-type "$OLD_TYPE" --key-base64 "$OLD_KEY" --fingerprint "$OLD_FP" \
    --known-hosts "$KNOWN_HOSTS" >/dev/null 2>&1 || break
done
touch "$TMP/atomic-stop"
wait "$OBSERVER_PID" 2>/dev/null || true
if [ ! -e "$ATOMIC_FAILURE" ]; then pass 'concurrent readers observe only whole atomic trust-store versions'; else fail 'a concurrent reader observed partial trust-store state'; fi
if ! find "$TMP/trust" -maxdepth 1 -type f ! -name known_hosts -print -quit | grep -q .; then
  pass 'successful updates leave no temporary trust files'
else
  fail 'successful updates left a temporary trust file'
fi

printf 'ssh-host-key-enrollment: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
