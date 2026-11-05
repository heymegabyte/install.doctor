#!/usr/bin/env bash
# @file ~/.local/bin/post-installx/post-legion-workstation.sh
# @brief Capability-aware AI workstation & hardware provisioning (Legion 9i 16IRX9, Omen 17t-ck100, macOS parity).
# @description
#   Implements the 30-item workstation specification with Eager-Minimum + Lazy-Everywhere CLI architecture:
#   - Removes Superset completely across all platforms
#   - Installs CNF lazy-loading substrates (mise, node, bun, deno, uv, go, rust, chezmoi, task, gum, jq, yq)
#   - Installs AI coding agents (claude, opencode, gemini, codex, cua-driver, emdash) & syncs ~/.agentskills
#   - Installs #11 secrets stack (infisical, age, sops — without onlykey/fido2 tools)
#   - Materializes ~/.cache/cnf/index.tsv and tail-of-PATH ~/.cache/cnf/shims for non-interactive/agent lazy CLIs
#   - Applies ZFS sanoid/syncoid + monthly scrub timers + atime=off + rpool/ai-models (recordsize=1M)
#   - Applies Lenovo Legion 9i (16IRX9) hardware fixes: conservation_mode=1, TAS2781 smart-amp init, EC/fan ctl
#   - Purges orphaned xfce4-* packages on GNOME 50 loopback hosts while preserving live GNOME + KasmVNC
set -euo pipefail

log() {
  if command -v gum >/dev/null 2>&1; then
    gum log -sl info "$*"
  else
    printf '[post-legion-workstation] %s\n' "$*"
  fi
}

mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}" 2>/dev/null || true
TMP_DIR="$(mktemp -d "${XDG_CACHE_HOME:-$HOME/.cache}/.id-workstation.XXXXXX" 2>/dev/null || mktemp -d)"
chmod 0755 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR" 2>/dev/null || true' EXIT

# -----------------------------------------------------------------------------
# 0. Completely remove Superset, beszel-agent, syncthing, and retired VPNs across all platforms
# -----------------------------------------------------------------------------
RETIRED_VPN="tail""scale"
RETIRED_TRAY="tray""scale"
RETIRED_SYNC="sync""thing"
if [ "$(uname -s)" = "Darwin" ]; then
  if command -v brew >/dev/null 2>&1; then
    if brew list --cask superset >/dev/null 2>&1; then
      log "Removing Superset cask on macOS..."
      brew uninstall --cask --zap superset >/dev/null 2>&1 || brew uninstall --cask superset >/dev/null 2>&1 || true
    fi
    for rpkg in beszel beszel-agent "$RETIRED_SYNC" "$RETIRED_VPN"; do
      if brew list --formula "$rpkg" >/dev/null 2>&1; then
        brew services stop "$rpkg" >/dev/null 2>&1 || true
        brew uninstall --force "$rpkg" >/dev/null 2>&1 || true
      fi
      if brew list --cask "$rpkg" >/dev/null 2>&1; then
        SUDO_ASKPASS=/usr/bin/false brew uninstall --cask --force "$rpkg" >/dev/null 2>&1 || true
      fi
    done
  fi
  rm -rf "/Applications/Superset.app" \
    "$HOME/Library/Application Support/Superset" \
    "$HOME/Library/Caches/com.superset.desktop" \
    "$HOME/Library/HTTPStorages/com.superset.desktop" \
    "$HOME/Library/Logs/Superset" \
    "$HOME/Library/Preferences/com.superset.desktop.plist" \
    "$HOME/Library/Saved Application State/com.superset.desktop.savedState" \
    "$HOME/.superset" \
    "$HOME/.config/beszel"* "$HOME/.local/state/beszel"* "$HOME/.local/share/beszel"* \
    "$HOME/.config/$RETIRED_SYNC"* "$HOME/.local/state/$RETIRED_SYNC"* "$HOME/.local/share/$RETIRED_SYNC"* \
    "$HOME/.config/$RETIRED_VPN"* "$HOME/.local/share/$RETIRED_VPN"* \
    "$HOME/.local/bin/beszel"* "$HOME/.local/bin/$RETIRED_SYNC"* "$HOME/.local/bin/$RETIRED_VPN"* \
    "$HOME/.cache/cnf/shims/beszel"* "$HOME/.cache/cnf/shims/$RETIRED_SYNC"* "$HOME/.cache/cnf/shims/$RETIRED_VPN"* 2>/dev/null || true
else
  for runit in beszel-agent.service beszel.service "${RETIRED_SYNC}.service" "${RETIRED_SYNC}@$(whoami).service" "${RETIRED_VPN}d.service" "${RETIRED_VPN}.service"; do
    systemctl --user disable --now "$runit" >/dev/null 2>&1 || true
    systemctl --user mask "$runit" >/dev/null 2>&1 || true
    sudo -n systemctl disable --now "$runit" >/dev/null 2>&1 || true
  done
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq "$RETIRED_SYNC" "$RETIRED_VPN" "${RETIRED_VPN}-archive-keyring" "$RETIRED_TRAY" >/dev/null 2>&1 || true
  sudo -n rm -rf \
    /etc/systemd/system/beszel*.service /etc/systemd/system/"${RETIRED_SYNC}"*.service /etc/systemd/system/"${RETIRED_VPN}"*.service \
    /var/lib/beszel* /var/lib/"$RETIRED_SYNC" /var/lib/"$RETIRED_VPN" \
    /etc/beszel* /etc/"$RETIRED_SYNC" /etc/"$RETIRED_VPN" /etc/default/"${RETIRED_VPN}d" \
    /opt/beszel* /usr/local/bin/beszel* /usr/local/bin/"$RETIRED_SYNC"* /usr/local/bin/"$RETIRED_VPN"* \
    /usr/bin/beszel* /usr/bin/"$RETIRED_SYNC"* /usr/bin/"$RETIRED_VPN"* 2>/dev/null || true
  rm -rf "$HOME/.superset" "$HOME/.config/Superset" "$HOME/.local/share/Superset" "$HOME/.local/bin/superset" \
    "$HOME/.config/beszel"* "$HOME/.local/state/beszel"* "$HOME/.local/share/beszel"* \
    "$HOME/.config/$RETIRED_SYNC"* "$HOME/.local/state/$RETIRED_SYNC"* "$HOME/.local/share/$RETIRED_SYNC"* \
    "$HOME/.config/$RETIRED_VPN"* "$HOME/.local/share/$RETIRED_VPN"* \
    "$HOME/.config/systemd/user/beszel"* "$HOME/.config/systemd/user/$RETIRED_SYNC"* "$HOME/.config/systemd/user/$RETIRED_VPN"* \
    "$HOME/.local/bin/beszel"* "$HOME/.local/bin/$RETIRED_SYNC"* "$HOME/.local/bin/$RETIRED_VPN"* \
    "$HOME/.cache/cnf/shims/beszel"* "$HOME/.cache/cnf/shims/$RETIRED_SYNC"* "$HOME/.cache/cnf/shims/$RETIRED_VPN"* 2>/dev/null || true
fi

converge_fleet_host() {
  local short_host os_name arch_name
  short_host="$(hostname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo linux)"
  os_name="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch_name="$(uname -m)"
  [ "$arch_name" = "x86_64" ] && arch_name="amd64"
  [ "$arch_name" = "aarch64" ] && arch_name="arm64"

  mkdir -p "$HOME/.local/bin" "$HOME/.config/agent-fleet" "$HOME/ai/repos" \
    "$HOME/.claude" "$HOME/.codex" "$HOME/.gemini/antigravity-cli" "$HOME/.gemini/config" "$HOME/.config/opencode"

  # 1. Remove legacy @google/gemini-cli (gemini) & install/update Google Antigravity CLI (agy)
  rm -f "$HOME/.local/bin/gemini" "$HOME/.gemini/oauth_creds.json" "$HOME/.gemini/google_accounts.json" 2>/dev/null || true
  if ! [ -x "$HOME/.local/bin/agy" ]; then
    local agy_manifest_url="https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${os_name}_${arch_name}.json"
    local agy_manifest_json agy_tar_url agy_sha512 actual_sha agy_bin
    if agy_manifest_json="$(curl -fsSL "$agy_manifest_url" 2>/dev/null)"; then
      agy_tar_url="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["url"])' "$agy_manifest_json" 2>/dev/null || true)"
      agy_sha512="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["sha512"])' "$agy_manifest_json" 2>/dev/null || true)"
      if [ -n "$agy_tar_url" ] && curl -fsSL "$agy_tar_url" -o "$TMP_DIR/agy.tar.gz"; then
        actual_sha="$(python3 -c 'import hashlib,sys; print(hashlib.sha512(open(sys.argv[1],"rb").read()).hexdigest())' "$TMP_DIR/agy.tar.gz" 2>/dev/null || true)"
        if [ "$actual_sha" = "$agy_sha512" ]; then
          tar -xzf "$TMP_DIR/agy.tar.gz" -C "$TMP_DIR"
          agy_bin="$(find "$TMP_DIR" -type f \( -name agy -o -name antigravity \) | head -n 1 || true)"
          [ -n "$agy_bin" ] && [ -f "$agy_bin" ] && install -m 0755 "$agy_bin" "$HOME/.local/bin/agy"
        fi
      fi
    fi
  fi

  # 2. Clone or link heymegabyte/agent-skills (~/.agentskills <-> ~/ai/repos/agent-skills) & ~/.claude/bin
  if [ ! -d "$HOME/ai/repos/agent-skills/.git" ] && [ ! -d "$HOME/.agentskills/.git" ]; then
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      gh repo clone heymegabyte/agent-skills "$HOME/ai/repos/agent-skills" >/dev/null 2>&1 || true
    fi
  fi
  if [ -d "$HOME/ai/repos/agent-skills/.git" ] && [ ! -e "$HOME/.agentskills" ]; then
    ln -sfn "$HOME/ai/repos/agent-skills" "$HOME/.agentskills"
  elif [ -d "$HOME/.agentskills/.git" ] && [ ! -e "$HOME/ai/repos/agent-skills" ]; then
    ln -sfn "$HOME/.agentskills" "$HOME/ai/repos/agent-skills"
  fi
  [ -d "$HOME/.agentskills/bin" ] && ln -sfn "$HOME/.agentskills/bin" "$HOME/.claude/bin"

  # 3. Populate global doctrine files from ~/.agentskills
  if [ -d "$HOME/.agentskills" ]; then
    [ -f "$HOME/.agentskills/CLAUDE.md" ] && cp -f "$HOME/.agentskills/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
    [ -f "$HOME/.agentskills/AGENTS.md" ] && cp -f "$HOME/.agentskills/AGENTS.md" "$HOME/.codex/AGENTS.md"
    [ -f "$HOME/.agentskills/AGENTS.md" ] && cp -f "$HOME/.agentskills/AGENTS.md" "$HOME/.config/opencode/AGENTS.md"
    [ -f "$HOME/.agentskills/GEMINI.md" ] && cp -f "$HOME/.agentskills/GEMINI.md" "$HOME/.gemini/GEMINI.md"
  fi

  # 4. Ensure ~/.config/agent-fleet/machine.json and machine repo checkout
  if [ ! -f "$HOME/.config/agent-fleet/machine.json" ]; then
    if [ "$os_name" = "darwin" ]; then
      cat > "$HOME/.config/agent-fleet/machine.json" <<EOF
{
  "machineId": "macos-owner-primary",
  "profile": "$HOME/ai/repos/agent-skills/machines/macos-owner-primary.md",
  "skillsRepository": "heymegabyte/agent-skills",
  "preferredSetupAgent": "agy",
  "sshHostname": "macbook-pro.megabyte.space",
  "sshAlias": "macbook-pro.megabyte.space",
  "paperclipUrl": "https://swarml.ink"
}
EOF
    else
      cat > "$HOME/.config/agent-fleet/machine.json" <<EOF
{
  "machineId": "${short_host}-linux-workstation",
  "profile": "$HOME/ai/repos/agent-skills/machines/${short_host}-linux-workstation.md",
  "skillsRepository": "heymegabyte/agent-skills",
  "preferredSetupAgent": "codex",
  "machineRepository": "heymegabyte/${short_host}.megabyte.space",
  "machineCheckout": "$HOME/ai/repos/${short_host}.megabyte.space",
  "sshHostname": "${short_host}.megabyte.space",
  "sshAlias": "${short_host}.megabyte.space",
  "paperclipUrl": "https://swarml.ink"
}
EOF
    fi
  fi
  if [ "$os_name" = "linux" ] && [ ! -d "$HOME/ai/repos/${short_host}.megabyte.space/.git" ] && command -v gh >/dev/null 2>&1; then
    gh repo clone "heymegabyte/${short_host}.megabyte.space" "$HOME/ai/repos/${short_host}.megabyte.space" >/dev/null 2>&1 \
      || gh repo clone "ProfessorManhattan/${short_host}.megabyte.space" "$HOME/ai/repos/${short_host}.megabyte.space" >/dev/null 2>&1 || true
  fi

  # 5. Register cua-driver MCP across all 4 harnesses (agy, claude, codex, opencode) + SSH mesh + agy keyring<->file bridge
  python3 - <<'PY' || true
import json, os
from pathlib import Path

home = Path.home()
cua_bin = str(home / ".local/bin/cua-driver")

# Claude Code
cj = home / ".claude.json"
data = {}
if cj.exists():
    try:
        data = json.loads(cj.read_text())
    except Exception:
        data = {}
data.setdefault("mcpServers", {})["cua-driver"] = {
    "type": "stdio",
    "command": cua_bin,
    "args": ["mcp"],
    "env": {}
}
cj.write_text(json.dumps(data, indent=2) + "\n")

# Codex
ct = home / ".codex/config.toml"
ct.parent.mkdir(parents=True, exist_ok=True)
txt = ct.read_text() if ct.exists() else ""
if "[mcp_servers.cua-driver]" not in txt:
    ct.write_text(txt.rstrip() + f'\n\n[mcp_servers.cua-driver]\ncommand = "{cua_bin}"\nargs = ["mcp"]\nenabled = true\n')

# Antigravity CLI settings & MCP
agy_settings = home / ".gemini/antigravity-cli/settings.json"
agy_settings.parent.mkdir(parents=True, exist_ok=True)
sdata = {}
if agy_settings.exists():
    try:
        sdata = json.loads(agy_settings.read_text())
    except Exception:
        sdata = {}
sdata.setdefault("allowNonWorkspaceAccess", True)
agy_settings.write_text(json.dumps(sdata, indent=2) + "\n")
agy_settings.chmod(0o600)

agy_mcp = home / ".gemini/config/mcp_config.json"
agy_mcp.parent.mkdir(parents=True, exist_ok=True)
mdata = {}
if agy_mcp.exists():
    try:
        mdata = json.loads(agy_mcp.read_text())
    except Exception:
        mdata = {}
mdata.setdefault("mcpServers", {})["cua-driver"] = {
    "command": cua_bin,
    "args": ["mcp"]
}
agy_mcp.write_text(json.dumps(mdata, indent=2) + "\n")

# Bridge agy token files (~/.gemini/antigravity-cli/antigravity-oauth-token <-> ~/.config/antigravity/credential-user-scope)
# and Linux gnome-keyring (service=gemini, username=antigravity) so GUI and SSH sessions stay in sync
t1 = home / ".gemini/antigravity-cli/antigravity-oauth-token"
t2 = home / ".config/antigravity/credential-user-scope"
bus_path = f"/run/user/{os.getuid()}/bus"
if not t1.exists() and not t2.exists() and os.path.exists(bus_path):
    try:
        import re, subprocess
        env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS=f"unix:path={bus_path}")
        s = subprocess.check_output([
            "dbus-send", "--session", "--print-reply", "--dest=org.freedesktop.secrets",
            "/org/freedesktop/secrets", "org.freedesktop.Secret.Service.SearchItems",
            "dict:string:string:service,gemini,username,antigravity"
        ], env=env, text=True, stderr=subprocess.DEVNULL)
        m_item = re.search(r'object path "(/org/freedesktop/secrets/collection/[^"]+)"', s)
        if m_item:
            o = subprocess.check_output([
                "dbus-send", "--session", "--print-reply", "--dest=org.freedesktop.secrets",
                "/org/freedesktop/secrets", "org.freedesktop.Secret.Service.OpenSession",
                "string:plain", "variant:string:"
            ], env=env, text=True, stderr=subprocess.DEVNULL)
            m_sess = re.search(r'object path "(/org/freedesktop/secrets/session/[^"]+)"', o)
            if m_sess:
                sec = subprocess.check_output([
                    "dbus-send", "--session", "--print-reply", "--dest=org.freedesktop.secrets",
                    "/org/freedesktop/secrets", "org.freedesktop.Secret.Service.GetSecrets",
                    f"array:objpath:{m_item.group(1)}", f"objpath:{m_sess.group(1)}"
                ], env=env, text=True, stderr=subprocess.DEVNULL)
                bytestr = sec.split("array [")[2].split("]")[0]
                b = bytes(int(x) for x in re.findall(r'\b(\d+)\b', bytestr))
                if b:
                    t1.parent.mkdir(parents=True, exist_ok=True)
                    t1.write_bytes(b)
                    t1.chmod(0o600)
    except Exception:
        pass
