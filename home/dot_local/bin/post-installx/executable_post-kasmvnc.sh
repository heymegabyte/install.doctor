#!/usr/bin/env bash
# Reconcile live GNOME -> loopback KasmVNC + Chromium automation on capable Linux desktops.
set -euo pipefail

log() { printf '[desktop:kasmvnc] %s\n' "$*"; }
[ "${INSTALL_DOCTOR_KASMVNC:-0}" = "1" ] || { log 'lazy by default; set INSTALL_DOCTOR_KASMVNC=1 to configure the desktop proxy'; exit 0; }
[ "$(uname -s)" = "Linux" ] || exit 0
if [ -n "${INSTALL_DOCTOR_MEM_TOTAL_KIB:-}" ]; then
  memory_kib="$INSTALL_DOCTOR_MEM_TOTAL_KIB"
else
  [ -r /proc/meminfo ] || exit 0
  memory_kib="$(awk '/^MemTotal:/{print $2; exit}' /proc/meminfo)"
fi
nominal_16gib_kib=16777216
min_mem_kib="${INSTALL_DOCTOR_KASMVNC_MIN_MEM_KIB:-15000000}"
[ "${memory_kib:-0}" -ge "$min_mem_kib" ] || { log "skipping: live desktop proxy requires at least 16 GiB RAM (${nominal_16gib_kib} KiB nominal; detected ${memory_kib:-0} KiB)"; exit 0; }

if [ "${HEADLESS_INSTALL:-0}" = "1" ] || [ "${HEADLESS_INSTALL:-false}" = "true" ]; then
  log 'skipping: HEADLESS_INSTALL is enabled'
  exit 0
fi
if [ -f /.dockerenv ] || grep -qaE '(docker|containerd|kubepods|lxc)' /proc/1/cgroup 2>/dev/null; then
  log 'skipping: container environment'
  exit 0
fi
if ! compgen -G '/usr/share/wayland-sessions/*gnome*.desktop' >/dev/null 2>&1 \
  && ! compgen -G '/usr/share/xsessions/*gnome*.desktop' >/dev/null 2>&1 \
  && ! systemctl --user --quiet is-active gnome-session.target 2>/dev/null; then
  log 'skipping: no configured GNOME desktop'
  exit 0
fi

if [ "${INSTALL_DOCTOR_KASMVNC_APPLY:-1}" != "0" ] && [ "${INSTALL_DOCTOR_DESKTOP_CLOSED_LID:-1}" = "1" ]; then
  gsettings set org.gnome.settings-daemon.plugins.power lid-close-ac-action 'nothing'
  gsettings set org.gnome.settings-daemon.plugins.power lid-close-battery-action 'nothing'
  gsettings set org.gnome.settings-daemon.plugins.power lid-close-suspend-with-external-monitor false
  gsettings set org.gnome.settings-daemon.plugins.power idle-dim false
  gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
  gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing'
  gsettings set org.gnome.desktop.session idle-delay 0
  gsettings set org.gnome.desktop.screensaver lock-enabled false
  gsettings set org.gnome.desktop.screensaver ubuntu-lock-on-suspend false 2>/dev/null || true
  if sudo -n true 2>/dev/null; then
    sudo -n mkdir -p /etc/systemd/logind.conf.d
    sudo -n tee /etc/systemd/logind.conf.d/00-runner-lid.conf >/dev/null <<'LID'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
LID
    if [ -f /etc/UPower/UPower.conf ]; then
      sudo -n sed -i -E 's/^[#[:space:]]*IgnoreLid=.*/IgnoreLid=true/' /etc/UPower/UPower.conf
      sudo -n systemctl restart upower.service || true
    fi
    sudo -n systemctl kill --kill-whom=main --signal=HUP systemd-logind.service || true
  fi
fi

units="$HOME/.config/systemd/user"
secret_dir="$HOME/.config/remote-desktop"
state_dir="$HOME/.local/state/remote-desktop"
mkdir -p "$units" "$secret_dir" "$state_dir"
chmod 700 "$secret_dir" "$state_dir"

