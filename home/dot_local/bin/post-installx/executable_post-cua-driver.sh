#!/usr/bin/env bash
# @file post-installx/executable_post-cua-driver.sh
# @brief Install and configure the official Cua Driver on every supported desktop (macOS & Linux)
# @description
#   Installs the official Cua Driver (`cua-driver` + `cua` CLI) by default on every supported
#   desktop provisioned by Install Doctor, even when invoked over a headless SSH session.
#   Configures GNOME Wayland support (`winrects@cua`), disables telemetry, registers the MCP
#   server in Claude Code, Codex, OpenCode, and Antigravity harnesses, and sets up native user
#   autostart (systemd user unit on Linux, LaunchAgent on macOS).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../../scripts/lib/detect_os.sh" ]; then
  # shellcheck disable=SC1090
  source "$SCRIPT_DIR/../../../scripts/lib/detect_os.sh"
  OS="$(detect_os)"
else
  if [[ "${OSTYPE:-}" == darwin* ]]; then OS="macos"
  elif [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS="${ID:-linux}"
  else OS="unknown"
  fi
fi

if command -v gum &>/dev/null; then
  log() { gum log -sl info "$1"; }
  warn() { gum log -sl warn "$1"; }
else
  log() { echo "[INFO] $1"; }
  warn() { echo "[WARN] $1" >&2; }
fi

if [ "${INSTALL_DOCTOR_CUA_DRIVER:-1}" = "0" ] || [ "${HEADLESS_INSTALL:-}" = "1" ] || [ "${HEADLESS_INSTALL:-}" = "true" ]; then
  log "Cua Driver skipped (opted out or HEADLESS_INSTALL)"
  exit 0
fi

# Verify supported OS and real configured desktop (works even over SSH)
has_desktop=0
if declare -f has_configured_desktop >/dev/null 2>&1; then
  has_configured_desktop && has_desktop=1 || has_desktop=0
else
  if [ "$OS" = "macos" ] && [ -d "/System/Library/CoreServices/Finder.app" ]; then
    has_desktop=1
  elif [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ] \
    || compgen -G "/run/user/*/wayland-*" >/dev/null 2>&1 \
    || compgen -G "/tmp/.X11-unix/X*" >/dev/null 2>&1 \
    || compgen -G "/usr/share/wayland-sessions/*.desktop" >/dev/null 2>&1 \
    || compgen -G "/usr/share/xsessions/*.desktop" >/dev/null 2>&1; then
    has_desktop=1
  fi
fi

if [ "$has_desktop" -ne 1 ]; then
  log "No configured desktop detected on $OS — skipping Cua Driver installation"
  exit 0
fi

export PATH="$HOME/.local/bin:$PATH"

if ! command -v cua-driver >/dev/null 2>&1; then
  log "Installing official Cua Driver (cli + cua-driver) on $OS desktop..."
  tmp_installer="$(mktemp /tmp/cua-install.XXXXXX.sh)"
  trap 'rm -f "$tmp_installer" 2>/dev/null || true' EXIT
  if curl -fsSL https://cua.ai/install.sh -o "$tmp_installer"; then
    bash "$tmp_installer" --only cli,cua-driver --yes || warn "cua.ai installer returned non-zero"
  fi
fi

if ! command -v cua-driver >/dev/null 2>&1; then
  warn "cua-driver binary not present after installer — skipping post-configuration"
  exit 0
fi

cua-driver telemetry disable >/dev/null 2>&1 || true
command -v cua >/dev/null 2>&1 && cua telemetry off >/dev/null 2>&1 || true

# GNOME Wayland helper (winrects@cua extension) on Linux desktops
if [ "$OS" != "macos" ] && [ -f "$HOME/.cua-driver/packages/current/wayland-helper/install.sh" ]; then
  log "Installing Cua Driver GNOME Wayland helper (winrects@cua)..."
  bash "$HOME/.cua-driver/packages/current/wayland-helper/install.sh" >/dev/null 2>&1 || true
fi

cua-driver skills install >/dev/null 2>&1 || true

# Register Cua Driver MCP in installed agent harnesses (Claude Code, Codex, OpenCode, Antigravity)
python3 - << 'PY'
import json
from pathlib import Path

home = Path.home()
cua_bin = str(home / ".local/bin/cua-driver")

# 1. OpenCode (~/.config/opencode/opencode.json and opencode.jsonc)
oc_dir = home / ".config/opencode"
oc_dir.mkdir(parents=True, exist_ok=True)
for name in ("opencode.json", "opencode.jsonc"):
    p = oc_dir / name
    data = {}
    if p.exists():
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue
    elif name == "opencode.jsonc":
        continue
    data.setdefault("mcp", {})["cua-driver"] = {
        "type": "local",
        "command": [cua_bin, "mcp"],
        "enabled": True,
    }
    p.write_text(json.dumps(data, indent=2) + "\n")

# 2. Claude Code (~/.claude.json + isolated profiles if present)
claude_targets = [home / ".claude.json"]
cr_accounts = home / ".claw-router/accounts"
if cr_accounts.is_dir():
    for acct in sorted(cr_accounts.glob("claude-*")):
        claude_targets.append(acct / ".claude.json")
for p in claude_targets:
    data = {}
    if p.exists():
        try:
            data = json.loads(p.read_text())
        except Exception:
            data = {}
    data.setdefault("mcpServers", {})["cua-driver"] = {
        "command": cua_bin,
        "args": ["mcp"],
    }
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2) + "\n")
    p.chmod(0o600)