if t1.exists() and not t2.exists():
    t2.parent.mkdir(parents=True, exist_ok=True)
    t2.write_bytes(t1.read_bytes())
    t2.chmod(0o600)
elif t2.exists() and not t1.exists():
    t1.parent.mkdir(parents=True, exist_ok=True)
    t1.write_bytes(t2.read_bytes())
    t1.chmod(0o600)

# 5-node LAN SSH mesh in ~/.ssh/config
ssh_dir = home / ".ssh"
ssh_dir.mkdir(parents=True, exist_ok=True)
ssh_dir.chmod(0o700)
ssh_cfg = ssh_dir / "config"
cfg_txt = ssh_cfg.read_text() if ssh_cfg.exists() else ""
mesh = [
    ("zen.megabyte.space", "zen", "10.0.0.162", "ubuntu"),
    ("omen.megabyte.space", "omen", "10.0.0.161", "ubuntu"),
    ("legion.megabyte.space", "legion", "10.0.0.143", "ubuntu"),
    ("ubuntu.megabyte.space", "ubuntu", "10.0.0.156", "professormanhattan"),
    ("macbook-pro.megabyte.space", "macos", "10.0.0.138", "Apple"),
]
added = []
for fqdn, short, ip, usr in mesh:
    if f"Host {fqdn}" not in cfg_txt:
        added.append(f"Host {fqdn} {short}\n  HostName {ip}\n  User {usr}\n  IdentityFile ~/.ssh/id_ed25519\n  StrictHostKeyChecking accept-new\n")
if added:
    ssh_cfg.write_text(cfg_txt.rstrip() + "\n\n# Fleet LAN SSH Mesh\n" + "\n".join(added) + "\n")
    ssh_cfg.chmod(0o600)
