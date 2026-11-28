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