runner="$HOME/.local/bin/kasmvnc-gnome-loopback-run"
[ -x "$runner" ] || { log "pending: missing $runner (run chezmoi apply)"; exit 1; }
xkasm="$(command -v Xkasmvnc 2>/dev/null || find "$HOME/.local/opt" -type f -name Xkasmvnc -perm -u+x 2>/dev/null | sort -V | tail -n1)"
viewer="$(command -v xtigervncviewer 2>/dev/null || find "$HOME/.local/opt" -type f -name xtigervncviewer -perm -u+x 2>/dev/null | head -n1)"
openbox="$(command -v openbox 2>/dev/null || find "$HOME/.local/opt" -type f -path '*/bin/openbox' -perm -u+x 2>/dev/null | head -n1)"
if { [ -z "$xkasm" ] || [ -z "$viewer" ] || [ -z "$openbox" ]; } && command -v apt-get >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  log 'installing native KasmVNC, TigerVNC viewer, and Openbox via apt...'
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
  if [ -z "$xkasm" ]; then
    kasm_deb="$(mktemp)"
    trap 'rm -f "$kasm_deb"' EXIT
    curl --fail --silent --show-error --proto '=https' --tlsv1.2 --location --max-time 120 \
      https://github.com/kasmtech/KasmVNC/releases/download/v1.5.2/kasmvncserver_ubuntu_noble_1.5.2_amd64.deb -o "$kasm_deb"
    [ "$(wc -c < "$kasm_deb")" -eq 2687950 ]
    if command -v sha256sum >/dev/null 2>&1; then kasm_sha="$(sha256sum "$kasm_deb" | awk '{print $1}')";
    else kasm_sha="$(shasum -a 256 "$kasm_deb" | awk '{print $1}')"; fi
    [ "$kasm_sha" = '89a5d1fbe9e032b122202be158a2b25f15c97e0a5b8dcf92a5e6835c7b7b2acd' ]
    sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$kasm_deb"
    rm -f "$kasm_deb"
  fi
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends tigervnc-viewer openbox >/dev/null 2>&1 || true
  sudo -n usermod -aG ssl-cert "${USER:-$(id -un)}" 2>/dev/null || true
  xkasm="$(command -v Xkasmvnc 2>/dev/null || true)"
  viewer="$(command -v xtigervncviewer 2>/dev/null || true)"
  openbox="$(command -v openbox 2>/dev/null || true)"
fi
if [ -z "$xkasm" ] || [ -z "$viewer" ] || [ -z "$openbox" ]; then
  log 'pending privileged packages: KasmVNC, TigerVNC viewer, and Openbox'
  exit 1
fi

if [ ! -s "$secret_dir/vnc-password" ] && command -v get-secret >/dev/null 2>&1; then
  vnc_secret="$(get-secret VNC_PASSWORD 2>/dev/null || true)"
  if [ -n "$vnc_secret" ]; then
    (umask 077 && printf '%s\n' "$vnc_secret" >"$secret_dir/vnc-password")
    chmod 600 "$secret_dir/vnc-password"
  fi
fi

python3 - "$secret_dir" <<'PY'
from pathlib import Path
import secrets
import subprocess
import sys

target = Path(sys.argv[1])
password = target / "vnc-password"
if not password.exists():
    password.write_text(secrets.token_urlsafe(12)[:8] + "\n")
    password.chmod(0o600)