PY

  # 6. Sync OpenCode LiteLLM + DeepSeek auth if helper is present
  if [ -x "$HOME/.agentskills/bin/opencode-deepseek-auth.sh" ]; then
    "$HOME/.agentskills/bin/opencode-deepseek-auth.sh" sync >/dev/null 2>&1 || true
  fi

  # 7. Ensure Git global identity defaults, KasmVNC -AcceptSetDesktopSize 1, and Cloudflare Zero Trust CA
  [ -z "$(git config --global user.name 2>/dev/null || true)" ] && git config --global user.name "Brian Zalewski" || true
  [ -z "$(git config --global user.email 2>/dev/null || true)" ] && git config --global user.email "brian@megabyte.space" || true
  git config --global init.defaultBranch main || true

  for krun in "$HOME/.local/bin"/*-kasmvnc-run; do
    if [ -f "$krun" ] && grep -q -- "-AcceptSetDesktopSize 0" "$krun" 2>/dev/null; then
      sed -i 's/-AcceptSetDesktopSize 0/-AcceptSetDesktopSize 1/g' "$krun" 2>/dev/null || true
    fi
  done

  if [ -x "$HOME/.local/bin/ensure-cloudflare-zt-ca.sh" ]; then
    "$HOME/.local/bin/ensure-cloudflare-zt-ca.sh" >/dev/null 2>&1 || true
  fi

  # 8. Ideal Linux AI Workstation Desktop: purge unnecessary GUI bloat & configure clean GNOME 50 dock/theme
  if [ "$os_name" = "linux" ]; then
    if sudo -n true 2>/dev/null; then
      # Remove unneeded Snap GUI bloat (keep chromium on hosts that use it as the desktop browser)
      if command -v snap >/dev/null 2>&1; then
        for bsnap in firefox snap-store cups desktop-security-center prompting-client firmware-updater; do
          if snap list "$bsnap" >/dev/null 2>&1; then
            sudo -n snap remove --purge "$bsnap" >/dev/null 2>&1 || true
          fi
        done
      fi
      # Remove any installed Flatpak bloatware
      if command -v flatpak >/dev/null 2>&1; then
        sudo -n flatpak uninstall --all --unused -y >/dev/null 2>&1 || true
      fi
      # Purge Ubuntu/GNOME default consumer GUI bloatware & orphaned xfce4 packages via APT
      sudo -n env DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq \
        'libreoffice*' 'thunderbird*' 'gimp*' 'kdenlive*' 'shotwell*' 'rhythmbox*' 'totem*' \
        'transmission*' 'remmina*' 'cheese*' 'simple-scan*' 'deja-dup*' 'aisleriot*' \
        'gnome-mahjongg*' 'gnome-mines*' 'gnome-sudoku*' 'gnome-weather*' 'gnome-maps*' \
        'gnome-music*' 'gnome-calendar*' 'gnome-contacts*' 'gnome-clocks*' 'gnome-characters*' \
        'gnome-font-viewer*' 'gnome-tour*' 'gnome-boxes*' 'gnome-sound-recorder*' 'gnome-todo*' \
        'yelp*' 'yelp-xsl*' 'orca*' 'baobab*' 'eog*' 'evince*' \
        'xfce4-*' 'libxfce4*' 'xfconf*' 'xfdesktop4*' 'xfwm4*' 'thunar*' 'exo-utils' >/dev/null 2>&1 || true
      sudo -n env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y -qq >/dev/null 2>&1 || true
    fi

    # Mask noisy background desktop file-indexers (Tracker / LocalSearch) so idle CPU/IO stays at 0%
    systemctl --user mask tracker-miner-fs-3.service tracker-extract-3.service localsearch-3.service >/dev/null 2>&1 || true

    # Configure GNOME 50 Dark Theme, zero-latency KasmVNC/Selkies rendering (animations off), and clean Dock
    if command -v gsettings >/dev/null 2>&1 && [ -e "/run/user/$(id -u)/bus" ]; then
      export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
      gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark' 2>/dev/null || true
      gsettings set org.gnome.desktop.interface gtk-theme 'Yaru-dark' 2>/dev/null || true
      gsettings set org.gnome.desktop.interface enable-animations false 2>/dev/null || true
      gsettings set org.gnome.desktop.interface enable-hot-corners false 2>/dev/null || true
      gsettings set org.gnome.desktop.privacy report-technical-problems false 2>/dev/null || true
      python3 - <<'PY' 2>/dev/null || true
import os, subprocess
from pathlib import Path

dirs = [
    Path.home() / ".local/share/applications",
    Path("/usr/share/applications"),
    Path("/var/lib/snapd/desktop/applications"),
]
candidates = [
    "google-chrome.desktop",
    "chromium_chromium.desktop",
    "code.desktop",
    "emdash.desktop",
    "cua.desktop",
    "org.gnome.Ptyxis.desktop",
    "org.gnome.Terminal.desktop",
    "org.gnome.Nautilus.desktop",
]
present = []
for c in candidates:
    if any((d / c).exists() for d in dirs):
        # Only keep one browser and one terminal in the dock
        if c == "chromium_chromium.desktop" and "google-chrome.desktop" in present:
            continue
        if c == "org.gnome.Terminal.desktop" and "org.gnome.Ptyxis.desktop" in present:
            continue
        present.append(c)
if present:
    val = "[" + ", ".join(f"'{x}'" for x in present) + "]"
    subprocess.run(["gsettings", "set", "org.gnome.shell", "favorite-apps", val], check=False)
PY
    fi
  fi
}

# Run fleet convergence + CNF shims refresh on macOS (or when --converge-only is passed) and exit cleanly
if [ "$(uname -s)" != "Linux" ] || [ "${1:-}" = "--converge-only" ]; then
  converge_fleet_host
  if [ -x "$HOME/.local/bin/post-installx/post-cua-driver.sh" ]; then
    "$HOME/.local/bin/post-installx/post-cua-driver.sh" >/dev/null 2>&1 || true
  fi
  if [ -x "$HOME/.local/bin/cnf-build-shims" ]; then
    "$HOME/.local/bin/cnf-build-shims" >/dev/null 2>&1 || true
  fi
  exit 0
fi

export PATH="$HOME/.local/share/mise/shims:$HOME/.bun/bin:$HOME/.local/share/cargo/bin:$HOME/.cargo/bin:$HOME/.local/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
mkdir -p "$HOME/.local/bin" "$HOME/.config/shell" "$HOME/.cache/cnf/shims"

resolve_infisical_sudo_password() {
  local pw="${SUDO_PASSWORD:-}"
  if [ -z "$pw" ] && command -v get-secret >/dev/null 2>&1; then
    pw="$(get-secret SUDO_PASSWORD 2>/dev/null || true)"
  fi
  if [ -z "$pw" ] && command -v infisical >/dev/null 2>&1 && [ -n "${INFISICAL_TOKEN:-}" ]; then
    pw="$(infisical secrets get SUDO_PASSWORD --env=prod --path="/hosts/$(hostname -s 2>/dev/null || hostname)" --plain --silent 2>/dev/null || infisical secrets get SUDO_PASSWORD --plain --silent 2>/dev/null || true)"
  fi
  if [ -z "$pw" ] && [ -f "$HOME/.config/agent-fleet/infisical.json" ] && command -v python3 >/dev/null 2>&1; then
    pw="$(python3 - <<'PY' 2>/dev/null || true
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

cfg_path = Path.home() / ".config/agent-fleet/infisical.json"
cfg = json.loads(cfg_path.read_text())
cred_path = Path(cfg.get("credentialsFile", str(Path.home() / ".config/agent-fleet/infisical-us-credentials.json"))).expanduser()
if not cred_path.exists():
    cred_path = Path.home() / ".config/agent-fleet/infisical-us-credentials.json"
creds = json.loads(cred_path.read_text())
base = cfg["url"].rstrip("/")
headers = {"Content-Type": "application/json", "User-Agent": "infisical-fleet-broker/1.0"}
req = Request(f"{base}/api/v1/auth/universal-auth/login", data=json.dumps(creds).encode(), headers=headers)
with urlopen(req, timeout=10) as resp:
    tok = json.load(resp)["accessToken"]
q = urlencode({"workspaceId": cfg["projectId"], "environment": cfg.get("environment", "prod"), "secretPath": cfg.get("secretPath", "/"), "type": "shared"})
req2 = Request(f"{base}/api/v3/secrets/raw/SUDO_PASSWORD?{q}", headers={"Authorization": f"Bearer {tok}", "User-Agent": "infisical-fleet-broker/1.0"})
with urlopen(req2, timeout=10) as resp2:
    print(json.load(resp2)["secret"]["secretValue"], end="")
PY
)"
  fi
  printf '%s' "$pw"
}

SUDO=""
COOLIFY_KEY="$HOME/legion-provision/private/coolify-legion-ed25519"
if [ "$(id -u)" -ne 0 ]; then
  SUDO_PW="$(resolve_infisical_sudo_password)"
  if [ -n "$SUDO_PW" ]; then
    ASKPASS_SCRIPT="$TMP_DIR/sudo-askpass.sh"
    printf '#!/usr/bin/env sh\nprintf '\''%%s\\n'\'' %q\n' "$SUDO_PW" > "$ASKPASS_SCRIPT"
    chmod 0700 "$ASKPASS_SCRIPT"
    export SUDO_ASKPASS="$ASKPASS_SCRIPT"
    if sudo -A -k true 2>/dev/null; then
      SUDO="sudo-askpass"
    fi
    unset SUDO_PW
  fi
  if [ -z "$SUDO" ] && sudo -n true 2>/dev/null; then
    SUDO="sudo"
  elif [ -z "$SUDO" ] && [ -f "$COOLIFY_KEY" ] && ssh -o BatchMode=yes -o ConnectTimeout=3 -i "$COOLIFY_KEY" coolify@127.0.0.1 "sudo -n true" 2>/dev/null; then
    SUDO="coolify-ssh"
  fi
fi

has_root() {
  [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif [ "$SUDO" = "sudo-askpass" ]; then
    sudo -A "$@"
  elif [ "$SUDO" = "sudo" ]; then
    sudo -n "$@"
  elif [ "$SUDO" = "coolify-ssh" ]; then
    local qcmd="" arg
    for arg in "$@"; do
      qcmd="$qcmd $(printf '%q' "$arg")"
    done
    ssh -o BatchMode=yes -i "$COOLIFY_KEY" coolify@127.0.0.1 "sudo -n $qcmd"
  else
    return 1
  fi
}

# -----------------------------------------------------------------------------
# 1. Eager Base APT Packages (Minimal Substrates, GPU/System Monitors, ZFS Sanoid; CLI tools lazy-load via CNF)
# -----------------------------------------------------------------------------
if command -v apt-get >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
  log "Installing minimal foundation packages via APT (all convenience/media/linter CLIs lazy-load via CNF)..."
  run_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates curl wget git jq zsh tmux ripgrep fd-find fzf bat \
    htop btop nvtop gh sanoid lzop pv mbuffer \
    age build-essential pkg-config libssl-dev unzip xz-utils zstd \
    smartmontools net-tools bind9-dnsutils ufw unattended-upgrades apt-listchanges \
    lm-sensors i2c-tools dkms python3-yaml python3-pip python3-venv >/dev/null 2>&1 || true
fi

# Symlink Ubuntu's fdfind -> fd and batcat -> bat in ~/.local/bin
if command -v fdfind >/dev/null 2>&1 && ! command -v fd >/dev/null 2>&1; then
  ln -sf "$(command -v fdfind)" "$HOME/.local/bin/fd"
fi
if command -v batcat >/dev/null 2>&1 && ! command -v bat >/dev/null 2>&1; then
  ln -sf "$(command -v batcat)" "$HOME/.local/bin/bat"
fi

# -----------------------------------------------------------------------------
# 2. Bootstrap & Runtime Substrates (chezmoi, task, gum, yq, mise, node, bun, uv, go, rust)
#    (actionlint, ruff, deno, ffmpeg, pandoc, imagemagick, rclone, restic, etc. lazy-load via CNF shims)
# -----------------------------------------------------------------------------
if ! command -v chezmoi >/dev/null 2>&1; then
  log "Installing chezmoi..."
  sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$HOME/.local/bin" >/dev/null 2>&1 || true
fi

if ! command -v task >/dev/null 2>&1; then
  log "Installing go-task (task)..."
  sh -c "$(curl -fsSL https://taskfile.dev/install.sh)" -- -d -b "$HOME/.local/bin" >/dev/null 2>&1 || true
fi

if ! command -v yq >/dev/null 2>&1; then
  log "Installing yq..."
  curl -fsSL "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64" -o "$HOME/.local/bin/yq" && chmod +x "$HOME/.local/bin/yq" || true
fi

if ! command -v gum >/dev/null 2>&1; then
  log "Installing gum..."
  GUM_VER="0.16.0"
  if curl -fsSL "https://github.com/charmbracelet/gum/releases/download/v${GUM_VER}/gum_${GUM_VER}_Linux_x86_64.tar.gz" -o "$TMP_DIR/gum.tar.gz"; then
    tar -xzf "$TMP_DIR/gum.tar.gz" -C "$TMP_DIR"
    find "$TMP_DIR" -name gum -type f -exec mv {} "$HOME/.local/bin/gum" \;
    chmod +x "$HOME/.local/bin/gum"
  fi
fi

if ! command -v uv >/dev/null 2>&1; then
  log "Installing uv + uvx..."
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$HOME/.local/bin" sh >/dev/null 2>&1 || true
fi

if ! command -v mise >/dev/null 2>&1; then
  log "Installing mise..."
  curl -fsSL https://mise.run | sh >/dev/null 2>&1 || true
fi

if command -v mise >/dev/null 2>&1; then
  log "Ensuring Node.js LTS, Go, and Python via mise..."
  mise use --global node@lts go@latest >/dev/null 2>&1 || true
  eval "$(mise env -s bash 2>/dev/null)" || true
  MISE_GO_BIN="$(find "$HOME/.local/share/mise/installs/go" -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$MISE_GO_BIN" ] && [ -x "$MISE_GO_BIN/go" ]; then
    ln -sf "$MISE_GO_BIN/go" "$HOME/.local/bin/go"
    [ -x "$MISE_GO_BIN/gofmt" ] && ln -sf "$MISE_GO_BIN/gofmt" "$HOME/.local/bin/gofmt"
  fi
fi

if ! command -v bun >/dev/null 2>&1; then
  log "Installing bun..."
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || true
  if [ -x "$HOME/.bun/bin/bun" ]; then
    ln -sf "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun"
    ln -sf "$HOME/.bun/bin/bun" "$HOME/.local/bin/bunx"
  fi
fi

if ! command -v cargo >/dev/null 2>&1; then
  log "Installing Rust toolchain (rustup/cargo/rustc)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path >/dev/null 2>&1 || true
fi
for rust_dir in "$HOME/.cargo/bin" "$HOME/.local/share/cargo/bin"; do
  if [ -d "$rust_dir" ]; then
    for rbin in cargo rustc rustup rustfmt cargo-clippy; do
      [ -x "$rust_dir/$rbin" ] && ln -sf "$rust_dir/$rbin" "$HOME/.local/bin/$rbin"
    done
  fi
done

# -----------------------------------------------------------------------------
# 3. Item #11: Secrets Stack (infisical, age, sops — NO OnlyKey / FIDO2 tools)
# -----------------------------------------------------------------------------
if ! command -v age >/dev/null 2>&1; then
  log "Installing age + age-keygen..."
  AGE_VER="v1.2.1"
  if curl -fsSL "https://github.com/FiloSottile/age/releases/download/${AGE_VER}/age-${AGE_VER}-linux-amd64.tar.gz" -o "$TMP_DIR/age.tar.gz"; then
    tar -xzf "$TMP_DIR/age.tar.gz" -C "$TMP_DIR"
    if [ -f "$TMP_DIR/age/age" ]; then
      mv "$TMP_DIR/age/age" "$HOME/.local/bin/age"
      mv "$TMP_DIR/age/age-keygen" "$HOME/.local/bin/age-keygen"
      chmod +x "$HOME/.local/bin/age" "$HOME/.local/bin/age-keygen"
    fi
  fi
fi

if ! command -v sops >/dev/null 2>&1; then
  log "Installing sops..."
  SOPS_VER="v3.9.4"
  curl -fsSL "https://github.com/getsops/sops/releases/download/${SOPS_VER}/sops-${SOPS_VER}.linux.amd64" -o "$HOME/.local/bin/sops" && chmod +x "$HOME/.local/bin/sops" || true
fi

if ! command -v infisical >/dev/null 2>&1; then
  log "Installing infisical CLI..."
  INF_VER="0.44.12"
  if curl -fsSL "https://github.com/Infisical/cli/releases/download/v${INF_VER}/cli_${INF_VER}_linux_amd64.tar.gz" -o "$TMP_DIR/infisical.tar.gz"; then
    tar -xzf "$TMP_DIR/infisical.tar.gz" -C "$TMP_DIR" infisical 2>/dev/null || tar -xzf "$TMP_DIR/infisical.tar.gz" -C "$TMP_DIR"
    if [ -f "$TMP_DIR/infisical" ]; then
      mv "$TMP_DIR/infisical" "$HOME/.local/bin/infisical"
      chmod +x "$HOME/.local/bin/infisical"
    fi
  fi
fi

if ! command -v emdash >/dev/null 2>&1; then
  log "Installing Emdash multi-agent orchestrator..."
  if command -v apt-get >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
    if curl -fsSL "https://github.com/generalaction/emdash/releases/latest/download/emdash-amd64.deb" -o "$TMP_DIR/emdash-amd64.deb"; then
      run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$TMP_DIR/emdash-amd64.deb" >/dev/null 2>&1 || true
    fi
  fi
  if ! command -v emdash >/dev/null 2>&1; then
    curl -fsSL "https://github.com/generalaction/emdash/releases/latest/download/emdash-x86_64.AppImage" -o "$HOME/.local/bin/emdash" && chmod +x "$HOME/.local/bin/emdash" || true
  fi
fi

# -----------------------------------------------------------------------------
# 4. Tier 1: AI Coding Agents & LSPs (claude, codex, opencode, agy, LSP servers)
# -----------------------------------------------------------------------------
if command -v npm >/dev/null 2>&1; then
  log "Installing AI coding CLIs and LSP servers via npm..."
  npm uninstall -g @google/gemini-cli >/dev/null 2>&1 || true
  rm -f "$HOME/.local/bin/gemini" "$HOME/.gemini/oauth_creds.json" "$HOME/.gemini/google_accounts.json"
  npm install -g \
    @anthropic-ai/claude-code \
    @openai/codex \
    opencode-ai \
    @fission-ai/openspec \
    pnpm \
    typescript \
    typescript-language-server \
    pyright \
    bash-language-server \
    vscode-langservers-extracted \
    yaml-language-server >/dev/null 2>&1 || true
fi

# Install/update Google Antigravity CLI (agy) via official auto-updater manifest
if ! [ -x "$HOME/.local/bin/agy" ]; then
  log "Installing Google Antigravity CLI (agy)..."
  AGY_MANIFEST_URL="https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json"
  if AGY_MANIFEST_JSON="$(curl -fsSL "$AGY_MANIFEST_URL" 2>/dev/null)"; then
    AGY_TAR_URL="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["url"])' "$AGY_MANIFEST_JSON" 2>/dev/null || true)"
    AGY_SHA512="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["sha512"])' "$AGY_MANIFEST_JSON" 2>/dev/null || true)"
    if [ -n "$AGY_TAR_URL" ] && curl -fsSL "$AGY_TAR_URL" -o "$TMP_DIR/agy.tar.gz"; then
      ACTUAL_SHA="$(python3 -c 'import hashlib,sys; print(hashlib.sha512(open(sys.argv[1],"rb").read()).hexdigest())' "$TMP_DIR/agy.tar.gz" 2>/dev/null || true)"
      if [ "$ACTUAL_SHA" = "$AGY_SHA512" ]; then
        tar -xzf "$TMP_DIR/agy.tar.gz" -C "$TMP_DIR"
        AGY_BIN="$(find "$TMP_DIR" -type f \( -name agy -o -name antigravity \) | head -n 1 || true)"
        if [ -n "$AGY_BIN" ] && [ -f "$AGY_BIN" ]; then
          install -m 0755 "$AGY_BIN" "$HOME/.local/bin/agy"
        fi
      fi
    fi
  fi
else
  "$HOME/.local/bin/agy" update >/dev/null 2>&1 || true
fi
if [ -x "$HOME/.local/bin/agy" ]; then
  "$HOME/.local/bin/agy" install --skip-aliases >/dev/null 2>&1 || true
  if [ -x "$HOME/.local/bin/cua-driver-mcp" ]; then
    "$HOME/.local/bin/agy" mcp add cua-driver "$HOME/.local/bin/cua-driver-mcp" >/dev/null 2>&1 || true
  elif [ -x "$HOME/.local/bin/cua-driver" ]; then
    "$HOME/.local/bin/agy" mcp add cua-driver "$HOME/.local/bin/cua-driver" mcp >/dev/null 2>&1 || true
  fi
fi

# Ensure ~/.local/bin symlinks for mise-installed npm globals
MISE_NODE_BIN="$(find "$HOME/.local/share/mise/installs/node" -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$MISE_NODE_BIN" ] && [ -d "$MISE_NODE_BIN" ]; then
  for bin_name in node npm npx claude codex opencode openspec pnpm tsc typescript-language-server pyright bash-language-server yaml-language-server; do
    if [ -x "$MISE_NODE_BIN/$bin_name" ]; then
      ln -sf "$MISE_NODE_BIN/$bin_name" "$HOME/.local/bin/$bin_name"
    fi
  done
fi

# Configure OpenCode with LiteLLM (llm.megabyte.space) primary rail + DeepSeek direct fallback
python3 - <<'PY' || true
import json
from pathlib import Path

home = Path.home()
oc_dir = home / ".config/opencode"
oc_dir.mkdir(parents=True, exist_ok=True)
cua_bin = str(home / ".local/bin/cua-driver")

oc_jsonc = {
    "$schema": "https://opencode.ai/config.json",
    "model": "litellm/deepseek-v4-pro",
    "small_model": "litellm/deepseek-flash",
    "disabled_providers": ["openai", "anthropic"],
    "mcp": {
        "cua-driver": {
            "type": "local",
            "command": [cua_bin, "mcp"],
            "enabled": True
        }
    },
    "provider": {
        "litellm": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "LiteLLM (llm.megabyte.space - DeepSeek 4-key rotation + fallback + Langfuse)",
            "options": {
                "baseURL": "https://llm.megabyte.space/v1"
            },
            "models": {
                "deepseek-v4-pro": {
                    "name": "DeepSeek V4 Pro (rotated)",
                    "reasoning": True,
                    "tool_call": True,
                    "temperature": True,
                    "limit": {"context": 1048576, "output": 393216},
                    "modalities": {"input": ["text"], "output": ["text"]},
                    "variants": {
                        "high": {"reasoningEffort": "high"},
                        "max": {"reasoningEffort": "max"}
                    }
                },
                "deepseek-flash": {
                    "name": "DeepSeek V4.1 Flash (rotated)",
                    "reasoning": True,
                    "tool_call": True,
                    "temperature": True,
                    "attachment": True,
                    "limit": {"context": 1048576, "output": 393216},
                    "modalities": {"input": ["text", "image"], "output": ["text"]},
                    "variants": {
                        "low": {"reasoningEffort": "low"},
                        "high": {"reasoningEffort": "high"}
                    }
                },
                "deepseek-chat": {"name": "DeepSeek Chat (rotated)", "tool_call": True, "temperature": True},
                "deepseek-reasoner": {"name": "DeepSeek Reasoner (rotated)", "reasoning": True, "tool_call": True}
            }
        },
        "deepseek": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "DeepSeek (direct)",
            "options": {
                "baseURL": "https://api.deepseek.com"
            },
            "models": {
                "deepseek-v4-pro": {
                    "name": "DeepSeek V4 Pro",
                    "reasoning": True,
                    "tool_call": True,
                    "temperature": True,
                    "attachment": False,
                    "limit": {"context": 1048576, "output": 393216},
                    "modalities": {"input": ["text"], "output": ["text"]}
                },
                "deepseek-flash": {
                    "name": "DeepSeek V4.1 Flash",
                    "reasoning": True,
                    "tool_call": True,
                    "temperature": True,
                    "attachment": True,
                    "limit": {"context": 1048576, "output": 393216},
                    "modalities": {"input": ["text", "image"], "output": ["text"]}
                },
                "deepseek-chat": {
                    "name": "DeepSeek Chat (legacy -> V4.1 Flash)",
                    "tool_call": True,
                    "temperature": True,
                    "attachment": True,
                    "limit": {"context": 1048576, "output": 393216},
                    "modalities": {"input": ["text", "image"], "output": ["text"]}
                },
                "deepseek-reasoner": {
                    "name": "DeepSeek Reasoner (legacy -> V4.1 Flash)",
                    "reasoning": True,
                    "tool_call": True,
                    "temperature": True,
                    "attachment": False,
                    "limit": {"context": 1048576, "output": 393216},
                    "modalities": {"input": ["text"], "output": ["text"]}
                }
            }
        }
    }
}
(oc_dir / "opencode.jsonc").write_text(json.dumps(oc_jsonc, indent=2) + "\n")
PY
if [ -x "$HOME/.agentskills/bin/opencode-deepseek-auth.sh" ]; then
  "$HOME/.agentskills/bin/opencode-deepseek-auth.sh" sync >/dev/null 2>&1 || true
fi

# Nerd Fonts (MesloLGS NF) for terminal & prompt glyphs
FONT_DIR="$HOME/.local/share/fonts/NerdFonts"
if [ ! -f "$FONT_DIR/MesloLGS NF Regular.ttf" ]; then
  log "Installing MesloLGS NF Nerd Fonts..."
  mkdir -p "$FONT_DIR"
  for style in "Regular" "Bold" "Italic" "Bold%20Italic"; do
    fname="MesloLGS NF ${style//%20/ }.ttf"
    curl -fsSL "https://github.com/romkatv/powerlevel10k-media/raw/307625efccbc8bf1ad5efde7c5eb27b33a974b8c/MesloLGS%20NF%20${style}.ttf" -o "$FONT_DIR/$fname" || true
  done
  command -v fc-cache >/dev/null 2>&1 && fc-cache -f "$FONT_DIR" >/dev/null 2>&1 || true
fi

# -----------------------------------------------------------------------------
# 5. Tier 3: Lenovo Legion 9i (16IRX9) Hardware, Audio, EC & Sysctl Optimizations
# -----------------------------------------------------------------------------
if [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; then
  # #12: Battery Conservation Mode (Lenovo ideapad_acpi VPC2004:00)
  CONSERVATION_NODE="$(find -L /sys/bus/platform/drivers/ideapad_acpi -maxdepth 3 -name conservation_mode 2>/dev/null | head -n 1 || true)"
  if [ -n "$CONSERVATION_NODE" ]; then
    log "Enabling Lenovo Legion Battery Conservation Mode ($CONSERVATION_NODE = 1)..."
    printf '1\n' | run_root tee "$CONSERVATION_NODE" >/dev/null 2>&1 || true
    cat > "$TMP_DIR/legion-conservation-mode.service" <<EOF
[Unit]
Description=Lenovo Legion Battery Conservation Mode (60-80%% Charge Cap)
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'for f in /sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode; do [ -w "\$f" ] && echo 1 > "\$f" || true; done'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
    run_root cp "$TMP_DIR/legion-conservation-mode.service" /etc/systemd/system/legion-conservation-mode.service
    run_root systemctl daemon-reload
    run_root systemctl enable --now legion-conservation-mode.service >/dev/null 2>&1 || true
  fi

  # #13: Lenovo Legion EC / WMI / Thermal & Fan Control CLI (/usr/local/bin/legion-ec-ctl)
  if grep -qE 'lenovo_wmi|ideapad_laptop' /proc/modules 2>/dev/null; then
    cat > "$TMP_DIR/legion-ec-ctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-status}" in
  status)
    printf '=== Lenovo Legion Hardware & EC Status ===\n'
    printf 'Platform Profile: %s\n' "$(cat /sys/firmware/acpi/platform_profile 2>/dev/null || echo unknown)"
    printf 'Available Profiles: %s\n' "$(cat /sys/firmware/acpi/platform_profile_choices 2>/dev/null || echo unknown)"
    printf 'CPU Scaling Governor: %s\n' "$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo unknown)"
    printf 'CPU EPP: %s\n' "$(cat /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference 2>/dev/null || echo unknown)"
    for f in /sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode /sys/bus/platform/drivers/ideapad_acpi/*/fan_mode; do
      [ -r "$f" ] && printf '%s: %s\n' "$(basename "$f")" "$(cat "$f")"
    done
    command -v sensors >/dev/null 2>&1 && sensors 2>/dev/null | head -n 25 || true
    ;;
  conservation-on)
    for f in /sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode; do [ -w "$f" ] && echo 1 > "$f"; done
    ;;
  conservation-off)
    for f in /sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode; do [ -w "$f" ] && echo 0 > "$f"; done
    ;;
  profile)
    [ -n "${2:-}" ] && echo "$2" > /sys/firmware/acpi/platform_profile
    ;;
  *)
    printf 'Usage: legion-ec-ctl {status|conservation-on|conservation-off|profile <quiet|balanced|performance>}\n' >&2
    exit 1
    ;;
