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
for command in cua-driver cua systemd-analyze; do
  cat > "$HOME/.local/bin/$command" <<'STUB'
#!/usr/bin/env bash
printf '%s %s\n' "${0##*/}" "$*" >> "$CUA_TEST_LOG"
STUB
  chmod +x "$HOME/.local/bin/$command"
done

INSTALL_DOCTOR_CUA_DRIVER=1 HEADLESS_INSTALL=1 bash "$hook"
[[ ! -e "$CUA_TEST_LOG" ]]
[[ "$(snapshot)" == "$before" ]]

if [[ "$(uname -s)" == Linux ]] && (( EUID != 0 )); then
  cp "$root/home/dot_local/bin/executable_configure-cua-linux-autostart" \
    "$HOME/.local/bin/configure-cua-linux-autostart"
  cat > "$HOME/.local/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "$*" >> "$CUA_TEST_LOG"
if [[ "$*" == '--user --no-reload enable agent-fleet-cua.service' ]]; then
  unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir/graphical-session.target.wants"
  ln -s "$unit_dir/agent-fleet-cua.service" "$unit_dir/graphical-session.target.wants/agent-fleet-cua.service"
fi
STUB
  chmod +x "$HOME/.local/bin/systemctl"
  cat > "$HOME/.local/bin/loginctl" <<'STUB'
#!/usr/bin/env bash
mode=${FIXTURE_CUA_SESSION_MODE:-local}
if [[ "$1" == list-sessions ]]; then
  if [[ "$mode" == missing ]]; then exit 1; fi
  uid=$EUID
  if [[ "$mode" == other-user ]]; then uid=$((EUID + 1)); fi
  printf 'seat-session %s user seat0 tty2\n' "$uid"
elif [[ "$1" == show-session ]]; then
  type=wayland class=user remote=no seat=seat0
  case "$mode" in
    tty) type=tty ;;
    greeter) class=greeter ;;
    remote) remote=yes ;;
    seatless) seat= ;;
  esac
  printf 'User=%s\nType=%s\nClass=%s\nRemote=%s\nSeat=%s\nActive=yes\n' \
    "$EUID" "$type" "$class" "$remote" "$seat"
fi
STUB
  chmod +x "$HOME/.local/bin/loginctl"
  for mode in missing tty greeter remote seatless other-user; do
    DISPLAY=localhost:99 FIXTURE_CUA_SESSION_MODE="$mode" INSTALL_DOCTOR_CUA_DRIVER=1 bash "$hook"
    if DISPLAY=localhost:99 FIXTURE_CUA_SESSION_MODE="$mode" INSTALL_DOCTOR_CUA_DRIVER=1 bash "$hook" --check-session; then
      echo "Unexpected eligible session: $mode" >&2
      exit 1
    fi
  done
  [[ ! -e "$CUA_TEST_LOG" ]]
  env -u DISPLAY -u WAYLAND_DISPLAY INSTALL_DOCTOR_CUA_DRIVER=1 bash "$hook" --check-session
  [[ ! -e "$CUA_TEST_LOG" ]]
  for attempt in 1 2; do
    env -u DISPLAY -u WAYLAND_DISPLAY HEADLESS_INSTALL=0 INSTALL_DOCTOR_CUA_DRIVER=1 bash "$hook"
  done
  [[ "$(snapshot)" == "$before" ]]
  [[ ! -d "$HOME/.agents" ]]
  [[ ! -d "$HOME/.openclaw" ]]
  [[ "$(grep -cFx 'cua-driver telemetry disable' "$CUA_TEST_LOG")" -eq 2 ]]
  [[ "$(grep -cFx 'systemctl --user --no-reload enable agent-fleet-cua.service' "$CUA_TEST_LOG")" -eq 1 ]]
  unit="$HOME/.config/systemd/user/agent-fleet-cua.service"
  grep -Fxq 'WantedBy=graphical-session.target' "$unit"
  grep -Fxq 'PartOf=graphical-session.target' "$unit"
  ! grep -Eq '^Environment=(WAYLAND_DISPLAY|DISPLAY)=' "$unit"
  ! grep -F 'systemctl --user start ' "$CUA_TEST_LOG"
  ! grep -F 'cua-driver skills' "$CUA_TEST_LOG"

  # Check the version declaration before calling the bundled helper.
  helper="$HOME/.local/bin/wayland-helper"
  mkdir -p "$helper/winrects@cua"
  printf '{"shell-version":["49"]}\n' > "$helper/winrects@cua/metadata.json"
  printf 'touch "$HOME/helper-called"\n' > "$helper/install.sh"
  cat > "$HOME/.local/bin/gnome-shell" <<'STUB'
#!/usr/bin/env bash
printf 'GNOME Shell %s.1\n' "$FIXTURE_GNOME_MAJOR"
STUB
  chmod +x "$HOME/.local/bin/gnome-shell"
  FIXTURE_GNOME_MAJOR=50 INSTALL_DOCTOR_CUA_DRIVER=1 bash "$hook"
  [[ ! -e "$HOME/helper-called" ]]
  FIXTURE_GNOME_MAJOR=49 INSTALL_DOCTOR_CUA_DRIVER=1 bash "$hook"
  [[ -f "$HOME/helper-called" ]]
  rm "$HOME/helper-called"

  extension="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/winrects@cua"
  mkdir -p "$extension"
  printf '{"shell-version":["49","50"]}\n' > "$extension/metadata.json"
  metadata_before="$(cksum "$extension/metadata.json")"
  FIXTURE_GNOME_MAJOR=49 INSTALL_DOCTOR_CUA_DRIVER=1 bash "$hook"
  [[ ! -e "$HOME/helper-called" ]]
  [[ "$(cksum "$extension/metadata.json")" == "$metadata_before" ]]
  printf '# local customization\n' >> "$unit"
  unit_before="$(cksum "$unit")"
  if "$HOME/.local/bin/configure-cua-linux-autostart"; then
    echo 'A custom Cua Driver unit was accepted for replacement.' >&2
    exit 1
  fi
  [[ "$(cksum "$unit")" == "$unit_before" ]]
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
