#!/usr/bin/env bash
# @file post-installx/executable_post-cua-driver.sh
# @brief Opt-in installation and configuration of the official Cua Driver
# @description
#   When explicitly selected, installs the official Cua Driver (`cua-driver` + `cua` CLI) on a
#   supported interactive desktop.
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

if [ "${INSTALL_DOCTOR_CUA_DRIVER:-0}" != "1" ] || [ "${HEADLESS_INSTALL:-}" = "1" ] || [ "${HEADLESS_INSTALL:-}" = "true" ]; then
  log "Cua Driver is lazy; set INSTALL_DOCTOR_CUA_DRIVER=1 on an interactive desktop to enable it"
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
  warn 'Cua Driver is selected but no immutable verified artifact is present in this release'
  exit 78
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

# Ensure winrects@cua declares GNOME Shell 50/51 so Ubuntu 26.04 loads it without OUT OF DATE
if [ "$OS" != "macos" ]; then
  WINRECTS_META="$HOME/.local/share/gnome-shell/extensions/winrects@cua/metadata.json"
  if [ -f "$WINRECTS_META" ]; then
    node -e '
const fs = require("node:fs");
const p = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const sv = Array.isArray(data["shell-version"]) ? data["shell-version"] : [];
  for (const v of ["50", "51"]) { if (!sv.includes(v)) sv.push(v); }
  data["shell-version"] = sv;
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
} catch { process.exit(0); }
' "$WINRECTS_META" >/dev/null 2>&1 && log "Ensured GNOME Shell 50/51 compatibility for winrects@cua" || true
  fi
fi

cua-driver skills install >/dev/null 2>&1 || true

# Register Cua Driver MCP in installed agent harnesses (Claude Code, Codex, OpenCode, Antigravity)
node - << 'NODE' || warn "Cua Driver MCP registration skipped"
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const home = os.homedir();
const cuaBin = path.join(home, ".local", "bin", "cua-driver");

// 1. OpenCode (~/.config/opencode/opencode.json and opencode.jsonc)
const ocDir = path.join(home, ".config", "opencode");
fs.mkdirSync(ocDir, { recursive: true });
for (const name of ["opencode.json", "opencode.jsonc"]) {
  const p = path.join(ocDir, name);
  let data;
  if (fs.existsSync(p)) {
    try {
      const raw = fs
        .readFileSync(p, "utf8")
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      data = JSON.parse(raw);
    } catch {
      continue;
    }
  } else if (name === "opencode.jsonc") {
    continue;
  } else {
    data = {};
  }
  if (!data.mcp || typeof data.mcp !== "object") data.mcp = {};
  data.mcp["cua-driver"] = { type: "local", command: [cuaBin, "mcp"], enabled: true };
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

// 2. Claude Code (~/.claude.json + isolated profiles if present)
const claudeTargets = [path.join(home, ".claude.json")];
const crAccounts = path.join(home, ".claw-router", "accounts");
try {
  for (const acct of fs.readdirSync(crAccounts).sort()) {
    if (acct.startsWith("claude-")) claudeTargets.push(path.join(crAccounts, acct, ".claude.json"));
  }
} catch {
  // No claw-router accounts dir.
}
for (const p of claudeTargets) {
  let data = {};
  if (fs.existsSync(p)) {
    try {
      data = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      data = {};
    }
  }
  if (!data.mcpServers || typeof data.mcpServers !== "object") data.mcpServers = {};
  data.mcpServers["cua-driver"] = { type: "stdio", command: cuaBin, args: ["mcp"], env: {} };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
  fs.chmodSync(p, 0o600);
}

// 3. Codex (~/.codex/config.toml)
const codexDir = path.join(home, ".codex");
fs.mkdirSync(codexDir, { recursive: true });
const cfg = path.join(codexDir, "config.toml");
let txt = "";
try {
  txt = fs.readFileSync(cfg, "utf8");
} catch {
  txt = "";
}
if (!txt.includes("[mcp_servers.cua-driver]") && !txt.includes("[mcp_servers.cua_driver]")) {
  const block = `\n[mcp_servers.cua-driver]\ncommand = "${cuaBin}"\nargs = ["mcp"]\nenabled = true\n`;
  fs.writeFileSync(cfg, txt.replace(/\s+$/, "") + "\n" + block);
}

// 4. Antigravity CLI (~/.gemini/config/mcp_config.json and legacy ~/.gemini/antigravity/mcp_config.json)
for (const agyDir of [path.join(home, ".gemini", "config"), path.join(home, ".gemini", "antigravity")]) {
  fs.mkdirSync(agyDir, { recursive: true });
  const p = path.join(agyDir, "mcp_config.json");
  let data = {};
  if (fs.existsSync(p)) {
    try {
      data = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      data = {};
    }
  }
  if (!data.mcpServers || typeof data.mcpServers !== "object") data.mcpServers = {};
  data.mcpServers["cua-driver"] = { command: cuaBin, args: ["mcp"] };
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

// 5. Symlink skill into ~/.codex/skills and ~/.openclaw/skills if source exists
const skillSrc = path.join(home, ".agents", "skills", "cua-driver");
if (fs.existsSync(skillSrc)) {
  for (const root of [path.join(home, ".codex", "skills"), path.join(home, ".openclaw", "skills")]) {
    fs.mkdirSync(root, { recursive: true });
    const link = path.join(root, "cua-driver");
    let linkExists = false;
    try {
      fs.lstatSync(link);
      linkExists = true;
    } catch {
      linkExists = false;
    }
    if (!linkExists) {
      try {
        fs.symlinkSync(skillSrc, link);
      } catch {
        // Ignore symlink race/permission error.
      }
    }
  }
}
NODE

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
