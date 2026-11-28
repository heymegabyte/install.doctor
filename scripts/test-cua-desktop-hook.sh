#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="$root/home/dot_local/bin/post-installx/executable_post-cua-driver.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

export HOME="$fixture/home"
export CUA_TEST_LOG="$fixture/calls"
export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$HOME"/{.local/bin,.codex,.config/opencode}
printf '[incomplete\n' > "$HOME/.codex/config.toml"
printf '{incomplete\n' > "$HOME/.config/opencode/opencode.json"
printf '{existing\n' > "$HOME/.claude.json"
snapshot() {
  find "$HOME" -type f ! -path "$HOME/.local/bin/*" ! -name agent-fleet-cua.service \
    -exec cksum {} \; | LC_ALL=C sort
}
before="$(snapshot)"
for command in cua-driver cua systemctl; do
  cat > "$HOME/.local/bin/$command" <<'STUB'
#!/usr/bin/env bash
printf '%s %s\n' "${0##*/}" "$*" >> "$CUA_TEST_LOG"
STUB
  chmod +x "$HOME/.local/bin/$command"
done

INSTALL_DOCTOR_CUA_DRIVER=1 HEADLESS_INSTALL=1 bash "$hook"
[[ ! -e "$CUA_TEST_LOG" ]]
[[ "$(snapshot)" == "$before" ]]

if [[ "$(uname -s)" == Linux ]]; then
  for attempt in 1 2; do
    DISPLAY=:99 HEADLESS_INSTALL=0 INSTALL_DOCTOR_CUA_DRIVER=1 bash "$hook"
  done
  [[ "$(snapshot)" == "$before" ]]
  [[ ! -d "$HOME/.agents" ]]
  [[ ! -d "$HOME/.openclaw" ]]
  [[ "$(grep -cFx 'cua-driver telemetry disable' "$CUA_TEST_LOG")" -eq 2 ]]
  [[ "$(grep -cFx 'systemctl --user enable --now agent-fleet-cua.service' "$CUA_TEST_LOG")" -eq 2 ]]
  ! grep -F 'cua-driver skills' "$CUA_TEST_LOG"
fi

# Compare a corrupt download before extraction or command publication.
if (( EUID != 0 )) && [[ "$(uname -s):$(uname -m)" =~ ^(Darwin:(arm64|x86_64)|Linux:(x86_64|aarch64|arm64))$ ]]; then
  mkdir -p "$fixture/reject-bin"
  cat > "$fixture/reject-bin/curl" <<'STUB'
#!/usr/bin/env bash
while (( $# )); do
  if [[ "$1" == --output ]]; then
    printf '%s\n' 'incorrect fixture bytes' > "$2"
    exit 0
  fi
  shift
done
exit 1
STUB
  chmod +x "$fixture/reject-bin/curl"
  if HOME="$fixture/rejected" XDG_DATA_HOME="$fixture/rejected/share" \
    PATH="$fixture/reject-bin:$PATH" \
    bash "$root/home/dot_local/bin/executable_install-cua-driver-runtime" >"$fixture/rejection" 2>&1; then
    echo 'The Cua Driver installer accepted an incorrect digest.' >&2
    exit 1
  fi
  grep -Fx 'Pinned Cua Driver archive digest mismatch.' "$fixture/rejection"
  [[ ! -e "$fixture/rejected/.local/bin/cua-driver" ]]
  [[ -z "$(find "$fixture/rejected/share" -name '.stage.*' -print)" ]]
fi
