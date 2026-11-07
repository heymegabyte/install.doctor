#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILES=(
  "$ROOT/start.sh"
  "$ROOT/scripts/provision.sh"
  "$ROOT/scripts/qubes-provision.sh"
  "$ROOT/qubes/setup.sh"
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
grep -Fq 'shasum -a 256 "$0"' "$ROOT/start.sh" \
  || fail 'start.sh lacks the macOS-native SHA-256 fallback'
! grep -Fq 'date -r "$0"' "$ROOT/start.sh" \
  || fail 'start.sh misuses the nonportable date -r file fallback'
TASK_BOOTSTRAP="$ROOT/scripts/lib/task-bootstrap.sh"
grep -Eq "readonly INSTALL_DOCTOR_TASK_VERSION='v[0-9]+\.[0-9]+\.[0-9]+'" "$TASK_BOOTSTRAP" \
  || fail 'legacy Task bootstrap does not pin an immutable release'
! grep -Eq 'releases/(latest|download/latest)|releases/latest|api\.github\.com/repos/go-task/task/releases/latest' "$ROOT/start.sh" "$TASK_BOOTSTRAP" \
  || fail 'legacy Task bootstrap still resolves a mutable latest release'
grep -Fq -- "--max-filesize \"\$INSTALL_DOCTOR_TASK_MAX_ARCHIVE_BYTES\"" "$TASK_BOOTSTRAP" \
  || fail 'legacy Task bootstrap does not bound its download'
grep -Fq 'task_bootstrap_preflight_archive' "$TASK_BOOTSTRAP" \
  || fail 'legacy Task bootstrap does not preflight the archive'
! grep -Fq '/tmp/megabytelabs' "$ROOT/start.sh" "$TASK_BOOTSTRAP" \
  || fail 'legacy Task bootstrap uses a shared predictable temporary path'
! grep -Eq 'Homebrew/install/(HEAD|main|master)/install\.sh' "$ROOT/scripts/provision.sh" \
  || fail 'provision.sh executes the Homebrew installer from a mutable branch'
grep -Eq "HOMEBREW_INSTALL_COMMIT='[0-9a-f]{40}'" "$ROOT/scripts/provision.sh" \
  || fail 'provision.sh does not pin the Homebrew installer to an immutable commit'

grep -Eq 'sudo .* -v' "$ROOT/scripts/provision.sh" \
  || fail 'provision.sh does not use the sudo credential cache'
grep -Fq 'sudo -k' "$ROOT/scripts/provision.sh" \
  || fail 'provision.sh does not invalidate cached sudo credentials during cleanup'
! grep -Fq 'export -p > "$ENV_EXPORT"' "$ROOT/scripts/provision.sh" \
  || fail 'root-to-user handoff exports the entire process environment'
grep -Fq 'for HANDOFF_VARIABLE in' "$ROOT/scripts/provision.sh" \
  || fail 'root-to-user handoff lacks a fixed environment allowlist'

for adapter in "$ROOT/scripts/qubes-provision.sh" "$ROOT/qubes/setup.sh"; do
  grep -Fq 'your-repo' "$adapter" && fail "${adapter#"$ROOT/"} retains a placeholder repository"
  ! grep -Eq '(^|[[:space:]])(git clone|npm install|pulumi up|systemctl (enable|start|enable --now))' "$adapter" \
    || fail "${adapter#"$ROOT/"} mutates outside the canonical provisioner"
done

printf 'Bootstrap security tests passed.\n'