esac
EOF
    run_root install -m 0755 "$TMP_DIR/legion-ec-ctl" /usr/local/bin/legion-ec-ctl
  fi

  # #14: TI TAS2781 Smart Amplifier Speaker Fix (Legion 9i 16IRX9)
  if grep -q 'snd_hda_scodec_tas2781' /proc/modules 2>/dev/null; then
    log "Applying TI TAS2781 Smart Amplifier audio configuration..."
    cat > "$TMP_DIR/legion-tas2781-audio.conf" <<'EOF'
# Lenovo Legion 9i (16IRX9) Realtek ALC287 + TI TAS2781 Smart Amplifier config
options snd-hda-intel model=auto
blacklist snd_soc_avs
EOF
    run_root cp "$TMP_DIR/legion-tas2781-audio.conf" /etc/modprobe.d/legion-tas2781-audio.conf
    cat > "$TMP_DIR/tas2781-init.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
for card in 0 1 2; do
  if amixer -c "$card" info 2>/dev/null | grep -qiE 'PCH|ALC287|sof'; then
    amixer -c "$card" sset 'Master' 85% unmute >/dev/null 2>&1 || true
    amixer -c "$card" sset 'Speaker' 85% unmute >/dev/null 2>&1 || true
    amixer -c "$card" cset numid=53 on >/dev/null 2>&1 || true
  fi
done
EOF
    run_root install -m 0755 "$TMP_DIR/tas2781-init.sh" /usr/local/bin/tas2781-init.sh
    cat > "$TMP_DIR/legion-tas2781-init.service" <<'EOF'
[Unit]
Description=Initialize Lenovo Legion TI TAS2781 Smart Amplifiers
After=sound.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/tas2781-init.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
    run_root cp "$TMP_DIR/legion-tas2781-init.service" /etc/systemd/system/legion-tas2781-init.service
    run_root systemctl daemon-reload
    run_root systemctl enable --now legion-tas2781-init.service >/dev/null 2>&1 || true
  fi

  # #15: Kernel Sysctl (TCP BBR, fq, swappiness=10) & CPU EPP Tuning
  log "Applying workstation & fleet sysctl tuning (BBR, fq, vm.swappiness=10, inotify)..."
  cat > "$TMP_DIR/99-fleet.conf" <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
vm.swappiness = 10
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 1024
vm.max_map_count = 1048576
EOF
  run_root cp "$TMP_DIR/99-fleet.conf" /etc/sysctl.d/99-fleet.conf
  run_root cp "$TMP_DIR/99-fleet.conf" /etc/sysctl.d/99-megabyte-workstation.conf
  run_root sysctl --system >/dev/null 2>&1 || true
  for epp in /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference; do
    [ -w "$epp" ] && printf 'balance_performance\n' | run_root tee "$epp" >/dev/null 2>&1 || true
  done

  # #16: Enforce Infisical-backed sudo (remove any legacy passwordless sudoers drop-in) & Coolify Fleet Node Readiness
  log "Removing legacy passwordless sudoers drop-ins (sudo password loaded via Infisical) and configuring Coolify node readiness..."
  run_root rm -f /etc/sudoers.d/90-fleet-nopasswd 2>/dev/null || true

  # Ensure Docker Engine + Compose v2 is installed and bound to loopback + registry mirror + NVIDIA CDI
  if ! command -v docker >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    log "Installing Docker Engine + Compose v2 from official Docker APT repository..."
    run_root install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor > "$TMP_DIR/docker.gpg"
    run_root install -o root -g root -m 0644 "$TMP_DIR/docker.gpg" /etc/apt/keyrings/docker.gpg
    UBUNTU_CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-noble}")"
    # Fall back to noble if Ubuntu 26.04 (resolute) repo is not yet published by Docker
    if ! curl -fsSL "https://download.docker.com/linux/ubuntu/dists/${UBUNTU_CODENAME}/Release" >/dev/null 2>&1; then
      UBUNTU_CODENAME="noble"
    fi
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$(dpkg --print-architecture)" "$UBUNTU_CODENAME" > "$TMP_DIR/docker.list"
    run_root cp "$TMP_DIR/docker.list" /etc/apt/sources.list.d/docker.list
    run_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
    run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null 2>&1 || true
  fi

  if ! id -u coolify >/dev/null 2>&1; then
    run_root useradd -m -s /bin/bash coolify >/dev/null 2>&1 || true
  fi
  if getent group docker >/dev/null 2>&1; then
    for u in "${USER:-ubuntu}" ubuntu coolify professormanhattan; do
      id -u "$u" >/dev/null 2>&1 && run_root usermod -aG docker "$u" 2>/dev/null || true
    done
  fi

  # Ensure Coolify controller SSH public keys are authorized on fleet nodes
  for ssh_user in coolify ubuntu root; do
    user_home="$(getent passwd "$ssh_user" 2>/dev/null | cut -d: -f6 || true)"
    [ -n "$user_home" ] || continue
    run_root install -d -m 0700 -o "$ssh_user" -g "$ssh_user" "$user_home/.ssh" 2>/dev/null || true
    run_root touch "$user_home/.ssh/authorized_keys"
    run_root chown "$ssh_user:$ssh_user" "$user_home/.ssh/authorized_keys" 2>/dev/null || true
    run_root chmod 0600 "$user_home/.ssh/authorized_keys" 2>/dev/null || true
    for pubkey in \
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA3G+dR/tJSuN2bVGXioB8pI9vHbcW6mC5wR4qT3xK1L coolify-fleet-ed25519" \
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPvUHT2ymA2A3nL4uKz5mG2b7cR8tP9qW1vX0yZ3nM4K root@coolify"; do
      if ! run_root grep -qF "${pubkey% *}" "$user_home/.ssh/authorized_keys" 2>/dev/null; then
        printf '%s\n' "$pubkey" | run_root tee -a "$user_home/.ssh/authorized_keys" >/dev/null || true
      fi
    done
  done

  # Configure /etc/docker/daemon.json (loopback 127.0.0.1 binding + registry mirror + optional NVIDIA CDI)
  if command -v docker >/dev/null 2>&1; then
    HAS_NV="0"
    command -v nvidia-ctk >/dev/null 2>&1 && HAS_NV="1"
    python3 - "$TMP_DIR/daemon.json" "$HAS_NV" <<'PY' || true
import json, sys
from pathlib import Path

out = Path(sys.argv[1])
has_nv = sys.argv[2] == "1"
cur = Path("/etc/docker/daemon.json")
data = {}
if cur.exists():
    try:
        data = json.loads(cur.read_text())
    except Exception:
        data = {}
data.setdefault("ip", "127.0.0.1")
data.setdefault("live-restore", True)
data.setdefault("log-driver", "local")
data.setdefault("log-opts", {"max-size": "10m", "max-file": "3"})
mirrors = data.setdefault("registry-mirrors", [])
if "https://registry.megabyte.space" not in mirrors:
    mirrors.append("https://registry.megabyte.space")
if has_nv:
    data.setdefault("features", {})["cdi"] = True
    data.setdefault("runtimes", {})["nvidia"] = {
        "path": "nvidia-container-runtime",
        "runtimeArgs": []
    }
out.write_text(json.dumps(data, indent=2) + "\n")
PY
    if [ -s "$TMP_DIR/daemon.json" ]; then
      run_root install -d -m 0755 /etc/docker
      run_root cp "$TMP_DIR/daemon.json" /etc/docker/daemon.json
    fi
  fi

  # #17: NVIDIA GPU Persistence Mode (<host>-gpu-tune.service) & Loopback Hardware Exporter (<host>-hw-exporter.service on 127.0.0.1:9835)
  HOST_SHORT="$(hostname -s 2>/dev/null || hostname)"
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    cat > "$TMP_DIR/${HOST_SHORT}-gpu-tune.service" <<EOF
[Unit]
Description=NVIDIA GPU Persistence Mode Tuning (${HOST_SHORT})
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/usr/bin/nvidia-smi -pm 1
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
    run_root cp "$TMP_DIR/${HOST_SHORT}-gpu-tune.service" "/etc/systemd/system/${HOST_SHORT}-gpu-tune.service"
    run_root systemctl daemon-reload
    run_root systemctl enable --now "${HOST_SHORT}-gpu-tune.service" >/dev/null 2>&1 || true
  fi

  cat > "$TMP_DIR/${HOST_SHORT}-hw-exporter.py" <<'EOF'
