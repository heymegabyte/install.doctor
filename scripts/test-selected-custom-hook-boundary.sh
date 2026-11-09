#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVISION="$ROOT/scripts/provision.sh"

grep -Fq 'const customPostHooksTask = adminCustomHookManifest.length > 0 ? {' "$PROVISION"
grep -Fq "const customUserPostHooksTask = userCustomHookManifest.length > 0 ? {" "$PROVISION"
grep -Fq "id: 'desired.custom-user-post-hooks'" "$PROVISION"
grep -Fq "privilege: 'user', network: 'required'" "$PROVISION"
grep -Fq "consent: 'network', lockDomains: ['custom-post-hooks']" "$PROVISION"
grep -Fq 'customUserPostHooksTask?.id ?? customPostHooksTask?.id ?? catalogPostValidationTask.id' "$PROVISION"
grep -Fq '...(customPostHooksTask ? [customPostHooksTask] : [])' "$PROVISION"
grep -Fq '...(customUserPostHooksTask ? [customUserPostHooksTask] : [])' "$PROVISION"
grep -Fq '...(customPostHooksTask ? {' "$PROVISION"
grep -Fq '...(customUserPostHooksTask ? {' "$PROVISION"
grep -Fq "task.id === 'desired.custom-post-hooks'" "$ROOT/scripts/test-bootstrap-install-acceptance.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/home/.local/bin/post-installx" "$TMP/bin"
HOOK="$TMP/home/.local/bin/post-installx/post-fixture.sh"
cat > "$HOOK" <<'HOOK'
#!/usr/bin/env bash
case "${1:-}" in --check|--verify) exit 0 ;; --apply) exit 0 ;; *) exit 2 ;; esac
HOOK
chmod 0700 "$HOOK"
DIGEST="$(shasum -a 256 "$HOOK" | awk '{print $1}')"
cat > "$TMP/bin/bash" <<'HOSTILE'
#!/usr/bin/env sh
: > "$HOSTILE_BASH_MARKER"
exit 99
HOSTILE
chmod 0700 "$TMP/bin/bash"

HOME="$TMP/home" PATH="$TMP/bin:$PATH" HOSTILE_BASH_MARKER="$TMP/hostile-bash-ran" \
  INSTALL_DOCTOR_CUSTOM_HOOK_KEYS=fixture INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST="fixture=$DIGEST" \
  /bin/bash -c 'source "$1"; logg() { :; }; idRunSelectedPostInstallxHooks verify' _ "$PROVISION"
test ! -e "$TMP/hostile-bash-ran"

rm -f "$HOOK"
if HOME="$TMP/home" INSTALL_DOCTOR_CUSTOM_HOOK_KEYS=fixture INSTALL_DOCTOR_CUSTOM_HOOK_MANIFEST="fixture=$DIGEST" \
  /bin/bash -c 'source "$1"; logg() { :; }; idRunSelectedPostInstallxHooks verify' _ "$PROVISION"; then
  printf '%s\n' 'selected custom hook deletion was accepted' >&2
  exit 1
fi

printf '%s\n' 'selected-custom-hook-boundary: 13 passed, 0 failed'