# 3. Codex (~/.codex/config.toml)
codex_dir = home / ".codex"
if codex_dir.is_dir():
    cfg = codex_dir / "config.toml"
    txt = cfg.read_text() if cfg.exists() else ""
    if "[mcp_servers.cua-driver]" not in txt and "[mcp_servers.cua_driver]" not in txt:
        block = f'\n[mcp_servers.cua-driver]\ncommand = "{cua_bin}"\nargs = ["mcp"]\n'
        cfg.write_text(txt.rstrip() + "\n" + block)

# 4. Antigravity (~/.gemini/antigravity/mcp_config.json if directory exists)
agy_dir = home / ".gemini/antigravity"
if agy_dir.is_dir():
    p = agy_dir / "mcp_config.json"
    data = {}
    if p.exists():
        try:
            data = json.loads(p.read_text())
        except Exception:
            data = {}
    data.setdefault("mcpServers", {})["cua-driver"] = {
        "command": cua_bin,
        "args": ["mcp"],
    }
    p.write_text(json.dumps(data, indent=2) + "\n")

# 5. Symlink skill into ~/.codex/skills and ~/.openclaw/skills if source exists
skill_src = home / ".agents/skills/cua-driver"
if skill_src.exists():
    for root in [home / ".codex/skills", home / ".openclaw/skills"]:
        root.mkdir(parents=True, exist_ok=True)
        link = root / "cua-driver"
        if not link.exists() and not link.is_symlink():
            link.symlink_to(skill_src)
PY

# Configure native user autostart (avoiding duplicate daemons)
if [ "$OS" = "macos" ]; then
  la_dir="$HOME/Library/LaunchAgents"
  mkdir -p "$la_dir"
  plist="$la_dir/ai.cua.driver.plist"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.cua.driver</string>
  <key>ProgramArguments</key>
  <array>
    <string>$HOME/.local/bin/cua-driver</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
EOF
  launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl load -w "$plist" >/dev/null 2>&1 || true
else
  unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir"
  cat >"$unit_dir/agent-fleet-cua.service" <<EOF
[Unit]
Description=Cua local desktop computer-use driver
After=graphical-session.target
PartOf=graphical-session.target

[Service]
ExecStart=$HOME/.local/bin/cua-driver serve
Environment=CUA_DRIVER_RS_ENABLE_WAYLAND=1
Environment=WAYLAND_DISPLAY=wayland-0
Environment=DISPLAY=:0
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=graphical-session.target default.target
EOF
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  systemctl --user enable --now agent-fleet-cua.service >/dev/null 2>&1 || true
fi

log "Cua Driver configured and autostart enabled on $OS"