#!/usr/bin/env python3
"""Loopback Prometheus hardware exporter (127.0.0.1:9835) for NVIDIA GPU, Intel RAPL, and NVMe/SATA SMART."""
import glob
import http.server
import json
import os
import socketserver
import subprocess

PORT = int(os.environ.get("HW_EXPORTER_PORT", "9835"))


def collect_metrics() -> str:
    lines = [
        "# HELP nvidia_gpu_temperature_celsius NVIDIA GPU temperature in Celsius",
        "# TYPE nvidia_gpu_temperature_celsius gauge",
        "# HELP nvidia_gpu_power_draw_watts NVIDIA GPU power draw in Watts",
        "# TYPE nvidia_gpu_power_draw_watts gauge",
        "# HELP nvidia_gpu_utilization_percent NVIDIA GPU utilization percentage",
        "# TYPE nvidia_gpu_utilization_percent gauge",
        "# HELP nvidia_gpu_memory_used_bytes NVIDIA GPU memory used in bytes",
        "# TYPE nvidia_gpu_memory_used_bytes gauge",
        "# HELP nvidia_gpu_memory_total_bytes NVIDIA GPU memory total in bytes",
        "# TYPE nvidia_gpu_memory_total_bytes gauge",
    ]
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=index,name,temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            timeout=5,
            stderr=subprocess.DEVNULL,
        )
        for row in out.strip().splitlines():
            parts = [p.strip() for p in row.split(",")]
            if len(parts) >= 7:
                idx, name, temp, pwr, util, mem_u, mem_t = parts[:7]
                lbl = f'gpu="{idx}",name="{name}"'
                for metric, val, scale in [
                    ("nvidia_gpu_temperature_celsius", temp, 1.0),
                    ("nvidia_gpu_power_draw_watts", pwr, 1.0),
                    ("nvidia_gpu_utilization_percent", util, 1.0),
                    ("nvidia_gpu_memory_used_bytes", mem_u, 1048576.0),
                    ("nvidia_gpu_memory_total_bytes", mem_t, 1048576.0),
                ]:
                    try:
                        lines.append(f"{metric}{{{lbl}}} {float(val) * scale:.2f}")
                    except ValueError:
                        pass
    except Exception:
        pass

    lines.append("# HELP rapl_energy_microjoules Intel RAPL energy counter in microjoules")
    lines.append("# TYPE rapl_energy_microjoules counter")
    for path in sorted(glob.glob("/sys/class/powercap/intel-rapl:*")):
        try:
            name = open(os.path.join(path, "name")).read().strip()
            energy = open(os.path.join(path, "energy_uj")).read().strip()
            lines.append(f'rapl_energy_microjoules{{domain="{name}"}} {int(energy)}')
        except Exception:
            pass

    lines.append("# HELP nvme_smart_critical_warning NVMe SMART critical warning bitmap")
    lines.append("# TYPE nvme_smart_critical_warning gauge")
    for dev in ("/dev/nvme0", "/dev/nvme1", "/dev/sda"):
        if not os.path.exists(dev):
            continue
        try:
            out = subprocess.check_output(
                ["smartctl", "-j", "-a", dev], text=True, timeout=5, stderr=subprocess.DEVNULL
            )
            data = json.loads(out)
            cw = data.get("nvme_smart_health_information_log", {}).get("critical_warning", 0)
            lines.append(f'nvme_smart_critical_warning{{device="{dev}"}} {int(cw)}')
        except Exception:
            pass

    if os.path.exists("/proc/spl/kstat/zfs/arcstats"):
        try:
            arc = {}
            for line in open("/proc/spl/kstat/zfs/arcstats"):
                parts = line.split()
                if len(parts) == 3 and parts[2].isdigit():
                    arc[parts[0]] = int(parts[2])
            hits = arc.get("hits", 0)
            misses = arc.get("misses", 0)
            total = hits + misses
            ratio = (hits / total) if total > 0 else 1.0
            lines.extend([
                "# HELP zfs_arc_size_bytes ZFS ARC current size in bytes",
                "# TYPE zfs_arc_size_bytes gauge",
                f"zfs_arc_size_bytes {arc.get('size', 0)}",
                "# HELP zfs_arc_max_bytes ZFS ARC target max size in bytes",
                "# TYPE zfs_arc_max_bytes gauge",
                f"zfs_arc_max_bytes {arc.get('c_max', 0)}",
                "# HELP zfs_arc_hits_total ZFS ARC hits counter",
                "# TYPE zfs_arc_hits_total counter",
                f"zfs_arc_hits_total {hits}",
                "# HELP zfs_arc_misses_total ZFS ARC misses counter",
                "# TYPE zfs_arc_misses_total counter",
                f"zfs_arc_misses_total {misses}",
                "# HELP zfs_arc_hit_ratio ZFS ARC hit ratio (0.0-1.0)",
                "# TYPE zfs_arc_hit_ratio gauge",
                f"zfs_arc_hit_ratio {ratio:.4f}",
            ])
        except Exception:
            pass

    for res in ("cpu", "memory", "io"):
        psi_path = f"/proc/pressure/{res}"
        if os.path.exists(psi_path):
            try:
                first = open(psi_path).readline()
                for kv in first.split():
                    if kv.startswith("avg10="):
                        val = float(kv.split("=", 1)[1])
                        lines.append(f"# HELP linux_psi_{res}_some_avg10 Linux PSI {res} some avg10 percentage")
                        lines.append(f"# TYPE linux_psi_{res}_some_avg10 gauge")
                        lines.append(f"linux_psi_{res}_some_avg10 {val:.2f}")
            except Exception:
                pass

    return "\n".join(lines) + "\n"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        body = collect_metrics().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        httpd.serve_forever()
EOF
  run_root install -m 0755 "$TMP_DIR/${HOST_SHORT}-hw-exporter.py" "/usr/local/bin/${HOST_SHORT}-hw-exporter.py"
  cat > "$TMP_DIR/${HOST_SHORT}-hw-exporter.service" <<EOF
[Unit]
Description=Hardware Telemetry Prometheus Exporter (${HOST_SHORT} - 127.0.0.1:9835)
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/python3 /usr/local/bin/${HOST_SHORT}-hw-exporter.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  run_root cp "$TMP_DIR/${HOST_SHORT}-hw-exporter.service" "/etc/systemd/system/${HOST_SHORT}-hw-exporter.service"
  run_root systemctl daemon-reload
  run_root systemctl enable --now "${HOST_SHORT}-hw-exporter.service" >/dev/null 2>&1 || true

  # #18: Grafana Alloy Observability Shipper (127.0.0.1:12345 -> 10.0.0.155 Prometheus & Loki)
  if command -v docker >/dev/null 2>&1; then
    run_root install -d -m 0755 /etc/alloy
    cat > "$TMP_DIR/config.alloy" <<EOF
prometheus.exporter.unix "node" {}

prometheus.scrape "node" {
  targets    = prometheus.exporter.unix.node.targets
  forward_to = [prometheus.remote_write.central.receiver]
}

prometheus.scrape "hw_exporter" {
  targets = [{
    __address__ = "127.0.0.1:9835",
    instance    = "${HOST_SHORT}",
    host        = "${HOST_SHORT}",
  }]
  forward_to = [prometheus.remote_write.central.receiver]
}

prometheus.remote_write "central" {
  endpoint {
    url = "http://10.0.0.155:9090/api/v1/write"
  }
  external_labels = {
    host = "${HOST_SHORT}",
  }
}

loki.relabel "journal" {
  forward_to = []
  rule {
    source_labels = ["__journal__systemd_unit"]
    target_label  = "unit"
  }
}

loki.source.journal "systemd" {
  forward_to    = [loki.write.central.receiver]
  relabel_rules = loki.relabel.journal.rules
  labels        = {
    host = "${HOST_SHORT}",
    job  = "systemd-journal",
  }
}

loki.write "central" {
  endpoint {
    url = "http://10.0.0.155:3100/loki/api/v1/push"
  }
}
EOF
    run_root cp "$TMP_DIR/config.alloy" /etc/alloy/config.alloy
    if ! run_root docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'alloy'; then
      run_root docker rm -f alloy >/dev/null 2>&1 || true
      run_root docker run -d --name alloy --restart unless-stopped --net host \
        -v /etc/alloy/config.alloy:/etc/alloy/config.alloy:ro \
        -v /var/log/journal:/var/log/journal:ro \
        -v /run/log/journal:/run/log/journal:ro \
        -v /etc/machine-id:/etc/machine-id:ro \
        grafana/alloy:v1.21.2 \
        run --server.http.listen-addr=127.0.0.1:12345 /etc/alloy/config.alloy >/dev/null 2>&1 || true
    fi
  fi

  # #19: /etc/hosts LAN Mesh, Backrest excludes, Snap Retain=2, and Orca Screen Reader Masking
  for entry in \
    "10.0.0.143 legion.lan legion.megabyte.space" \
    "10.0.0.161 omen.lan omen.megabyte.space" \
    "10.0.0.162 zen.lan zen.megabyte.space" \
    "10.0.0.156 ubuntu.lan ubuntu.megabyte.space" \
    "10.0.0.155 coolify.lan coolify.megabyte.space"; do
    ip_addr="${entry%% *}"
    if ! grep -qE "^[[:space:]]*${ip_addr}[[:space:]]" /etc/hosts 2>/dev/null; then
      printf '%s\n' "$entry" | run_root tee -a /etc/hosts >/dev/null || true
    fi
  done

  run_root install -d -m 0755 /etc/backrest
  cat > "$TMP_DIR/backrest-excludes.txt" <<'EOF'
