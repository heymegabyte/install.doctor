#!/usr/bin/env bash
# Secret-hygiene gate (new-arc secret-sweep axis: #295 post-installx /tmp · #296 chezmoiscripts/partials).
#
# The provisioning path handles real secrets — the age MASTER key (which unlocks EVERY chezmoi-encrypted
# secret), SUDO_PASSWORD, per-tool tokens. The #295 post-installx `/tmp`-secret class is locked by
# test-post-installx-dispatch A12 (a hook writing a get-secret value to /tmp must chmod-600 + clean it).
# This suite locks the CROWN-JEWEL invariant the #296 chezmoiscripts sweep confirmed correct-but-ungated:
# the decrypted age decryption key MUST be chmod-600'd and decrypted DIRECTLY to its final config path —
# never staged world-readable. A future edit dropping the chmod (or staging the key in /tmp) would leave
# the master key readable by any local user → every encrypted secret in the repo is decryptable. #296.
# Pure file assertions — no network, no secret VALUES read.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "secret-hygiene (age MASTER key perms + direct-decrypt; the secret-sweep axis #295/#296)"

AGE="home/.chezmoiscripts/universal/run_before_03-decrypt-age-key.sh.tmpl"

# 1. The decrypted age MASTER key (~/.config/age/chezmoi.txt — it unlocks every chezmoi-encrypted secret)
#    MUST be chmod-600'd by run_before_03. Dropping this leaves the master key world-readable: any local
#    user could then decrypt EVERY secret the repo ships. Correct today (an "Ensure proper permissions"
#    block), but UNGATED until now — a catastrophic-if-regressed invariant worth a deterministic lock.
if [ ! -f "$AGE" ]; then
  fail "run_before_03-decrypt-age-key.sh.tmpl missing — the age master-key handler (+ its chmod-600) is gone"
elif grep -qE 'chmod 0?600[^&|;]*age/chezmoi\.txt' "$AGE"; then
  pass "run_before_03 chmod-600's the decrypted age MASTER key (~/.config/age/chezmoi.txt — not world-readable)"
else
  fail "run_before_03 does NOT chmod 600 the decrypted age master key — it would be world-readable (any local user could decrypt EVERY chezmoi secret)"
fi

# 2. The key is decrypted DIRECTLY to its final config path via `age --decrypt --output …age/chezmoi.txt`,
#    never staged in a world-readable intermediate (e.g. `age -d … > /tmp/…`). A temp-staged master key —
#    even briefly, even if later moved — is a world-readable window on the crown jewel.
if [ ! -f "$AGE" ]; then
  fail "run_before_03 missing — cannot verify the direct-decrypt invariant"
elif grep -qE 'age --decrypt --output[^&|;]*age/chezmoi\.txt' "$AGE" && ! grep -qE 'age (--decrypt|-d)[^&|;]*>[[:space:]]*/tmp' "$AGE"; then
  pass "run_before_03 decrypts the age master key DIRECTLY to its config path (never staged world-readable in /tmp)"
else
  fail "run_before_03 does not decrypt the age key directly to its config path, or stages it in /tmp — the master key transits a world-readable location"
fi

say "secret-hygiene: $P passed, $F failed"
[ "$F" -eq 0 ]
