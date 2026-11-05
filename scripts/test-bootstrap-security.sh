#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILES=(
  "$ROOT/start.sh"
  "$ROOT/scripts/provision.sh"
  "$ROOT/scripts/src/provision.sh.tmpl"
)

fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }

for file in "${FILES[@]}"; do
  label="${file#"$ROOT/"}"
  ! grep -Eq 'NOPASSWD[[:space:]]*:[[:space:]]*(ALL|ALL\b)' "$file" \
    || fail "$label grants blanket passwordless sudo"
  ! grep -Eq 'ssh-keyscan' "$file" \
    || fail "$label trusts an unauthenticated ssh-keyscan result"
  ! grep -Eq 'git (reset --hard|stash drop|stash clear)|git push --force' "$file" \
    || fail "$label can destroy or rewrite user git state"
done

! grep -Eq '(curl|wget)[^|;]*\|[[:space:]]*(/bin/)?(ba)?sh|bash -c "\$\(curl' "$ROOT/start.sh" \
  || fail 'start.sh executes mutable remote installer output'
! grep -Eq 'Homebrew/install/(HEAD|main|master)/install\.sh' "$ROOT/scripts/provision.sh" \
  || fail 'provision.sh executes the Homebrew installer from a mutable branch'
grep -Eq "HOMEBREW_INSTALL_COMMIT='[0-9a-f]{40}'" "$ROOT/scripts/provision.sh" \
  || fail 'provision.sh does not pin the Homebrew installer to an immutable commit'

grep -Eq 'sudo .* -v' "$ROOT/scripts/provision.sh" \
  || fail 'provision.sh does not use the sudo credential cache'
grep -Fq 'sudo -k' "$ROOT/scripts/provision.sh" \
  || fail 'provision.sh does not invalidate cached sudo credentials during cleanup'

printf 'Bootstrap security tests passed.\n'