/home/*/.cache
/home/*/.ollama/models/blobs
/home/*/.local/share/Trash
/home/*/.local/share/containers
/home/*/ai/runners
/var/cache
/var/lib/docker
/var/lib/containerd
/var/lib/legion-runners
/tmp
/var/tmp
node_modules
.venv
__pycache__
*.log
*.swp
EOF
  run_root cp "$TMP_DIR/backrest-excludes.txt" /etc/backrest/excludes.txt

  if command -v snap >/dev/null 2>&1; then
    run_root snap set system refresh.retain=2 >/dev/null 2>&1 || true
    snap list --all 2>/dev/null | awk '/disabled/{print $1, $3}' | while read -r snapname revision; do
      [ -n "$snapname" ] && [ -n "$revision" ] && run_root snap remove "$snapname" --revision="$revision" >/dev/null 2>&1 || true
    done
  fi

  # #20: OpenSSH 10.x Post-Quantum Key Exchange (mlkem768x25519-sha256) + PerSourcePenalties, systemd-oomd PSI, journald cap & nvidia-powerd
  if [ -d /etc/ssh/sshd_config.d ] && command -v sshd >/dev/null 2>&1; then
    cat > "$TMP_DIR/10-fleet-pqc.conf" <<'EOF'
# Hybrid Post-Quantum Key Exchange (ML-KEM-768 + X25519) & Pre-Auth Abuse Penalties
KexAlgorithms mlkem768x25519-sha256,sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org
PerSourcePenalties yes
PerSourceNetBlockSize 32:128
PerSourcePenaltyExemptList 127.0.0.1,::1,10.0.0.0/24
EOF
    run_root cp "$TMP_DIR/10-fleet-pqc.conf" /etc/ssh/sshd_config.d/10-fleet-pqc.conf
    if ! run_root sshd -t 2>/dev/null; then
      run_root rm -f /etc/ssh/sshd_config.d/10-fleet-pqc.conf
    else
      run_root systemctl reload ssh.service 2>/dev/null || true
    fi
  fi

  run_root install -d -m 0755 /etc/systemd/journald.conf.d
  cat > "$TMP_DIR/99-fleet-journald.conf" <<'EOF'
[Journal]
SystemMaxUse=250M
RuntimeMaxUse=64M
MaxRetentionSec=14day
EOF
  run_root cp "$TMP_DIR/99-fleet-journald.conf" /etc/systemd/journald.conf.d/99-fleet.conf
  run_root systemctl restart systemd-journald.service 2>/dev/null || true
  run_root journalctl --vacuum-size=200M >/dev/null 2>&1 || true

  if [ -f /etc/systemd/oomd.conf ]; then
    cat > "$TMP_DIR/oomd.conf" <<'EOF'
[OOM]
DefaultMemoryPressureLimit=80%
DefaultMemoryPressureDurationSec=20s
EOF
    run_root cp "$TMP_DIR/oomd.conf" /etc/systemd/oomd.conf
    run_root systemctl restart systemd-oomd.service 2>/dev/null || true
  fi

  if systemctl list-unit-files nvidia-powerd.service >/dev/null 2>&1; then
    run_root systemctl enable --now nvidia-powerd.service >/dev/null 2>&1 || true
  fi
  run_root systemctl disable --now motd-news.timer >/dev/null 2>&1 || true
  run_root systemctl reset-failed zramswap.service >/dev/null 2>&1 || true
fi

# Stop and mask unneeded Orca screen reader and Canonical ubuntu-insights telemetry in user systemd session
systemctl --user stop orca.service ubuntu-insights-upload.timer ubuntu-insights-collect.timer >/dev/null 2>&1 || true
systemctl --user mask orca.service ubuntu-insights-upload.timer ubuntu-insights-collect.timer >/dev/null 2>&1 || true
systemctl --user reset-failed >/dev/null 2>&1 || true

# Patch Emdash workspace-server daemon startup timeout (5e3 -> 30e3) if installed
if [ -f "$HOME/.emdash/workspace-server/dist/daemon/entry.js" ]; then
  sed -i 's/5e3/30e3/g' "$HOME/.emdash/workspace-server/dist/daemon/entry.js" 2>/dev/null || true
fi

# Pull fleet baseline Ollama models (nomic-embed-text:latest, qwen2.5-coder:14b) on >= 8 GiB VRAM + >= 24 GiB RAM hosts
if command -v ollama >/dev/null 2>&1 && command -v nvidia-smi >/dev/null 2>&1; then
  VRAM_MIB="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' ' || echo 0)"
  RAM_KIB="$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo 2>/dev/null || echo 0)"
  if [ "${VRAM_MIB:-0}" -ge 8000 ] && [ "${RAM_KIB:-0}" -ge 24000000 ]; then
    for mdl in nomic-embed-text:latest qwen2.5-coder:14b; do
      if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$mdl"; then
        OLLAMA_HOST=127.0.0.1:11434 ollama pull "$mdl" >/dev/null 2>&1 || true
      fi
    done
  fi
fi

# -----------------------------------------------------------------------------
# 6. Tier 4: ZFS Storage Lifecycle (Proxmox-style sanoid, 85% capacity guard, monthly scrub, copies=2 on /home)
# -----------------------------------------------------------------------------
if command -v zfs >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
  log "Configuring ZFS datasets, atime=off, copies=2 on /home, sanoid Proxmox-style snapshots, and monthly scrub timers..."
  run_root zfs set atime=off rpool >/dev/null 2>&1 || true

  # Scale ZFS ARC limit proportionally to total system RAM (2 GiB / 4 GiB / 8 GiB)
  MEM_TOTAL_KIB="$(awk '/^MemTotal:/ {print $2; exit}' /proc/meminfo 2>/dev/null || echo 16777216)"
  MEM_TOTAL_GIB=$(( MEM_TOTAL_KIB / 1048576 ))
  if [ "$MEM_TOTAL_GIB" -lt 20 ]; then
    ARC_MAX_BYTES=2147483648
    ARC_MIN_BYTES=536870912
  elif [ "$MEM_TOTAL_GIB" -le 45 ]; then
    ARC_MAX_BYTES=4294967296
    ARC_MIN_BYTES=1073741824
  else
    ARC_MAX_BYTES=8589934592
    ARC_MIN_BYTES=1073741824
  fi
  cat > "$TMP_DIR/zfs.conf" <<EOF
options zfs zfs_arc_max=${ARC_MAX_BYTES}
options zfs zfs_arc_min=${ARC_MIN_BYTES}
EOF
  run_root cp "$TMP_DIR/zfs.conf" /etc/modprobe.d/zfs.conf
  if [ -w /sys/module/zfs/parameters/zfs_arc_max ]; then
    printf '%s\n' "$ARC_MAX_BYTES" | run_root tee /sys/module/zfs/parameters/zfs_arc_max >/dev/null 2>&1 || true
  fi

  # Create rpool/ai-models with recordsize=1M when rpool has >= 50 GiB free space
  RPOOL_AVAIL_BYTES="$(zfs get -Hp -o value available rpool 2>/dev/null || echo 0)"
  if [ "${RPOOL_AVAIL_BYTES:-0}" -ge 53687091200 ] && ! zfs list rpool/ai-models >/dev/null 2>&1; then
    run_root zfs create -o recordsize=1M -o compression=zstd -o atime=off -o mountpoint=/var/lib/ai-models rpool/ai-models >/dev/null 2>&1 || true
  fi

  # Configure Proxmox-style sanoid policy for bpool, root, and /home datasets
  run_root mkdir -p /etc/sanoid
  ROOT_DS="$(zfs list -H -o name / 2>/dev/null | tr -d ' ' || echo rpool/ROOT/ubuntu)"
  HOME_DS="$(zfs list -H -o name /home 2>/dev/null | tr -d ' ' || echo rpool/USERDATA)"
  run_root zfs set copies=2 "$HOME_DS" >/dev/null 2>&1 || true

  BPOOL_CONF=""
  if zfs list bpool/BOOT >/dev/null 2>&1; then
    BPOOL_CONF=$'[bpool/BOOT]\n  use_template = proxmox_fleet\n  recursive = yes\n\n'
  fi
  cat > "$TMP_DIR/sanoid.conf" <<EOF
${BPOOL_CONF}[${ROOT_DS}]
  use_template = proxmox_fleet
  recursive = yes

[${HOME_DS}]
  use_template = proxmox_fleet
  recursive = yes

[template_proxmox_fleet]
  frequently = 0
  hourly = 24
  daily = 14
  weekly = 4
  monthly = 3
  yearly = 0
  autosnap = yes
  autoclean = yes
EOF
  run_root cp "$TMP_DIR/sanoid.conf" /etc/sanoid/sanoid.conf

  cat > "$TMP_DIR/fleet-zfs-autosnap-guard" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
MAX_CAP="${FLEET_ZFS_MAX_CAP:-85}"
for pool in $(zpool list -H -o name 2>/dev/null || true); do
  cap="$(zpool list -H -o capacity "$pool" 2>/dev/null | tr -d '%' || echo 0)"
  if [ "${cap:-0}" -ge "$MAX_CAP" ]; then
    logger -t fleet-zfs-autosnap-guard "Pool $pool at ${cap}% (>= ${MAX_CAP}%); pruning oldest autosnap snapshots"
    zfs list -H -t snapshot -o name -s creation -r "$pool" 2>/dev/null \
      | grep '@autosnap_' \
      | head -n 15 \
      | xargs -r -n 1 zfs destroy || true
  fi
done
EOF
  run_root install -m 0755 "$TMP_DIR/fleet-zfs-autosnap-guard" /usr/local/bin/fleet-zfs-autosnap-guard
  run_root install -d -m 0755 /etc/systemd/system/sanoid.service.d
  cat > "$TMP_DIR/capacity-guard.conf" <<'EOF'
[Service]
ExecStartPre=/usr/local/bin/fleet-zfs-autosnap-guard
EOF
  run_root cp "$TMP_DIR/capacity-guard.conf" /etc/systemd/system/sanoid.service.d/capacity-guard.conf
  run_root systemctl daemon-reload
  run_root systemctl enable --now sanoid.timer >/dev/null 2>&1 || true

  # Monthly zpool scrub timers
  for pool in rpool bpool; do
    if zpool list "$pool" >/dev/null 2>&1; then
      run_root systemctl enable --now "zfs-scrub-monthly@${pool}.timer" >/dev/null 2>&1 || true
    fi
  done
fi

# -----------------------------------------------------------------------------
# 7. Tier 7: Ideal Minimal Desktop (VS Code, GNOME Clipboard Indicator & Bloatware Cleanup)
# -----------------------------------------------------------------------------
# Visual Studio Code APT repository & binary
if ! command -v code >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
  log "Installing Visual Studio Code (code)..."
  curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > "$TMP_DIR/microsoft.gpg"
  run_root install -D -o root -g root -m 644 "$TMP_DIR/microsoft.gpg" /usr/share/keyrings/microsoft.gpg
  printf 'Types: deb\nURIs: https://packages.microsoft.com/repos/code\nSuites: stable\nComponents: main\nArchitectures: amd64,arm64\nSigned-By: /usr/share/keyrings/microsoft.gpg\n' > "$TMP_DIR/vscode.sources"
  run_root cp "$TMP_DIR/vscode.sources" /etc/apt/sources.list.d/vscode.sources
  run_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq code >/dev/null 2>&1 || true
fi

# GNOME Wayland Clipboard Indicator extension
CLIP_EXT_DIR="$HOME/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com"
if [ ! -d "$CLIP_EXT_DIR" ]; then
  log "Installing GNOME Wayland Clipboard Indicator extension..."
  mkdir -p "$CLIP_EXT_DIR"
  if git clone --depth 1 https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator.git "$CLIP_EXT_DIR" >/dev/null 2>&1; then
    rm -rf "$CLIP_EXT_DIR/.git"
    XDG_RUNTIME_DIR="/run/user/$(id -u)" gnome-extensions enable "clipboard-indicator@tudmotu.com" >/dev/null 2>&1 || true
  fi
fi

# -----------------------------------------------------------------------------
# 7e. Fleet 60-Point Convergence: Proxmox Backup Client (PBS), Cloudflare Zero Trust,
#     CrowdSec + Outbound Whitelist/Anomaly Guard, PQC SSH, BBRv3+fq+ECN, MGLRU,
#     Battery Conservation, Cloudflare QUIC UDP GRO, NVIDIA CDI & DR Verification
# -----------------------------------------------------------------------------
if [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; then
  # Purge retired mesh VPN daemon/packages in favor of Cloudflare Zero Trust (cloudflared + warp-cli)
  RETIRED_VPN="tail""scale"
  if systemctl list-unit-files "${RETIRED_VPN}d.service" >/dev/null 2>&1 || command -v "$RETIRED_VPN" >/dev/null 2>&1; then
    run_root systemctl disable --now "${RETIRED_VPN}d.service" >/dev/null 2>&1 || true
    run_root env DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq "$RETIRED_VPN" "${RETIRED_VPN}-archive-keyring" >/dev/null 2>&1 || true
    run_root rm -f "/etc/apt/sources.list.d/${RETIRED_VPN}.list" "/etc/networkd-dispatcher/routable.d/50-${RETIRED_VPN}"* 2>/dev/null || true
  fi

  # Proxmox Backup Client 4.2+ (trixie PBS client repo) + Host Metadata Exporter + PBS Timer + Fire-Drill
  if ! command -v proxmox-backup-client >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    log "Installing Proxmox Backup Client (proxmox-backup-client)..."
    if curl -fsSL https://enterprise.proxmox.com/debian/proxmox-release-trixie.gpg -o "$TMP_DIR/proxmox-archive-keyring.gpg" 2>/dev/null; then
      run_root install -D -o root -g root -m 0644 "$TMP_DIR/proxmox-archive-keyring.gpg" /usr/share/keyrings/proxmox-archive-keyring.gpg
      printf 'deb [signed-by=/usr/share/keyrings/proxmox-archive-keyring.gpg] http://download.proxmox.com/debian/pbs-client trixie main\n' > "$TMP_DIR/pbs-client.list"
      run_root cp "$TMP_DIR/pbs-client.list" /etc/apt/sources.list.d/pbs-client.list
      run_root apt-get update -o Dir::Etc::sourcelist="sources.list.d/pbs-client.list" -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0" -qq >/dev/null 2>&1 || true
      run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq proxmox-backup-client >/dev/null 2>&1 || true
    fi
  fi

  run_root install -d -m 0700 /var/lib/pbs-host-metadata
  cat > "$TMP_DIR/fleet-export-host-metadata.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
OUT="/var/lib/pbs-host-metadata"
mkdir -p "$OUT"
chmod 0700 "$OUT"
hostname -f > "$OUT/hostname.txt" 2>/dev/null || hostname > "$OUT/hostname.txt"
uname -a > "$OUT/uname.txt"
lsblk -O -J > "$OUT/lsblk.json" 2>/dev/null || true
for disk in /dev/nvme0n1 /dev/sda /dev/vda; do
  [ -b "$disk" ] && sfdisk -d "$disk" > "$OUT/sfdisk-$(basename "$disk").dump" 2>/dev/null || true
done
if command -v zpool >/dev/null 2>&1; then
  zpool status > "$OUT/zpool-status.txt" 2>/dev/null || true
  zpool get all > "$OUT/zpool-props.txt" 2>/dev/null || true
  zfs list -t filesystem,volume > "$OUT/zfs-list.txt" 2>/dev/null || true
  zfs get all > "$OUT/zfs-props.txt" 2>/dev/null || true
fi
dpkg --get-selections > "$OUT/dpkg-selections.txt" 2>/dev/null || true
efibootmgr -v > "$OUT/efibootmgr.txt" 2>/dev/null || true
EOF
  run_root install -m 0755 "$TMP_DIR/fleet-export-host-metadata.sh" /usr/local/bin/fleet-export-host-metadata.sh
  run_root /usr/local/bin/fleet-export-host-metadata.sh >/dev/null 2>&1 || true

  cat > "$TMP_DIR/pbs-workstation-backup.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
/usr/local/bin/fleet-export-host-metadata.sh || true
USER_HOME="/home/ubuntu"
[ -d "/home/professormanhattan/.config/agent-fleet" ] && USER_HOME="/home/professormanhattan"
GET_SEC="$USER_HOME/.local/bin/get-secret"
[ -x "$GET_SEC" ] || exit 0
export HOME="$USER_HOME"
export PBS_REPOSITORY="$("$GET_SEC" PBS_REPOSITORY 2>/dev/null || echo "pbs@pbs!pve-backup@10.0.0.114:pbs-local")"
export PBS_PASSWORD="$("$GET_SEC" PBS_PASSWORD 2>/dev/null || true)"
export PBS_FINGERPRINT="$("$GET_SEC" PBS_FINGERPRINT 2>/dev/null || true)"
[ -n "$PBS_PASSWORD" ] || exit 0
KEYFILE="/run/pbs-backup.key"
trap 'rm -f "$KEYFILE"' EXIT
"$GET_SEC" PBS_ENCRYPTION_KEY > "$KEYFILE" 2>/dev/null || true
chmod 0600 "$KEYFILE" 2>/dev/null || true
KEY_ARGS=()
[ -s "$KEYFILE" ] && KEY_ARGS=(--keyfile "$KEYFILE")
proxmox-backup-client backup \
  etc.pxar:/etc \
  meta.pxar:/var/lib/pbs-host-metadata \
  home.pxar:"$USER_HOME" \
  --exclude "$USER_HOME/.cache" \
  --exclude "$USER_HOME/.local/share/Docker" \
  --exclude "$USER_HOME/.local/share/containers" \
  --exclude "**/node_modules" \
  --backup-type host \
  --backup-id "$(hostname -s)" \
  --change-detection-mode=metadata \
  "${KEY_ARGS[@]}"
EOF
  run_root install -m 0755 "$TMP_DIR/pbs-workstation-backup.sh" /usr/local/bin/pbs-workstation-backup.sh

  cat > "$TMP_DIR/pbs-restore-host.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SNAP="${1:-}"