pem = target / "kasmvnc.pem"
if not pem.exists():
    subprocess.run(["openssl", "req", "-x509", "-nodes", "-days", "3650", "-newkey", "rsa:2048", "-keyout", str(pem), "-out", str(pem), "-subj", "/CN=localhost"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    pem.chmod(0o600)
PY

kasm_passwd="$(command -v kasmvncpasswd 2>/dev/null || dirname "$xkasm")/kasmvncpasswd"
if [ ! -s "$secret_dir/kasmpasswd" ] && [ -x "$kasm_passwd" ]; then
  bootstrap="$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')"
  printf '%s\n%s\n' "$bootstrap" "$bootstrap" | "$kasm_passwd" -u "${USER:-ubuntu}" -w "$secret_dir/kasmpasswd" >/dev/null
  chmod 600 "$secret_dir/kasmpasswd"
fi

grd_daemon="$(command -v gnome-remote-desktop-daemon 2>/dev/null || find "$HOME/.local/opt" /usr/libexec /usr/lib -type f -name gnome-remote-desktop-daemon -perm -u+x 2>/dev/null | head -n1)"
[ -n "$grd_daemon" ] || { log 'pending: gnome-remote-desktop-daemon is unavailable'; exit 1; }
grd_prefix="$(dirname "$(dirname "$grd_daemon")")"
grdctl="$(find "$grd_prefix" -type f -name grdctl -perm -u+x 2>/dev/null | head -n1)"
[ -n "$grdctl" ] || grdctl="$(command -v grdctl 2>/dev/null || true)"
grd_schema="$grd_prefix/share/glib-2.0/schemas"
grd_ld_path="${GRD_LD_LIBRARY_PATH:-$(find "$HOME/.local/opt" -type d -path '*/sysroot/usr/lib/x86_64-linux-gnu' 2>/dev/null | head -n1)}"
if [ -n "$grdctl" ] && [ "${INSTALL_DOCTOR_KASMVNC_APPLY:-1}" != "0" ]; then
  grd_env=(env "GSETTINGS_SCHEMA_DIR=$grd_schema")
  [ -n "$grd_ld_path" ] && grd_env+=("LD_LIBRARY_PATH=$grd_ld_path")
  for args in 'set-port 5900' 'set-auth-method password' 'disable-view-only' 'disable-port-negotiation'; do
    # shellcheck disable=SC2086
    "${grd_env[@]}" "$grdctl" vnc $args >/dev/null
  done
  "${grd_env[@]}" "$grdctl" vnc set-password <"$secret_dir/vnc-password" >/dev/null
fi

cat >"$units/desktop-vnc.service" <<EOF
[Unit]
Description=Live GNOME VNC source (loopback only)
After=gnome-session.target
PartOf=gnome-session.target

[Service]
Type=dbus
BusName=org.gnome.RemoteDesktop.User
ExecStart=$grd_daemon
Environment=GSETTINGS_SCHEMA_DIR=$grd_prefix/share/glib-2.0/schemas
Environment=LD_LIBRARY_PATH=$grd_ld_path
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=gnome-session.target
EOF

cat >"$units/desktop-kasmvnc.service" <<EOF
[Unit]
Description=KasmVNC bridge for the live GNOME desktop
After=default.target

[Service]
Type=simple
Environment=KASMVNC_SECRET_DIR=$secret_dir
Environment=KASMVNC_WEBSOCKET_PORT=${KASMVNC_WEBSOCKET_PORT:-8444}
Environment=KASMVNC_RFB_PORT=5920
Environment=XKASMVNC_BIN=$xkasm
Environment=OPENBOX_BIN=$openbox
Environment=VNC_VIEWER_BIN=$viewer
ExecStart=$runner
Restart=always
RestartSec=3
UMask=0077

[Install]
WantedBy=default.target
EOF

chromium=""
if [ "${INSTALL_DOCTOR_DESKTOP_BROWSER:-0}" = "1" ]; then
  chromium="$(command -v chromium 2>/dev/null || command -v google-chrome 2>/dev/null || true)"
fi
if [ -n "$chromium" ]; then
  cat >"$units/desktop-browser.service" <<EOF
[Unit]
Description=Persistent browser automation on live GNOME
After=gnome-session.target desktop-kasmvnc.service
Wants=desktop-kasmvnc.service
PartOf=gnome-session.target

[Service]
Type=simple
Environment=WAYLAND_DISPLAY=wayland-0
Environment=DISPLAY=:0
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u)
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
ExecStart=$chromium --ozone-platform=wayland --user-data-dir=%h/.local/state/remote-desktop/chromium --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --no-first-run --no-default-browser-check --restore-last-session about:blank
Restart=on-failure
RestartSec=10
UMask=0077

[Install]
WantedBy=gnome-session.target default.target
EOF
fi

if [ "${INSTALL_DOCTOR_KASMVNC_APPLY:-1}" = "0" ]; then
  log 'rendered generic units (apply disabled)'
  exit 0
fi
systemctl --user daemon-reload
systemctl --user enable desktop-vnc.service desktop-kasmvnc.service
[ -n "$chromium" ] && systemctl --user enable desktop-browser.service
if [ "${INSTALL_DOCTOR_KASMVNC_START:-1}" = "1" ]; then
  systemctl --user start desktop-vnc.service desktop-kasmvnc.service
  [ -n "$chromium" ] && systemctl --user start desktop-browser.service
fi
log 'live GNOME KasmVNC infrastructure reconciled (loopback ports 5900, 6901, and 5920)'
[ -n "$chromium" ] && log 'optional Chromium automation enabled on loopback port 9222'