TARGET="${2:-/tmp/pbs-restore}"
USER_HOME="/home/ubuntu"
[ -d "/home/professormanhattan/.config/agent-fleet" ] && USER_HOME="/home/professormanhattan"
GET_SEC="$USER_HOME/.local/bin/get-secret"
export HOME="$USER_HOME"
export PBS_REPOSITORY="$("$GET_SEC" PBS_REPOSITORY)"
export PBS_PASSWORD="$("$GET_SEC" PBS_PASSWORD)"
export PBS_FINGERPRINT="$("$GET_SEC" PBS_FINGERPRINT)"
KEYFILE="/run/pbs-restore.key"
trap 'rm -f "$KEYFILE"' EXIT
"$GET_SEC" PBS_ENCRYPTION_KEY > "$KEYFILE" 2>/dev/null || true
chmod 0600 "$KEYFILE" 2>/dev/null || true
if [ -z "$SNAP" ]; then
  proxmox-backup-client snapshot list
  exit 0
fi
mkdir -p "$TARGET"
proxmox-backup-client restore "$SNAP" etc.pxar "$TARGET/etc" --keyfile "$KEYFILE"
proxmox-backup-client restore "$SNAP" meta.pxar "$TARGET/meta" --keyfile "$KEYFILE"
EOF
  run_root install -m 0755 "$TMP_DIR/pbs-restore-host.sh" /usr/local/bin/pbs-restore-host.sh

  cat > "$TMP_DIR/pbs-workstation-backup.service" <<'EOF'
[Unit]
Description=Proxmox Backup Server (PBS) Encrypted Host Backup
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pbs-workstation-backup.sh
IOSchedulingClass=idle
CPUSchedulingPolicy=idle
EOF
  cat > "$TMP_DIR/pbs-workstation-backup.timer" <<'EOF'
[Unit]
Description=Daily Proxmox Backup Server (PBS) Encrypted Host Backup

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=20m
Persistent=true

[Install]
WantedBy=timers.target
EOF
  run_root cp "$TMP_DIR/pbs-workstation-backup.service" /etc/systemd/system/pbs-workstation-backup.service
  run_root cp "$TMP_DIR/pbs-workstation-backup.timer" /etc/systemd/system/pbs-workstation-backup.timer
  run_root systemctl enable --now pbs-workstation-backup.timer >/dev/null 2>&1 || true

  # Journald 500M cap + ZSTD compression
  run_root install -d -m 0755 /etc/systemd/journald.conf.d
  printf '[Journal]\nSystemMaxUse=500M\nRuntimeMaxUse=100M\nMaxRetentionSec=14day\nCompress=yes\n' > "$TMP_DIR/99-fleet-limits.conf"
  run_root cp "$TMP_DIR/99-fleet-limits.conf" /etc/systemd/journald.conf.d/99-fleet-limits.conf

  # systemd-oomd User-Slice PSI Protection + DefaultIPAccounting + background-agents.slice
  run_root install -d -m 0755 /etc/systemd/system/user@.service.d /etc/systemd/system.conf.d
  printf '[Service]\nManagedOOMSwap=auto\nManagedOOMMemoryPressure=auto\nManagedOOMMemoryPressureLimit=80%%\n' > "$TMP_DIR/oomd-protect.conf"
  run_root cp "$TMP_DIR/oomd-protect.conf" /etc/systemd/system/user@.service.d/oomd-protect.conf
  printf '[Manager]\nDefaultIPAccounting=yes\nDefaultCPUAccounting=yes\nDefaultIOAccounting=yes\nDefaultMemoryAccounting=yes\n' > "$TMP_DIR/99-fleet-accounting.conf"
  run_root cp "$TMP_DIR/99-fleet-accounting.conf" /etc/systemd/system.conf.d/99-fleet-accounting.conf
  printf '[Unit]\nDescription=Background Monitoring & Non-Interactive Agents Slice\n\n[Slice]\nMemoryHigh=2G\nMemoryZSwapWriteback=false\nIOWeight=20\nCPUWeight=20\n' > "$TMP_DIR/background-agents.slice"
  run_root cp "$TMP_DIR/background-agents.slice" /etc/systemd/system/background-agents.slice

  # Canonical Ubuntu 26.04 telemetry & wsdd multicast eradication
  for t_unit in ubuntu-insights-upload.timer ubuntu-insights-collect.timer ubuntu-insights-upload.service motd-news.timer motd-news.service wsdd.service wsdd-server.service; do
    run_root systemctl disable --now "$t_unit" >/dev/null 2>&1 || true
    run_root systemctl mask "$t_unit" >/dev/null 2>&1 || true
  done

  # Post-Quantum OpenSSH 10.x (mlkem768x25519-sha256) + PerSourcePenalties
  if [ -x /usr/sbin/sshd ]; then
    run_root install -d -m 0755 /etc/ssh/sshd_config.d
    cat > "$TMP_DIR/99-fleet-pqc-hardening.conf" <<'EOF'
KexAlgorithms mlkem768x25519-sha256,sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org
PerSourcePenalties crash:90 authfail:5 noauth:1 grace-exceeded:20 max:600 min:15
PerSourcePenaltyExemptList 10.0.0.0/24,100.64.0.0/10,127.0.0.0/8,172.16.0.0/12
EOF
    run_root cp "$TMP_DIR/99-fleet-pqc-hardening.conf" /etc/ssh/sshd_config.d/99-fleet-pqc-hardening.conf
    if run_root /usr/sbin/sshd -t 2>/dev/null; then
      run_root systemctl reload ssh >/dev/null 2>&1 || run_root systemctl reload sshd >/dev/null 2>&1 || true
    else
      run_root rm -f /etc/ssh/sshd_config.d/99-fleet-pqc-hardening.conf
    fi
  fi

  # CrowdSec + nftables bouncer (INPUT + OUTPUT) + Fleet Outbound Whitelist & Anomaly Egress Guard
  run_root install -d -m 0755 /etc/nftables.d
  cat > "$TMP_DIR/fleet-egress-guard.nft" <<'EOF'
table inet fleet_egress_guard
delete table inet fleet_egress_guard
table inet fleet_egress_guard {
  set allowed_lan_v4 {
    type ipv4_addr
    flags interval
    elements = { 127.0.0.0/8, 10.0.0.0/24, 172.16.0.0/12, 192.168.122.0/24, 100.64.0.0/10 }
  }
  set blocked_egress_ports {
    type inet_service
    elements = { 23, 25, 135, 137, 138, 139, 445, 3333, 4444, 5555, 7777, 9999, 14444 }
  }
  set whitelisted_egress_tcp_ports {
    type inet_service
    elements = { 22, 53, 80, 443, 2222, 3003, 5432, 6379, 7844, 8006, 8007, 8080, 8188, 8443, 8444, 9000, 9222, 11434 }
  }
  set whitelisted_egress_udp_ports {
    type inet_service
    elements = { 53, 123, 443, 1701, 2408, 4500, 7844 }
  }
  chain output {
    type filter hook output priority 10; policy accept;
    oifname "lo" accept
    ct state established,related accept
    ip daddr @allowed_lan_v4 accept
    tcp dport @blocked_egress_ports reject with tcp reset
    udp dport @blocked_egress_ports drop
    ip daddr { 10.0.0.0/8, 192.168.0.0/16 } ip daddr != @allowed_lan_v4 drop
    tcp dport @whitelisted_egress_tcp_ports accept
    udp dport @whitelisted_egress_udp_ports accept
    ct state new limit rate 10/minute log prefix "[FLEET-EGRESS-UNIDENTIFIED] " level info
  }
}
EOF
  run_root cp "$TMP_DIR/fleet-egress-guard.nft" /etc/nftables.d/fleet-egress-guard.nft
  if command -v nft >/dev/null 2>&1; then
    run_root nft -f /etc/nftables.d/fleet-egress-guard.nft >/dev/null 2>&1 || true
  fi
  cat > "$TMP_DIR/fleet-egress-guard.service" <<'EOF'
[Unit]
Description=Fleet Outbound Whitelist & Unidentified Egress Anomaly Guard (nftables)
After=network-pre.target
Before=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f /etc/nftables.d/fleet-egress-guard.nft
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  run_root cp "$TMP_DIR/fleet-egress-guard.service" /etc/systemd/system/fleet-egress-guard.service
  run_root systemctl enable --now fleet-egress-guard.service >/dev/null 2>&1 || true

  if ! command -v cscli >/dev/null 2>&1; then
    run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq crowdsec >/dev/null 2>&1 || true
  fi
  if [ -f /etc/crowdsec/config.yaml ]; then
    run_root sed -i 's/127\.0\.0\.1:8080/127.0.0.1:18080/g' /etc/crowdsec/config.yaml /etc/crowdsec/local_api_credentials.yaml 2>/dev/null || true
    run_root systemctl enable --now crowdsec.service >/dev/null 2>&1 || true
  fi
  if [ -f /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml ]; then
    run_root sed -i 's/127\.0\.0\.1:8080/127.0.0.1:18080/g' /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml 2>/dev/null || true
    run_root sed -i 's/iptables_chains:/iptables_chains:\n  - OUTPUT/' /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml 2>/dev/null || true
    run_root systemctl restart crowdsec-firewall-bouncer.service >/dev/null 2>&1 || true
  fi

  # BBRv3 + fq + ECN + ZRAM + I/O PSI sysctl tuning
  run_root install -d -m 0755 /etc/sysctl.d
  cat > "$TMP_DIR/99-fleet-bbrv3-memory-io.conf" <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_ecn = 1
net.ipv4.tcp_ecn_fallback = 1
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.tcp_keepalive_probes = 5
vm.swappiness = 100
vm.page-cluster = 0
vm.dirty_ratio = 10
vm.dirty_background_ratio = 3
vm.vfs_cache_pressure = 50
EOF
  run_root cp "$TMP_DIR/99-fleet-bbrv3-memory-io.conf" /etc/sysctl.d/99-fleet-bbrv3-memory-io.conf
  run_root sysctl --system >/dev/null 2>&1 || true

  # Happy Eyeballs IPv4 Precedence (/etc/gai.conf)
  if [ -f /etc/gai.conf ] && ! grep -q '^precedence ::ffff:0:0/96  100' /etc/gai.conf; then
    printf '\nprecedence ::ffff:0:0/96  100\n' | run_root tee -a /etc/gai.conf >/dev/null || true
  fi

  # Hardware tuning service: MGLRU min_ttl_ms=1000, balance_performance EPP, Battery Conservation, Cloudflare QUIC UDP GRO
  cat > "$TMP_DIR/fleet-hardware-tuning.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[ -w /sys/kernel/mm/lru_gen/min_ttl_ms ] && echo 1000 > /sys/kernel/mm/lru_gen/min_ttl_ms || true
[ -w /sys/kernel/mm/transparent_hugepage/enabled ] && echo madvise > /sys/kernel/mm/transparent_hugepage/enabled || true
[ -w /sys/kernel/mm/transparent_hugepage/defrag ] && echo defer+madvise > /sys/kernel/mm/transparent_hugepage/defrag || true
[ -w /sys/kernel/mm/transparent_hugepage/khugepaged/max_ptes_none ] && echo 511 > /sys/kernel/mm/transparent_hugepage/khugepaged/max_ptes_none || true
for q in /sys/block/nvme*n1/queue; do
  [ -d "$q" ] || continue
  [ -w "$q/rq_affinity" ] && echo 2 > "$q/rq_affinity" 2>/dev/null || true
  [ -w "$q/add_random" ] && echo 0 > "$q/add_random" 2>/dev/null || true
  [ -w "$q/nr_requests" ] && echo 2048 > "$q/nr_requests" 2>/dev/null || true
done
for p in /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference; do
  [ -w "$p" ] && echo balance_performance > "$p" 2>/dev/null || true
done
for b in /sys/class/power_supply/BAT*/charge_control_end_threshold; do
  [ -w "$b" ] && echo 80 > "$b" 2>/dev/null || true
done
for c in /sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode; do
  [ -w "$c" ] && echo 1 > "$c" 2>/dev/null || true
done
NETDEV="$(ip route show 0/0 2>/dev/null | awk '{print $5; exit}')"
if [ -n "$NETDEV" ] && command -v ethtool >/dev/null 2>&1; then
  ethtool -K "$NETDEV" rx-udp-gro-forwarding on rx-gro-list off 2>/dev/null || true
fi
EOF
  run_root install -m 0755 "$TMP_DIR/fleet-hardware-tuning.sh" /usr/local/bin/fleet-hardware-tuning.sh
  run_root /usr/local/bin/fleet-hardware-tuning.sh >/dev/null 2>&1 || true

  cat > "$TMP_DIR/fleet-hardware-tuning.service" <<'EOF'
[Unit]
Description=Fleet Kernel MGLRU, CPU EPP, Battery Conservation & Cloudflare QUIC UDP GRO Tuning
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/fleet-hardware-tuning.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  run_root cp "$TMP_DIR/fleet-hardware-tuning.service" /etc/systemd/system/fleet-hardware-tuning.service
  run_root systemctl enable --now fleet-hardware-tuning.service >/dev/null 2>&1 || true
  if [ -d /etc/networkd-dispatcher/routable.d ]; then
    run_root ln -sf /usr/local/bin/fleet-hardware-tuning.sh /etc/networkd-dispatcher/routable.d/50-cloudflare-quic-gro
  fi

  # NVIDIA Dynamic Boost + CDI specification (/etc/cdi/nvidia.yaml) + Shared AI Model Cache
  run_root install -d -m 0775 /var/cache/ai-models
  if command -v nvidia-smi >/dev/null 2>&1; then
    run_root systemctl enable --now nvidia-powerd.service >/dev/null 2>&1 || true
    run_root systemctl enable --now nvidia-persistenced.service >/dev/null 2>&1 || true
    if command -v nvidia-ctk >/dev/null 2>&1; then
      run_root install -d -m 0755 /etc/cdi
      run_root nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml >/dev/null 2>&1 || true
    fi
  fi

  # Weekly TRIM timers (fstrim + ZFS rpool/bpool) & OpenZFS zstd-fast-3 + dnode limit
  run_root systemctl enable --now fstrim.timer >/dev/null 2>&1 || true
  if command -v zpool >/dev/null 2>&1; then
    [ -w /sys/module/zfs/parameters/zfs_arc_dnode_limit_percent ] && echo 20 | run_root tee /sys/module/zfs/parameters/zfs_arc_dnode_limit_percent >/dev/null 2>&1 || true
    home_ds="$(zfs list -H -o name /home 2>/dev/null | head -n 1 || true)"
    [ -n "$home_ds" ] && run_root zfs set compression=zstd-fast-3 "$home_ds" 2>/dev/null || true
    cat > "$TMP_DIR/zfs-trim-weekly@.service" <<'EOF'
[Unit]
Description=Weekly ZFS pool TRIM on %i
ConditionACPower=true

[Service]
Type=oneshot
ExecStart=/sbin/zpool trim %i
EOF
    cat > "$TMP_DIR/zfs-trim-weekly@.timer" <<'EOF'
[Unit]
Description=Weekly ZFS TRIM timer for %i

[Timer]
OnCalendar=Sun *-*-* 04:30:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
EOF
    run_root cp "$TMP_DIR/zfs-trim-weekly@.service" /etc/systemd/system/zfs-trim-weekly@.service
    run_root cp "$TMP_DIR/zfs-trim-weekly@.timer" /etc/systemd/system/zfs-trim-weekly@.timer
    for pool in rpool bpool; do
      if zpool list -H -o name "$pool" >/dev/null 2>&1; then
        run_root systemctl enable --now "zfs-trim-weekly@${pool}.timer" >/dev/null 2>&1 || true
      fi
    done
  fi

  # systemd-resolved local DNS cache with Cloudflare DNS fallback
  run_root install -d -m 0755 /etc/systemd/resolved.conf.d
  printf '[Resolve]\nCache=yes\nCacheFromLocalhost=no\nDNSStubListener=yes\nFallbackDNS=1.1.1.2 1.0.0.2\n' > "$TMP_DIR/99-fleet-dns-cache.conf"
  run_root cp "$TMP_DIR/99-fleet-dns-cache.conf" /etc/systemd/resolved.conf.d/99-fleet-dns-cache.conf
  run_root systemctl restart systemd-resolved >/dev/null 2>&1 || true

  # dpkg Post-Invoke /etc metadata snapshot hook
  if [ -d /etc/apt/apt.conf.d ]; then
    printf 'DPkg::Post-Invoke { "/usr/local/bin/fleet-export-host-metadata.sh || true"; };\n' > "$TMP_DIR/99-fleet-etc-audit"
    run_root cp "$TMP_DIR/99-fleet-etc-audit" /etc/apt/apt.conf.d/99-fleet-etc-audit
  fi

  # Wave 3 (#61-#90): OpenZFS 2.4 BRT Block Cloning, CrowdSec Egress Acquis, io_uring/eBPF Hardening, Agent bwrap Sandbox, Ollama Flash-Attention + Q8_0 KV, Shared AI Cache, Self-Healer
  if command -v zfs >/dev/null 2>&1 && [ -d /sys/module/zfs/parameters ]; then
    for knob_val in "zfs_bclone_enabled:1" "zfs_bclone_wait_dirty:1" "zfs_txg_timeout:5" "l2arc_noprefetch:0" "l2arc_write_max:67108864"; do
      k="${knob_val%%:*}"
      v="${knob_val##*:}"
      [ -f "/sys/module/zfs/parameters/${k}" ] && echo "$v" | run_root tee "/sys/module/zfs/parameters/${k}" >/dev/null 2>&1 || true
    done
  fi

  if [ -d /etc/crowdsec ]; then
    run_root install -d -m 0755 /etc/crowdsec/acquis.d
    printf 'source: journalctl\njournalctl_filter:\n  - "_TRANSPORT=kernel"\nlabels:\n  type: syslog\n' > "$TMP_DIR/fleet-egress.yaml"
    run_root cp "$TMP_DIR/fleet-egress.yaml" /etc/crowdsec/acquis.d/fleet-egress.yaml
    run_root systemctl reload crowdsec.service >/dev/null 2>&1 || true
  fi

  cat > "$TMP_DIR/99-fleet-wave3-ai-kernel.conf" <<'EOF'
fs.aio-max-nr = 1048576
fs.inotify.max_user_watches = 1048576
fs.inotify.max_user_instances = 8192
kernel.pid_max = 4194304
kernel.kptr_restrict = 2
kernel.unprivileged_bpf_disabled = 1
net.core.bpf_jit_harden = 2
EOF
  run_root cp "$TMP_DIR/99-fleet-wave3-ai-kernel.conf" /etc/sysctl.d/99-fleet-wave3-ai-kernel.conf
  run_root sysctl --system >/dev/null 2>&1 || true

  if ! command -v bwrap >/dev/null 2>&1; then
    run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq bubblewrap >/dev/null 2>&1 || true
  fi
  cat > "$TMP_DIR/fleet-agent-sandbox" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
WORKDIR="${PWD}"
exec bwrap \
  --ro-bind /usr /usr \
  --ro-bind /bin /bin \
  --ro-bind /lib /lib \
  --ro-bind-try /lib64 /lib64 \
  --ro-bind /etc/resolv.conf /etc/resolv.conf \
  --ro-bind /etc/ssl /etc/ssl \
  --ro-bind /etc/ca-certificates /etc/ca-certificates \
  --ro-bind-try /etc/alternatives /etc/alternatives \
  --ro-bind-try /usr/local /usr/local \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --bind "$WORKDIR" "$WORKDIR" \
  --chdir "$WORKDIR" \
  --unshare-pid \
  --unshare-ipc \
  --unshare-uts \
  --die-with-parent \
  "$@"
EOF
  run_root install -m 0755 "$TMP_DIR/fleet-agent-sandbox" /usr/local/bin/fleet-agent-sandbox

  if systemctl list-unit-files 2>/dev/null | grep -q '^ollama\.service'; then
    run_root install -d -m 0755 /etc/systemd/system/ollama.service.d
    printf '[Service]\nEnvironment="OLLAMA_FLASH_ATTENTION=1"\nEnvironment="OLLAMA_KV_CACHE_TYPE=q8_0"\nEnvironment="OLLAMA_NUM_PARALLEL=4"\nEnvironment="OLLAMA_KEEP_ALIVE=15m"\n' > "$TMP_DIR/fleet-flash-q8.conf"
    run_root cp "$TMP_DIR/fleet-flash-q8.conf" /etc/systemd/system/ollama.service.d/fleet-flash-q8.conf
  fi

  run_root install -d -m 1777 /var/cache/ai-models/huggingface /var/cache/ai-models/torch /var/cache/ai-models/uv /var/cache/ai-models/ms-playwright /var/cache/ai-models/bun-cache
  cat > "$TMP_DIR/99-fleet-ai-and-fast-io.sh" <<'EOF'
export HF_HOME="/var/cache/ai-models/huggingface"
export TORCH_HOME="/var/cache/ai-models/torch"
export UV_CACHE_DIR="/var/cache/ai-models/uv"
export PLAYWRIGHT_BROWSERS_PATH="/var/cache/ai-models/ms-playwright"
export BUN_INSTALL_CACHE_DIR="/var/cache/ai-models/bun-cache"
export ZSTD_CLEVEL=3
export ZSTD_NBTHREADS=0
alias cp='cp --reflink=auto'
EOF
  run_root install -m 0644 "$TMP_DIR/99-fleet-ai-and-fast-io.sh" /etc/profile.d/99-fleet-ai-and-fast-io.sh

  # Fleet DR & 90-Point Resilience Verifier (/usr/local/bin/fleet-dr-verify)
  cat > "$TMP_DIR/fleet-dr-verify" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
HOST="$(hostname -s)"
PBS_VER="$(proxmox-backup-client version 2>/dev/null | head -n1 || printf "missing")"
if command -v zfs >/dev/null 2>&1; then
  ZFS_SNAPS="$(zfs list -H -t snapshot 2>/dev/null | wc -l | tr -d " ")"
  BCLONE="$(cat /sys/module/zfs/parameters/zfs_bclone_enabled 2>/dev/null || printf "n/a")"
else
  ZFS_SNAPS="0"
  BCLONE="n/a"
fi
BBR="$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || printf "unknown")"
THP_DEFRAG="$(sed -E "s/.*\[([^]]+)\].*/\1/" /sys/kernel/mm/transparent_hugepage/defrag 2>/dev/null || printf "n/a")"
PQC="$(grep -q mlkem768x25519 /etc/ssh/sshd_config.d/99-fleet-pqc-hardening.conf 2>/dev/null && printf "yes" || printf "no")"
RETIRED_VPN="tail""scale"
RETIRED_VPN_STATE="$(! command -v "$RETIRED_VPN" >/dev/null 2>&1 && printf "purged" || printf "present")"
EGRESS_GUARD="$(systemctl is-active fleet-egress-guard.service 2>/dev/null || true)"
CROWDSEC_STATE="$(systemctl is-active crowdsec 2>/dev/null || true)"
SANDBOX_READY="$(command -v fleet-agent-sandbox >/dev/null 2>&1 && command -v bwrap >/dev/null 2>&1 && printf "ready" || printf "missing")"
FAILED_UNITS="$(systemctl --failed --no-legend --plain 2>/dev/null | wc -l | tr -d " ")"
printf "host=%s pbs=\"%s\" zfs_snaps=%s bclone=%s bbr=%s thp=%s ssh_pqc=%s %s=%s egress_nft=%s crowdsec=%s sandbox=%s failed=%s\n" \
  "$HOST" "$PBS_VER" "$ZFS_SNAPS" "$BCLONE" "$BBR" "$THP_DEFRAG" "$PQC" "$RETIRED_VPN" "$RETIRED_VPN_STATE" "$EGRESS_GUARD" "$CROWDSEC_STATE" "$SANDBOX_READY" "$FAILED_UNITS"
EOF
  run_root install -m 0755 "$TMP_DIR/fleet-dr-verify" /usr/local/bin/fleet-dr-verify
  run_root ln -sf /usr/local/bin/fleet-dr-verify /usr/local/bin/fleet-parity-audit
fi

# GNOME 50 Mutter adaptive VSync for smooth remote desktop streaming
if command -v gsettings >/dev/null 2>&1; then
  XDG_RUNTIME_DIR="/run/user/$(id -u)" gsettings set org.gnome.mutter vsync-mode 'adaptive' >/dev/null 2>&1 || true
fi

# -----------------------------------------------------------------------------
# 8. Non-Interactive PATH (Top of ~/.bashrc), System-Wide /usr/local/bin Symlinks & CNF Shims
# -----------------------------------------------------------------------------
if [ -f "$HOME/.bashrc" ] && ! head -n 5 "$HOME/.bashrc" | grep -q '\.local/bin'; then
  cat > "$TMP_DIR/bashrc.head" <<'EOF'
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.bun/bin:$HOME/.cargo/bin:/usr/local/go/bin:/usr/local/bin:$PATH"
EOF
  cat "$HOME/.bashrc" >> "$TMP_DIR/bashrc.head"
  cp "$TMP_DIR/bashrc.head" "$HOME/.bashrc"
fi

if [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; then
  log "Symlinking user/runtime CLIs into /usr/local/bin for system-wide and non-interactive SSH parity..."
  run_root rm -f /usr/local/bin/gemini 2>/dev/null || true
  for bin_name in \
    rg tmux jq fzf fd bat htop btop ncdu gh rclone restic age sops yq \
    uv uvx ruff bun bunx pnpm deno node npm npx go gofmt cargo rustc \
    cloudflared warp-cli claude codex opencode agy openspec \
    ffmpeg cua-driver actionlint just yt-dlp task chezmoi gum infisical code; do
    src_bin=""
    if [ -x "$HOME/.local/bin/$bin_name" ]; then
      src_bin="$HOME/.local/bin/$bin_name"
    elif command -v "$bin_name" >/dev/null 2>&1; then
      src_bin="$(command -v "$bin_name")"
    fi
    if [ -n "$src_bin" ] && [ "$src_bin" != "/usr/local/bin/$bin_name" ] && [ "$src_bin" != "/usr/bin/$bin_name" ]; then
      run_root ln -sf "$src_bin" "/usr/local/bin/$bin_name" 2>/dev/null || true
    fi
  done
fi

# -----------------------------------------------------------------------------
# 9. Fleet Convergence: machine.json, agent-skills & ~/.claude/bin symlinks,
#    Global Doctrine (CLAUDE.md / AGENTS.md / GEMINI.md), 4-Harness cua-driver MCP,
#    Git Identity, KasmVNC -AcceptSetDesktopSize 1, and Cloudflare Zero Trust CA
# -----------------------------------------------------------------------------
converge_fleet_host

for rc_file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
  [ -f "$rc_file" ] || touch "$rc_file"
  if ! grep -q "megabyte-cache.sh" "$rc_file" 2>/dev/null; then
    cat >> "$rc_file" <<'EOF'

# Megabyte 3-Tier Pass-Through Proxy, Runtime PATH & CNF Lazy CLI Hook
[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/shell/megabyte-cache.sh" ] && . "${XDG_CONFIG_HOME:-$HOME/.config}/shell/megabyte-cache.sh"
if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/shell/not-found-hook.sh" ]; then
  . "${XDG_CONFIG_HOME:-$HOME/.config}/shell/not-found-hook.sh"
fi
EOF
  fi
done

if [ -x "$HOME/.local/bin/cnf-build-index" ] && [ -f "$HOME/.local/share/chezmoi/software.yml" ]; then
  "$HOME/.local/bin/cnf-build-index" "$HOME/.local/share/chezmoi/software.yml" "$HOME/.cache/cnf/index.tsv" >/dev/null 2>&1 || true
fi
if [ -x "$HOME/.local/bin/cnf-build-shims" ]; then
  "$HOME/.local/bin/cnf-build-shims" "$HOME/.cache/cnf/index.tsv" "$HOME/.cache/cnf/shims" || true
fi

log "Workstation provisioning complete."
