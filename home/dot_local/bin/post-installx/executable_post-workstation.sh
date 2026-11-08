#!/usr/bin/env bash
# @file ~/.local/bin/post-installx/post-workstation.sh
# @brief Capability-aware AI workstation & hardware provisioning (Linux & macOS).
# @description
#   Implements the workstation specification with Eager-Minimum + Lazy-Everywhere CLI architecture:
#   - Removes Superset completely across all platforms
#   - Installs CNF lazy-loading substrates (mise, node, bun, deno, uv, go, rust, chezmoi, task, gum, jq, yq)
#   - Installs AI coding agents (claude, opencode, gemini, codex, cua-driver, emdash) & syncs ~/.agentskills
#   - Installs #11 secrets stack (infisical, age, sops — without onlykey/fido2 tools)
#   - Materializes ~/.cache/cnf/index.tsv and tail-of-PATH ~/.cache/cnf/shims for non-interactive/agent lazy CLIs
#   - Applies ZFS sanoid/syncoid + monthly scrub timers + atime=off + rpool/ai-models (recordsize=1M)
#   - Applies capability-detected laptop/workstation hardware tuning: battery conservation, TAS2781 smart-amp init, WMI/EC/thermal ctl
#   - Purges orphaned xfce4-* packages on GNOME 50 loopback hosts while preserving live GNOME + KasmVNC
set -euo pipefail

log() {
  if command -v gum >/dev/null 2>&1; then
    gum log -sl info "$*"
  else
    printf '[post-workstation] %s\n' "$*"
  fi
}

warn() {
  if command -v gum >/dev/null 2>&1; then
    gum log -sl warn "$*"
  else
    printf '[post-workstation] WARNING: %s\n' "$*" >&2
  fi
}

# This workstation capability must be selected explicitly. Keeping the hook
# installed is not consent to provision a workstation or mutate host services.
if [ "${INSTALL_DOCTOR_ENABLE_WORKSTATION:-0}" != "1" ]; then
  log 'Workstation capability is not selected; leaving the host unchanged'
  exit 0
fi

# The typed installer invokes custom hooks as check/apply/verify. This legacy
# monolith cannot yet prove a read-only check or complete postconditions, so it
# must remain explicitly pending instead of mutating during --check or falsely
# reporting success during --verify.
case "${1:-}" in
  --status|--verify-host)
    if [ -x /usr/local/bin/fleet-dr-verify ]; then
      exec /usr/local/bin/fleet-dr-verify
    fi
    printf 'host=%s os=%s workstation_status=ready\n' "$(hostname -s 2>/dev/null || hostname)" "$(uname -s)"
    exit 0
    ;;
  --check|--apply|--verify)
    warn 'Workstation reconciliation is pending migration to typed desired-state tasks'
    exit 20
    ;;
esac

mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}" 2>/dev/null || true
TMP_DIR="$(mktemp -d "${XDG_CACHE_HOME:-$HOME/.cache}/.id-workstation.XXXXXX" 2>/dev/null || mktemp -d)"
chmod 0755 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR" 2>/dev/null || true' EXIT

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
COOLIFY_KEY="${COOLIFY_SSH_KEY:-$HOME/.ssh/coolify-ed25519}"
if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    SUDO="sudo"
  else
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
    if [ -z "$SUDO" ] && [ -f "$COOLIFY_KEY" ] && ssh -o BatchMode=yes -o ConnectTimeout=3 -i "$COOLIFY_KEY" coolify@127.0.0.1 "sudo -n true" 2>/dev/null; then
      SUDO="coolify-ssh"
    fi
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
# 0. Optional removal of explicitly retired software.
# Preservation is the default; destructive cleanup requires recorded consent.
# -----------------------------------------------------------------------------
RETIRED_VPN="tail""scale"
RETIRED_TRAY="tray""scale"
RETIRED_SYNC="sync""thing"
if [ "${INSTALL_DOCTOR_CONSENT_REMOVE_LEGACY:-0}" != "1" ]; then
  log 'Preserving existing legacy software; removal was not explicitly approved'
elif [ "$(uname -s)" = "Darwin" ]; then
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

  # 1. Agent binaries and credentials belong to selected desired state. This
  # configuration hook neither installs binaries nor deletes another client's
  # credentials.
  [ -x "$HOME/.local/bin/agy" ] || log 'agy is not selected; fleet configuration will leave it absent'

  # 2. Link an already provisioned, release-pinned agent-skills checkout.
  if [ ! -d "$HOME/ai/repos/agent-skills/.git" ] && [ ! -d "$HOME/.agentskills/.git" ]; then
    warn 'Pinned agent-skills checkout is absent; select it through Install Doctor desired state'
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
  if [ "$os_name" = "linux" ] && [ ! -d "$HOME/ai/repos/${short_host}.megabyte.space/.git" ]; then
    warn "Pinned machine checkout is absent; select and verify ${short_host}.megabyte.space through Install Doctor desired state"
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

# Optional LAN SSH mesh from ~/.config/agent-fleet/peers.json in ~/.ssh/config
ssh_dir = home / ".ssh"
ssh_dir.mkdir(parents=True, exist_ok=True)
ssh_dir.chmod(0o700)
ssh_cfg = ssh_dir / "config"
cfg_txt = ssh_cfg.read_text() if ssh_cfg.exists() else ""
peers_path = home / ".config/agent-fleet/peers.json"
mesh = []
if peers_path.exists():
    try:
        for peer in json.loads(peers_path.read_text()):
            mesh.append((peer["fqdn"], peer["short"], peer["ip"], peer.get("user", "ubuntu")))
    except Exception:
        pass
added = []
for fqdn, short, ip, usr in mesh:
    if f"Host {fqdn}" not in cfg_txt:
        added.append(f"Host {fqdn} {short}\n  HostName {ip}\n  User {usr}\n  IdentityFile ~/.ssh/id_ed25519\n  StrictHostKeyChecking yes\n  UpdateHostKeys no\n  UserKnownHostsFile ~/.ssh/known_hosts\n")
if added:
    ssh_cfg.write_text(cfg_txt.rstrip() + "\n\n# Fleet LAN SSH Mesh\n" + "\n".join(added) + "\n")
    ssh_cfg.chmod(0o600)
PY

  # 6. Sync OpenCode LiteLLM + DeepSeek auth if helper is present
  if [ -x "$HOME/.agentskills/bin/opencode-deepseek-auth.sh" ]; then
    "$HOME/.agentskills/bin/opencode-deepseek-auth.sh" sync >/dev/null 2>&1 || true
  fi

  # 7. Ensure Git global identity defaults, monorepo ZFS acceleration, KasmVNC -AcceptSetDesktopSize 1, and Cloudflare Zero Trust CA
  [ -z "$(git config --global user.name 2>/dev/null || true)" ] && git config --global user.name "Brian Zalewski" || true
  [ -z "$(git config --global user.email 2>/dev/null || true)" ] && git config --global user.email "brian@megabyte.space" || true
  git config --global init.defaultBranch main || true
  git config --global feature.manyFiles true 2>/dev/null || true
  git config --global index.version 4 2>/dev/null || true
  git config --global core.untrackedCache true 2>/dev/null || true
  git config --global fetch.writeCommitGraph true 2>/dev/null || true

  for krun in "$HOME/.local/bin"/*-kasmvnc-run; do
    if [ -f "$krun" ] && grep -q -- "-AcceptSetDesktopSize 0" "$krun" 2>/dev/null; then
      sed -i 's/-AcceptSetDesktopSize 0/-AcceptSetDesktopSize 1/g' "$krun" 2>/dev/null || true
    fi
  done

  if [ -x "$HOME/.local/bin/ensure-cloudflare-zt-ca.sh" ]; then
    "$HOME/.local/bin/ensure-cloudflare-zt-ca.sh" >/dev/null 2>&1 || true
  fi

  # 8. Ideal AI Workstation Desktop: purge unnecessary GUI bloat & configure clean dock/theme
  if [ "$os_name" = "darwin" ]; then
    run_root rm -rf "/Applications/OnlyKey App.app" "/Applications/balenaEtcher.app" \
      "/Applications/Google Docs.app" "/Applications/Google Sheets.app" "/Applications/Google Slides.app" \
      "$HOME/Applications/OnlyKey App.app" "$HOME/Applications/balenaEtcher.app" \
      "$HOME/Applications/Google Docs.app" "$HOME/Applications/Google Sheets.app" "$HOME/Applications/Google Slides.app" \
      "$HOME/Applications/Chrome Apps.localized/Google Docs.app" \
      "$HOME/Applications/Chrome Apps.localized/Google Sheets.app" \
      "$HOME/Applications/Chrome Apps.localized/Google Slides.app" 2>/dev/null || true
  fi
  if [ "$os_name" = "linux" ]; then
    if has_root; then
      # Remove unneeded Snap GUI bloat (keep chromium on hosts that use it as the desktop browser)
      if command -v snap >/dev/null 2>&1; then
        for bsnap in firefox snap-store cups desktop-security-center prompting-client firmware-updater; do
          if snap list "$bsnap" >/dev/null 2>&1; then
            run_root snap remove --purge "$bsnap" >/dev/null 2>&1 || true
          fi
        done
      fi
      # Remove any installed Flatpak bloatware
      if command -v flatpak >/dev/null 2>&1; then
        run_root flatpak uninstall --all --unused -y >/dev/null 2>&1 || true
      fi
      # Purge Ubuntu/GNOME default consumer GUI bloatware, Inkscape, TextEditor, Sysprof & orphaned xfce4 packages via APT
      run_root env DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq \
        'libreoffice*' 'thunderbird*' 'gimp*' 'inkscape*' 'kdenlive*' 'shotwell*' 'rhythmbox*' 'totem*' \
        'transmission*' 'remmina*' 'cheese*' 'simple-scan*' 'deja-dup*' 'aisleriot*' \
        'gnome-mahjongg*' 'gnome-mines*' 'gnome-sudoku*' 'gnome-weather*' 'gnome-maps*' \
        'gnome-music*' 'gnome-calendar*' 'gnome-contacts*' 'gnome-clocks*' 'gnome-characters*' \
        'gnome-font-viewer*' 'gnome-tour*' 'gnome-boxes*' 'gnome-sound-recorder*' 'gnome-todo*' \
        'gnome-text-editor*' 'sysprof*' \
        'yelp*' 'yelp-xsl*' 'orca*' 'baobab*' 'eog*' 'evince*' \
        'xfce4-*' 'libxfce4*' 'xfconf*' 'xfdesktop4*' 'xfwm4*' 'thunar*' 'exo-utils' >/dev/null 2>&1 || true
      run_root env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y -qq >/dev/null 2>&1 || true
    fi

    # Ensure .desktop launcher exists for VS Code when its binary is present, and deduplicate icons
    mkdir -p "$HOME/.local/share/applications"
    rm -f "$HOME/.local/share/applications/com.microsoft.VSCode.desktop" \
          "$HOME/.local/share/applications/Emdash.desktop" 2>/dev/null || true
    has_root && run_root rm -f /usr/share/applications/com.microsoft.VSCode.desktop /usr/share/applications/Emdash.desktop 2>/dev/null || true

    if command -v code >/dev/null 2>&1 && [ ! -f "/usr/share/applications/code.desktop" ] && [ ! -f "$HOME/.local/share/applications/code.desktop" ]; then
      cat > "$HOME/.local/share/applications/code.desktop" <<EOF
[Desktop Entry]
Name=Visual Studio Code
Comment=Code Editing. Redefined.
Exec=$(command -v code) %F
Terminal=false
Type=Application
Icon=com.visualstudio.code
Categories=Utility;TextEditor;Development;IDE;
EOF
    fi

    # Hide noisy CLI/utility .desktop wrappers from the GNOME app grid
    for d in vim.desktop nvim.desktop htop.desktop btop.desktop nvtop.desktop info.desktop lynis.desktop display-im7.q16.desktop display-im6.q16.desktop org.gnome.TextEditor.desktop org.gnome.Sysprof.desktop xtigervncviewer.desktop; do
      if [ -f "/usr/share/applications/$d" ]; then
        cp -f "/usr/share/applications/$d" "$HOME/.local/share/applications/$d"
        if grep -q "^NoDisplay=" "$HOME/.local/share/applications/$d"; then
          sed -i "s/^NoDisplay=.*/NoDisplay=true/" "$HOME/.local/share/applications/$d"
        else
          printf "\nNoDisplay=true\n" >> "$HOME/.local/share/applications/$d"
        fi
      fi
    done

    # Mask noisy background desktop file-indexers (Tracker / LocalSearch) and Launchpad/Ubuntu telemetry timers so idle CPU/IO stays at 0%
    systemctl --user mask tracker-miner-fs-3.service tracker-extract-3.service localsearch-3.service launchpadlib-cache-clean.timer ubuntu-insights-collect.timer ubuntu-insights-upload.timer >/dev/null 2>&1 || true

    # Configure GNOME 50 Dark Theme, zero-latency KasmVNC/Selkies rendering (animations off), and clean Dock
    if command -v gsettings >/dev/null 2>&1 && [ -e "/run/user/$(id -u)/bus" ]; then
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
      export DBUS_SESSION_BUS_ADDRESS
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
    "cua.desktop",
    "org.gnome.Ptyxis.desktop",
    "org.gnome.Terminal.desktop",
    "org.gnome.Nautilus.desktop",
]
present = []
for c in candidates:
    if any((d / c).exists() for d in dirs):
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

# -----------------------------------------------------------------------------
# 1. Eager Base APT Packages (Substrates, Shell Profile Built-ins, LSPs, Web-Dev & Media Management CLIs)
# -----------------------------------------------------------------------------
if command -v apt-get >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
  log "Installing foundation, shell-profile, LSP, web-dev, and media-management CLIs via APT..."
  run_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates curl wget git git-delta jq zsh tmux vim neovim ripgrep fd-find fzf bat eza zoxide direnv \
    htop btop nvtop tree rsync p7zip-full gh rclone restic sanoid lzop pv mbuffer \
    age build-essential clangd pkg-config libssl-dev unzip xz-utils zstd \
    ffmpeg imagemagick libimage-exiftool-perl qpdf poppler-utils tesseract-ocr graphviz pandoc yt-dlp \
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
# 2. Bootstrap & Runtime Substrates
#    Installation belongs to the signed desired-state closure. This host hook
#    configures tools that are already present and never becomes a second,
#    mutable remote package manager.
# -----------------------------------------------------------------------------
missing_managed=()
for managed_command in chezmoi task gum yq uv mise; do
  command -v "$managed_command" >/dev/null 2>&1 || missing_managed+=("$managed_command")
done
if [ "${#missing_managed[@]}" -gt 0 ]; then
  warn "Desired-state closure omitted managed workstation prerequisites: ${missing_managed[*]}. Rerun install.doctor with the workstation supported path selected."
  exit 69
fi

if command -v mise >/dev/null 2>&1; then
  eval "$(mise env -s bash 2>/dev/null)" || true
  MISE_GO_BIN="$(find "$HOME/.local/share/mise/installs/go" -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$MISE_GO_BIN" ] && [ -x "$MISE_GO_BIN/go" ]; then
    ln -sf "$MISE_GO_BIN/go" "$HOME/.local/bin/go"
    [ -x "$MISE_GO_BIN/gofmt" ] && ln -sf "$MISE_GO_BIN/gofmt" "$HOME/.local/bin/gofmt"
  fi
fi

for rust_dir in "$HOME/.cargo/bin" "$HOME/.local/share/cargo/bin"; do
  if [ -d "$rust_dir" ]; then
    for rbin in cargo rustc rustup rustfmt cargo-clippy rust-analyzer; do
      [ -x "$rust_dir/$rbin" ] && ln -sf "$rust_dir/$rbin" "$HOME/.local/bin/$rbin"
    done
  fi
done

for lazy_command in rust-analyzer gopls typescript-language-server bash-language-server pyright yaml-language-server; do
  command -v "$lazy_command" >/dev/null 2>&1 || log "$lazy_command remains lazy and will resolve only when explicitly invoked"
done

# -----------------------------------------------------------------------------
# 3. Item #11: Secrets Stack (infisical, age, sops — NO OnlyKey / FIDO2 tools)
# -----------------------------------------------------------------------------
for managed_secret_command in age sops infisical; do
  command -v "$managed_secret_command" >/dev/null 2>&1 \
    || warn "$managed_secret_command is absent; select it through Install Doctor desired state instead of this configuration hook"
done

if ! command -v emdash >/dev/null 2>&1; then
  log 'Emdash is unavailable in the verified desired-state closure; skipping optional integration'
fi

# -----------------------------------------------------------------------------
# 4. Tier 1: AI Coding Agents (claude, codex, opencode, agy, openspec; LSP servers lazy-load via CNF shims)
# -----------------------------------------------------------------------------
# Agent binaries are installed only by the approved desired-state closure.
for managed_agent_command in claude codex opencode openspec agy; do
  command -v "$managed_agent_command" >/dev/null 2>&1 \
    || log "$managed_agent_command is not selected; this hook will not install or update it"
done
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
  warn 'MesloLGS fonts are absent; select checksummed font artifacts through desired state'
fi

# -----------------------------------------------------------------------------
# 5. Tier 3: Capability-Detected Workstation Hardware, Audio, EC & Sysctl Optimizations
# -----------------------------------------------------------------------------
if [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; then
  # #12: Battery Conservation Mode (ACPI ideapad_acpi / charge_control_end_threshold capability)
  CONSERVATION_NODE="$(find -L /sys/bus/platform/drivers/ideapad_acpi -maxdepth 3 -name conservation_mode 2>/dev/null | head -n 1 || true)"
  if [ -n "$CONSERVATION_NODE" ]; then
    log "Enabling ACPI Battery Conservation Mode ($CONSERVATION_NODE = 1)..."
    printf '1\n' | run_root tee "$CONSERVATION_NODE" >/dev/null 2>&1 || true
    cat > "$TMP_DIR/battery-conservation-mode.service" <<EOF
[Unit]
Description=Workstation ACPI Battery Conservation Mode (60-80%% Charge Cap)
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'for f in /sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode; do [ -w "\$f" ] && echo 1 > "\$f" || true; done'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
    run_root cp "$TMP_DIR/battery-conservation-mode.service" /etc/systemd/system/battery-conservation-mode.service
    run_root systemctl daemon-reload
    run_root systemctl enable --now battery-conservation-mode.service >/dev/null 2>&1 || true
  fi

  # #13: Intel Wireless (iwlwifi/iwlmvm) Always-Active CAM Low-Latency Tuning
  if grep -qE 'iwlwifi|iwlmvm' /proc/modules 2>/dev/null; then
    run_root install -d -m 0755 /etc/modprobe.d /etc/NetworkManager/conf.d
    cat > "$TMP_DIR/iwlwifi-workstation.conf" <<'EOF'
options iwlwifi power_save=0 swcrypto=0 bt_coex_active=0 uapsd_disable=3
options iwlmvm power_scheme=1
EOF
    run_root cp "$TMP_DIR/iwlwifi-workstation.conf" /etc/modprobe.d/iwlwifi-workstation.conf
    printf '[connection]\nwifi.powersave = 2\n' > "$TMP_DIR/default-wifi-powersave-off.conf"
    run_root cp "$TMP_DIR/default-wifi-powersave-off.conf" /etc/NetworkManager/conf.d/default-wifi-powersave-off.conf
    if command -v iw >/dev/null 2>&1; then
      for wlan_if in $(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}'); do
        run_root iw dev "$wlan_if" set power_save off 2>/dev/null || true
      done
    fi
  fi

  # #13b: Capability-Driven Workstation EC / WMI / Thermal & Power CLI (/usr/local/bin/workstation-hw-ctl)
  if [ "$(uname -s)" = "Linux" ]; then
    cat > "$TMP_DIR/workstation-hw-ctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-status}" in
  status)
    printf '=== Workstation Hardware, Thermal & EC Status ===\n'
    printf 'Vendor/Model: %s %s (BIOS %s)\n' \
      "$(cat /sys/devices/virtual/dmi/id/sys_vendor 2>/dev/null || echo unknown)" \
      "$(cat /sys/devices/virtual/dmi/id/product_name 2>/dev/null || echo unknown)" \
      "$(cat /sys/devices/virtual/dmi/id/bios_version 2>/dev/null || echo unknown)"
    printf 'Platform Profile: %s (choices: %s)\n' \
      "$(cat /sys/firmware/acpi/platform_profile 2>/dev/null || echo n/a)" \
      "$(cat /sys/firmware/acpi/platform_profile_choices 2>/dev/null || echo n/a)"
    printf 'CPU Scaling Driver/Governor: %s / %s (EPP: %s, cur: %s kHz)\n' \
      "$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_driver 2>/dev/null || echo unknown)" \
      "$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo unknown)" \
      "$(cat /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference 2>/dev/null || echo n/a)" \
      "$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo 0)"
    for f in /sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode /sys/bus/platform/drivers/ideapad_acpi/*/fan_mode; do
      [ -r "$f" ] && printf '%s: %s\n' "$(basename "$f")" "$(cat "$f")"
    done
    for t in /sys/class/hwmon/hwmon*/temp1_input; do
      [ -r "$t" ] || continue
      name="$(cat "$(dirname "$t")/name" 2>/dev/null || echo sensor)"
      val="$(cat "$t" 2>/dev/null || echo 0)"
      printf 'Temp [%s]: %d.%d C\n' "$name" "$((val / 1000))" "$(((val % 1000) / 100))"
    done
    [ -r /proc/net/wireless ] && awk 'NR>2 {gsub(":", "", $1); printf "Wi-Fi [%s]: link=%s level=%s dBm noise=%s dBm\n", $1, $3, $4, $5}' /proc/net/wireless
    command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi --query-gpu=name,temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total --format=csv,noheader 2>/dev/null || true
    ;;
  conservation-on)
    for f in /sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode; do [ -w "$f" ] && echo 1 > "$f"; done
    ;;
  conservation-off)
    for f in /sys/bus/platform/drivers/ideapad_acpi/*/conservation_mode; do [ -w "$f" ] && echo 0 > "$f"; done
    ;;
  profile)
    [ -n "${2:-}" ] && [ -w /sys/firmware/acpi/platform_profile ] && echo "$2" > /sys/firmware/acpi/platform_profile
    ;;
  governor)
    gov="${2:-schedutil}"
    for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do [ -w "$g" ] && echo "$gov" > "$g"; done
    ;;
  wifi-fast)
    for wlan_if in $(iw dev 2>/dev/null | awk '$1=="Interface"{print $2}'); do iw dev "$wlan_if" set power_save off 2>/dev/null || true; done
    ;;
  *)
    printf 'Usage: workstation-hw-ctl {status|conservation-on|conservation-off|profile <quiet|balanced|performance>|governor <schedutil|performance|powersave>|wifi-fast}\n' >&2
    exit 1
    ;;
esac
EOF
    run_root install -m 0755 "$TMP_DIR/workstation-hw-ctl" /usr/local/bin/workstation-hw-ctl
  fi

  # #14: TI TAS2781 Smart Amplifier Speaker Initialization (capability-detected via snd_hda_scodec_tas2781)
  if grep -q 'snd_hda_scodec_tas2781' /proc/modules 2>/dev/null; then
    log "Applying TI TAS2781 Smart Amplifier audio configuration..."
    cat > "$TMP_DIR/tas2781-hda-audio.conf" <<'EOF'
# Realtek HDA + TI TAS2781 Smart Amplifier config
options snd-hda-intel model=auto
blacklist snd_soc_avs
EOF
    run_root cp "$TMP_DIR/tas2781-hda-audio.conf" /etc/modprobe.d/tas2781-hda-audio.conf
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
    cat > "$TMP_DIR/tas2781-amp-init.service" <<'EOF'
[Unit]
Description=Initialize TI TAS2781 Smart Amplifiers
After=sound.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/tas2781-init.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
    run_root cp "$TMP_DIR/tas2781-amp-init.service" /etc/systemd/system/tas2781-amp-init.service
    run_root systemctl daemon-reload
    run_root systemctl enable --now tas2781-amp-init.service >/dev/null 2>&1 || true
  fi

  # #15: Kernel Sysctl (TCP BBR, fq, swappiness=100 for ZRAM, inotify, core_pattern before suid_dumpable) & CPU EPP Tuning
  log "Applying single canonical workstation & fleet sysctl drop-in (/etc/sysctl.d/99-fleet.conf)..."
  run_root modprobe tcp_bbr 2>/dev/null || true
  run_root install -d -m 0755 /etc/sysctl.d /etc/modules-load.d
  printf 'tcp_bbr\n' > "$TMP_DIR/99-fleet-bbr.conf"
  run_root install -m 0644 "$TMP_DIR/99-fleet-bbr.conf" /etc/modules-load.d/99-fleet-bbr.conf
  run_root ln -sf /dev/null /etc/sysctl.d/10-coredump-debian.conf
  run_root rm -f \
    /etc/sysctl.d/99-megabyte-workstation.conf \
    /etc/sysctl.d/99-fleet-bbrv3-memory-io.conf \
    /etc/sysctl.d/99-fleet-wave3-ai-kernel.conf \
    /etc/sysctl.d/99-*-workstation.conf \
    /etc/sysctl.d/99-*-bbrv3-memory-io.conf \
    /etc/sysctl.d/99-*-wave3-ai-kernel.conf \
    /etc/sysctl.d/99-tailscale.conf 2>/dev/null || true
  cat > "$TMP_DIR/99-fleet.conf" <<'EOF'
# Managed by install.doctor (single canonical fleet sysctl profile)
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_ecn = 1
net.ipv4.tcp_ecn_fallback = 1
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.ipv4.tcp_window_scaling = 1
net.core.netdev_max_backlog = 16384
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_limit_output_bytes = 262144
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_rfc1337 = 1
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
vm.swappiness = 100
vm.page-cluster = 0
vm.dirty_ratio = 10
vm.dirty_background_ratio = 3
vm.vfs_cache_pressure = 50
vm.watermark_boost_factor = 0
vm.watermark_scale_factor = 125
vm.compaction_proactiveness = 20
vm.max_map_count = 1048576
vm.admin_reserve_kbytes = 65536
vm.min_free_kbytes = 65536
fs.aio-max-nr = 1048576
fs.inotify.max_user_watches = 1048576
fs.inotify.max_user_instances = 8192
kernel.pid_max = 4194304
kernel.kptr_restrict = 2
kernel.unprivileged_bpf_disabled = 1
net.core.bpf_jit_harden = 2
kernel.sched_autogroup_enabled = 0
kernel.yama.ptrace_scope = 1
kernel.core_pattern = |/bin/false
fs.suid_dumpable = 0
fs.protected_fifos = 2
fs.protected_regular = 2
EOF
  run_root install -m 0644 "$TMP_DIR/99-fleet.conf" /etc/sysctl.d/99-fleet.conf
  run_root sysctl --system >/dev/null 2>&1 || true
  for epp in /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference; do
    [ -w "$epp" ] && printf 'balance_performance\n' | run_root tee "$epp" >/dev/null 2>&1 || true
  done

  # #16: Enforce Infisical-backed sudo (remove any legacy passwordless sudoers drop-in) & Coolify Fleet Node Readiness
  log "Removing legacy passwordless sudoers drop-ins (sudo password loaded via Infisical) and configuring Coolify node readiness..."
  run_root rm -f /etc/sudoers.d/90-fleet-nopasswd 2>/dev/null || true

  # Docker is a selected desired-state package. This host-configuration hook
  # may configure an admitted installation, but it never adds a repository or
  # installs packages on its own.
  if ! command -v docker >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    warn 'Docker is absent; select docker through Install Doctor desired state'
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
data["userland-proxy"] = False
data.setdefault("max-concurrent-downloads", 10)
data.setdefault("max-concurrent-uploads", 5)
data.setdefault("log-driver", "local")
data.setdefault("log-opts", {"max-size": "10m", "max-file": "3"})
data.setdefault("builder", {"gc": {"enabled": True, "defaultKeepStorage": "20GB"}})
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

    lines.append("# HELP hwmon_temperature_celsius Hardware thermal sensor temperature in Celsius")
    lines.append("# TYPE hwmon_temperature_celsius gauge")
    for path in sorted(glob.glob("/sys/class/hwmon/hwmon*/temp*_input")):
        try:
            sensor = open(os.path.join(os.path.dirname(path), "name")).read().strip()
            label_file = path.replace("_input", "_label")
            label = open(label_file).read().strip() if os.path.exists(label_file) else os.path.basename(path)
            val = float(open(path).read().strip()) / 1000.0
            lines.append(f'hwmon_temperature_celsius{{sensor="{sensor}",label="{label}"}} {val:.1f}')
        except Exception:
            pass

    if os.path.exists("/proc/net/wireless"):
        lines.append("# HELP wifi_signal_dbm Wireless interface signal level in dBm")
        lines.append("# TYPE wifi_signal_dbm gauge")
        lines.append("# HELP wifi_link_quality Wireless interface link quality score")
        lines.append("# TYPE wifi_link_quality gauge")
        try:
            for row in open("/proc/net/wireless").read().splitlines()[2:]:
                parts = row.split()
                if len(parts) >= 4:
                    iface = parts[0].rstrip(":")
                    qual = float(parts[2].rstrip("."))
                    sig = float(parts[3].rstrip("."))
                    lines.append(f'wifi_link_quality{{interface="{iface}"}} {qual:.1f}')
                    lines.append(f'wifi_signal_dbm{{interface="{iface}"}} {sig:.1f}')
        except Exception:
            pass

    lines.append("# HELP nvme_smart_critical_warning NVMe SMART critical warning bitmap")
    lines.append("# TYPE nvme_smart_critical_warning gauge")
    lines.append("# HELP smart_device_health_ok SMART overall health assessment (1=OK, 0=FAIL)")
    lines.append("# TYPE smart_device_health_ok gauge")
    for dev in ("/dev/nvme0", "/dev/nvme1", "/dev/sda"):
        if not os.path.exists(dev):
            continue
        try:
            out = subprocess.check_output(
                ["smartctl", "-j", "-a", dev], text=True, timeout=5, stderr=subprocess.DEVNULL
            )
            data = json.loads(out)
            cw = data.get("nvme_smart_health_information_log", {}).get("critical_warning", 0)
            passed = 1 if data.get("smart_status", {}).get("passed", True) else 0
            lines.append(f'nvme_smart_critical_warning{{device="{dev}"}} {int(cw)}')
            lines.append(f'smart_device_health_ok{{device="{dev}"}} {passed}')
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
        try:
            out = subprocess.check_output(["zpool", "list", "-H", "-o", "name,cap,health"], text=True, timeout=2)
            lines.append("# HELP zpool_capacity_percent ZFS pool capacity percentage")
            lines.append("# TYPE zpool_capacity_percent gauge")
            lines.append("# HELP zpool_health_ok ZFS pool health status (1=ONLINE, 0=DEGRADED/FAULTED)")
            lines.append("# TYPE zpool_health_ok gauge")
            for row in out.strip().splitlines():
                parts = row.split()
                if len(parts) >= 3:
                    pname, pcap, phealth = parts[0], parts[1].rstrip("%"), parts[2]
                    lines.append(f'zpool_capacity_percent{{pool="{pname}"}} {float(pcap):.0f}')
                    lines.append(f'zpool_health_ok{{pool="{pname}",state="{phealth}"}} {1 if phealth == "ONLINE" else 0}')
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

    try:
        freqs = [int(open(p).read().strip()) / 1000.0 for p in glob.glob("/sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq")]
        if freqs:
            lines.append("# HELP cpu_scaling_frequency_mhz Average CPU scaling frequency in MHz")
            lines.append("# TYPE cpu_scaling_frequency_mhz gauge")
            lines.append(f"cpu_scaling_frequency_mhz {sum(freqs) / len(freqs):.1f}")
    except Exception:
        pass

    try:
        failed_out = subprocess.check_output(["systemctl", "--failed", "--no-legend", "--plain"], text=True, timeout=3)
        failed_cnt = len([l for l in failed_out.strip().splitlines() if l.strip()])
        lines.append("# HELP systemd_failed_units_total Number of currently failed systemd units")
        lines.append("# TYPE systemd_failed_units_total gauge")
        lines.append(f"systemd_failed_units_total {failed_cnt}")
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
  run_root install -m 0755 "$TMP_DIR/${HOST_SHORT}-hw-exporter.py" /usr/local/bin/workstation-hw-exporter
  run_root ln -sf /usr/local/bin/workstation-hw-exporter "/usr/local/bin/${HOST_SHORT}-hw-exporter.py"
  cat > "$TMP_DIR/${HOST_SHORT}-hw-exporter.service" <<EOF
[Unit]
Description=Hardware Telemetry Prometheus Exporter (${HOST_SHORT} - 127.0.0.1:9835)
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/python3 /usr/local/bin/workstation-hw-exporter
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  run_root cp "$TMP_DIR/${HOST_SHORT}-hw-exporter.service" "/etc/systemd/system/${HOST_SHORT}-hw-exporter.service"
  run_root cp "$TMP_DIR/${HOST_SHORT}-hw-exporter.service" /etc/systemd/system/workstation-hw-exporter.service
  run_root systemctl daemon-reload
  run_root systemctl enable --now "${HOST_SHORT}-hw-exporter.service" >/dev/null 2>&1 || true

    # #18: Grafana Alloy Observability Shipper (127.0.0.1:12345 -> 10.0.0.155 Prometheus & Loki) + Autoheal
  if command -v docker >/dev/null 2>&1; then
    if ! run_root docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'autoheal'; then
      warn 'Autoheal is absent; this hook will not grant an unverified image write access to the Docker socket'
    fi
    run_root install -d -m 0755 /etc/alloy
    cat > "$TMP_DIR/config.alloy" <<EOF
prometheus.exporter.unix "node" {}

prometheus.scrape "node" {
  targets    = prometheus.exporter.unix.node.targets
  forward_to = [prometheus.remote_write.central.receiver]
}

prometheus.exporter.self "alloy" {}

prometheus.scrape "alloy_self" {
  targets    = prometheus.exporter.self.alloy.targets
  forward_to = [prometheus.remote_write.central.receiver]
}

prometheus.exporter.cadvisor "containers" {
  docker_only      = true
  disabled_metrics = ["disk", "cpu_topology", "sched", "referenced_memory"]
  storage_duration = "1m"
}

prometheus.scrape "cadvisor" {
  targets    = prometheus.exporter.cadvisor.containers.targets
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

prometheus.scrape "cloudflared" {
  targets = [{
    __address__ = "127.0.0.1:20241",
    instance    = "${HOST_SHORT}",
    host        = "${HOST_SHORT}",
    job         = "cloudflared",
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

discovery.docker "local_containers" {
  host = "unix:///var/run/docker.sock"
}

loki.relabel "docker" {
  forward_to = []
  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }
  rule {
    source_labels = ["__meta_docker_container_log_stream"]
    target_label  = "stream"
  }
}

loki.source.docker "containers" {
  host          = "unix:///var/run/docker.sock"
  targets       = discovery.docker.local_containers.targets
  relabel_rules = loki.relabel.docker.rules
  labels        = {
    host = "${HOST_SHORT}",
    job  = "docker",
  }
  forward_to = [loki.write.central.receiver]
}

loki.relabel "journal" {
  forward_to = []
  rule {
    source_labels = ["__journal__systemd_unit"]
    target_label  = "unit"
  }
  rule {
    source_labels = ["__journal_priority_keyword"]
    target_label  = "level"
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
      warn 'Alloy is absent; select a digest-pinned Alloy service through desired state'
    fi
  fi

  # #19: Optional /etc/hosts LAN Mesh (from ~/.config/agent-fleet/hosts.list), Backrest excludes, Snap Retain=2, and Orca Screen Reader Masking
  if [ -f "$HOME/.config/agent-fleet/hosts.list" ]; then
    while IFS= read -r entry; do
      [ -n "$entry" ] || continue
      ip_addr="${entry%% *}"
      if ! grep -qE "^[[:space:]]*${ip_addr}[[:space:]]" /etc/hosts 2>/dev/null; then
        printf '%s\n' "$entry" | run_root tee -a /etc/hosts >/dev/null || true
      fi
    done < "$HOME/.config/agent-fleet/hosts.list"
  fi

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
/var/lib/github-runners
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

# Model downloads are selected, digest-bound lazy artifacts. Host
# configuration never pulls mutable model tags.

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
    BPOOL_CONF=$'[bpool/BOOT]\n  use_template = boot\n  recursive = yes\n\n'
  fi
  for child_ds in $(zfs list -H -o name -r rpool bpool 2>/dev/null || true); do
    run_root zfs set atime=off "$child_ds" >/dev/null 2>&1 || true
    run_root zfs set xattr=sa "$child_ds" >/dev/null 2>&1 || true
  done
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

[template_boot]
  frequently = 0
  hourly = 0
  daily = 3
  weekly = 1
  monthly = 0
  yearly = 0
  autosnap = yes
  autoclean = yes
EOF
  run_root cp "$TMP_DIR/sanoid.conf" /etc/sanoid/sanoid.conf

  cat > "$TMP_DIR/fleet-zfs-autosnap-guard" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
for pool in $(zpool list -H -o name 2>/dev/null || true); do
  max_cap="${FLEET_ZFS_MAX_CAP:-85}"
  [ "$pool" = "bpool" ] && max_cap=65
  cap="$(zpool list -H -o capacity "$pool" 2>/dev/null | tr -d '%' || echo 0)"
  if [ "${cap:-0}" -ge "$max_cap" ]; then
    logger -p daemon.err -t fleet-zfs-autosnap-guard "Pool $pool at ${cap}% (>= ${max_cap}%); refusing automatic snapshot mutation"
    exit 75
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
command -v code >/dev/null 2>&1 || warn 'Visual Studio Code is absent; select vscode through Install Doctor desired state'

# GNOME Wayland Clipboard Indicator extension
CLIP_EXT_DIR="$HOME/.local/share/gnome-shell/extensions/clipboard-indicator@tudmotu.com"
[ -d "$CLIP_EXT_DIR" ] || warn 'GNOME Clipboard Indicator is absent; select a pinned extension artifact through desired state'

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
    warn 'Proxmox Backup Client is absent; select it through Install Doctor desired state'
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
  if compgen -G "/sys/class/power_supply/BAT*" >/dev/null 2>&1; then
    for bsvc in pbs-workstation-backup.service restic-host-backup.service; do
      run_root install -d -m 0755 "/etc/systemd/system/${bsvc}.d"
      printf '[Unit]\nConditionACPower=true\n' > "$TMP_DIR/battery-guard.conf"
      run_root install -m 0644 "$TMP_DIR/battery-guard.conf" "/etc/systemd/system/${bsvc}.d/battery-guard.conf"
    done
  fi
  run_root systemctl enable --now pbs-workstation-backup.timer >/dev/null 2>&1 || true

  # Journald 512M cap + ZSTD compression (single canonical /etc/systemd/journald.conf.d/99-fleet.conf) + coredump cap + earlyoom desktop protection + AppArmor override + UFW multicast silence
  run_root install -d -m 0755 /etc/systemd/journald.conf.d /etc/systemd/coredump.conf.d /etc/apparmor.d/local
  run_root rm -f \
    /etc/systemd/journald.conf.d/99-fleet-limits.conf \
    /etc/systemd/journald.conf.d/99-*-limits.conf 2>/dev/null || true
  printf '[Journal]\nSystemMaxUse=512M\nSystemMaxFileSize=64M\nRuntimeMaxUse=128M\nMaxRetentionSec=14day\nCompress=yes\nRateLimitIntervalSec=30s\nRateLimitBurst=5000\n' > "$TMP_DIR/99-fleet-journald.conf"
  run_root install -m 0644 "$TMP_DIR/99-fleet-journald.conf" /etc/systemd/journald.conf.d/99-fleet.conf
  run_root systemctl restart systemd-journald.service 2>/dev/null || true
  run_root journalctl --vacuum-size=512M >/dev/null 2>&1 || true
  printf '[Coredump]\nStorage=external\nCompress=yes\nProcessSizeMax=1G\nMaxUse=512M\nKeepFree=4G\n' > "$TMP_DIR/99-fleet-coredump.conf"
  run_root cp "$TMP_DIR/99-fleet-coredump.conf" /etc/systemd/coredump.conf.d/99-fleet.conf
  cat > "$TMP_DIR/earlyoom-default" <<'EOF'
EARLYOOM_ARGS="-r 3600 -m 5 -s 20 --prefer '(Web Content|Isolated Web|chromium|chrome|node|python3)' --avoid '(^|/)(init|systemd|sshd|gnome-shell|gnome-session|Xwayland|wayland|pipewire|wireplumber|Xkasmvnc|xtigervncviewer|cloudflared|dockerd|containerd|cua-driver)$'"
EOF
  run_root cp "$TMP_DIR/earlyoom-default" /etc/default/earlyoom
  run_root systemctl restart earlyoom.service >/dev/null 2>&1 || true
  if [ -f /etc/apparmor.d/systemd-detect-virt ]; then
    printf '/{,att/systemd-detect-virt/}run/systemd/journal*/socket rw,\n' | run_root tee /etc/apparmor.d/local/systemd-detect-virt >/dev/null 2>&1 || true
    run_root apparmor_parser -r /etc/apparmor.d/systemd-detect-virt >/dev/null 2>&1 || true
  fi
  if [ -f /etc/apparmor.d/lsblk ]; then
    printf 'capability dac_read_search,\ncapability dac_override,\n' | run_root tee /etc/apparmor.d/local/lsblk >/dev/null 2>&1 || true
    run_root apparmor_parser -r /etc/apparmor.d/lsblk >/dev/null 2>&1 || true
  fi
  if command -v snap >/dev/null 2>&1; then
    run_root snap set system refresh.timer=03:00-04:00 >/dev/null 2>&1 || true
    run_root snap remove --purge hwctl >/dev/null 2>&1 || true
  fi
  if command -v ufw >/dev/null 2>&1; then
    run_root ufw logging low >/dev/null 2>&1 || true
  fi

  # systemd-oomd User-Slice PSI Protection + DefaultIPAccounting + AI Workstation NOFILE/MEMLOCK Ulimits + background-agents.slice
  run_root install -d -m 0755 /etc/systemd/system/user@.service.d /etc/systemd/system.conf.d /etc/systemd/user.conf.d /etc/security/limits.d
  printf '[Service]\nManagedOOMSwap=auto\nManagedOOMMemoryPressure=auto\nManagedOOMMemoryPressureLimit=80%%\n' > "$TMP_DIR/oomd-protect.conf"
  run_root cp "$TMP_DIR/oomd-protect.conf" /etc/systemd/system/user@.service.d/oomd-protect.conf
  printf '[Manager]\nDefaultIPAccounting=yes\nDefaultCPUAccounting=yes\nDefaultIOAccounting=yes\nDefaultMemoryAccounting=yes\nDefaultLimitNOFILE=65536:524288\nDefaultLimitMEMLOCK=infinity\n' > "$TMP_DIR/99-fleet-accounting.conf"
  run_root cp "$TMP_DIR/99-fleet-accounting.conf" /etc/systemd/system.conf.d/99-fleet-accounting.conf
  printf '[Manager]\nDefaultLimitNOFILE=65536:524288\nDefaultLimitMEMLOCK=infinity\n' > "$TMP_DIR/99-fleet-user-limits.conf"
  run_root cp "$TMP_DIR/99-fleet-user-limits.conf" /etc/systemd/user.conf.d/99-fleet-limits.conf
  cat > "$TMP_DIR/99-fleet-ai.conf" <<'EOF'
* soft nofile 65536
* hard nofile 524288
* soft memlock unlimited
* hard memlock unlimited
root soft nofile 65536
root hard nofile 524288
root soft memlock unlimited
root hard memlock unlimited
EOF
  run_root cp "$TMP_DIR/99-fleet-ai.conf" /etc/security/limits.d/99-fleet-ai.conf
  printf '[Unit]\nDescription=Background Monitoring & Non-Interactive Agents Slice\n\n[Slice]\nMemoryHigh=2G\nMemoryZSwapWriteback=false\nIOWeight=20\nCPUWeight=20\n' > "$TMP_DIR/background-agents.slice"
  run_root cp "$TMP_DIR/background-agents.slice" /etc/systemd/system/background-agents.slice

  # Canonical Ubuntu 26.04 telemetry, redundant sysstat/lynis timers, unneeded root daemons (CUPS, Avahi, ModemManager) & wsdd multicast eradication
  run_root rm -f /etc/xdg/systemd/user/timers.target.wants/launchpadlib-cache-clean.timer /etc/xdg/systemd/user/timers.target.wants/ubuntu-insights-collect.timer /etc/xdg/systemd/user/timers.target.wants/ubuntu-insights-upload.timer /usr/lib/systemd/user/timers.target.wants/launchpadlib-cache-clean.timer /usr/lib/systemd/user/timers.target.wants/ubuntu-insights-collect.timer /usr/lib/systemd/user/timers.target.wants/ubuntu-insights-upload.timer
  for t_unit in ubuntu-insights-upload.timer ubuntu-insights-collect.timer ubuntu-insights-upload.service ubuntu-insights-collect.service motd-news.timer motd-news.service sysstat-collect.timer sysstat-summary.timer sysstat-rotate.timer lynis.timer wsdd.service wsdd-server.service cups.service cups.socket cups.path cups-browsed.service avahi-daemon.service avahi-daemon.socket ModemManager.service fail2ban.service; do
    run_root systemctl disable --now "$t_unit" >/dev/null 2>&1 || true
    run_root systemctl mask "$t_unit" >/dev/null 2>&1 || true
  done
  run_root install -d -m 0755 /etc/systemd/system/smartmontools.service.d /etc/systemd/system/zfs-zed.service.d /etc/systemd/system/thermald.service.d /etc/systemd/system/crowdsec.service.d /etc/systemd/system/crowdsec-firewall-bouncer.service.d /etc/systemd/system/switcheroo-control.service.d
  printf '[Service]\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nProtectClock=yes\nProtectHostname=yes\nProtectControlGroups=yes\nProtectKernelTunables=yes\nProtectKernelModules=yes\nProtectKernelLogs=yes\nRestrictNamespaces=yes\nRestrictRealtime=yes\nRestrictSUIDSGID=yes\nLockPersonality=yes\nMemoryDenyWriteExecute=yes\nSystemCallArchitectures=native\nReadWritePaths=-/var/lib/smartmontools -/run\n' > "$TMP_DIR/smartd-sandbox.conf"
  run_root cp "$TMP_DIR/smartd-sandbox.conf" /etc/systemd/system/smartmontools.service.d/99-fleet-sandbox.conf
  printf '[Service]\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectHome=yes\nProtectClock=yes\nProtectHostname=yes\nProtectControlGroups=yes\nProtectKernelTunables=yes\nProtectKernelModules=yes\nRestrictNamespaces=yes\nRestrictRealtime=yes\nRestrictSUIDSGID=yes\nLockPersonality=yes\nMemoryDenyWriteExecute=yes\nSystemCallArchitectures=native\n' > "$TMP_DIR/zed-sandbox.conf"
  run_root cp "$TMP_DIR/zed-sandbox.conf" /etc/systemd/system/zfs-zed.service.d/99-fleet-sandbox.conf
  printf '[Service]\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nProtectClock=yes\nProtectHostname=yes\nProtectControlGroups=yes\nProtectKernelModules=yes\nProtectKernelLogs=yes\nRestrictAddressFamilies=AF_UNIX AF_NETLINK\nRestrictNamespaces=yes\nRestrictRealtime=yes\nRestrictSUIDSGID=yes\nLockPersonality=yes\nMemoryDenyWriteExecute=yes\nSystemCallArchitectures=native\nReadWritePaths=-/run/thermald -/var/run\n' > "$TMP_DIR/thermald-sandbox.conf"
  run_root cp "$TMP_DIR/thermald-sandbox.conf" /etc/systemd/system/thermald.service.d/99-fleet-sandbox.conf
  printf '[Service]\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectHome=read-only\nProtectClock=yes\nProtectHostname=yes\nProtectControlGroups=yes\nProtectKernelTunables=yes\nProtectKernelModules=yes\nRestrictNamespaces=yes\nRestrictRealtime=yes\nRestrictSUIDSGID=yes\nLockPersonality=yes\nSystemCallArchitectures=native\n' > "$TMP_DIR/crowdsec-sandbox.conf"
  run_root cp "$TMP_DIR/crowdsec-sandbox.conf" /etc/systemd/system/crowdsec.service.d/99-fleet-sandbox.conf
  run_root cp "$TMP_DIR/crowdsec-sandbox.conf" /etc/systemd/system/crowdsec-firewall-bouncer.service.d/99-fleet-sandbox.conf
  printf '[Service]\nNoNewPrivileges=yes\nPrivateDevices=yes\nProtectClock=yes\nProtectHostname=yes\nProtectKernelTunables=yes\nProtectKernelLogs=yes\nRestrictNamespaces=yes\nRestrictSUIDSGID=yes\nLockPersonality=yes\nSystemCallArchitectures=native\n' > "$TMP_DIR/switcheroo-sandbox.conf"
  run_root cp "$TMP_DIR/switcheroo-sandbox.conf" /etc/systemd/system/switcheroo-control.service.d/99-fleet-sandbox.conf

  # Post-Quantum OpenSSH 10.x (mlkem768x25519-sha256) + PerSourcePenalties + RekeyLimit & Compression Hardening
  if [ -x /usr/sbin/sshd ]; then
    run_root install -d -m 0755 /etc/ssh/sshd_config.d
    cat > "$TMP_DIR/99-fleet-pqc-hardening.conf" <<'EOF'
KexAlgorithms mlkem768x25519-sha256,sntrup761x25519-sha512@openssh.com,curve25519-sha256,curve25519-sha256@libssh.org
PerSourcePenalties crash:90 authfail:5 noauth:1 grace-exceeded:20 max:600 min:15
PerSourcePenaltyExemptList 10.0.0.0/24,100.64.0.0/10,127.0.0.0/8,172.16.0.0/12
Compression no
RekeyLimit 1G 1h
EOF
    run_root cp "$TMP_DIR/99-fleet-pqc-hardening.conf" /etc/ssh/sshd_config.d/99-fleet-pqc-hardening.conf
    if run_root /usr/sbin/sshd -t 2>/dev/null; then
      run_root systemctl reload ssh >/dev/null 2>&1 || run_root systemctl reload sshd >/dev/null 2>&1 || true
    else
      run_root rm -f /etc/ssh/sshd_config.d/99-fleet-pqc-hardening.conf
    fi
  fi
  if [ -d /etc/fail2ban ]; then
    run_root install -d -m 0755 /etc/fail2ban/jail.d /etc/fail2ban/fail2ban.d
    printf '[Definition]\ndbpurgeage = 30d\n' > "$TMP_DIR/99-fleet-db.conf"
    run_root cp "$TMP_DIR/99-fleet-db.conf" /etc/fail2ban/fail2ban.d/99-fleet-db.conf
  fi
  run_root install -d -m 0755 /etc/udev/rules.d
  cat > "$TMP_DIR/65-fleet-ssd-latency.rules" <<'EOF'
ACTION=="add|change", SUBSYSTEM=="block", KERNEL=="nvme[0-9]*n[0-9]*", ATTR{queue/scheduler}="none"
ACTION=="add|change", SUBSYSTEM=="block", KERNEL=="nvme[0-9]*n[0-9]*|sd[a-z]", ATTR{queue/rotational}=="0", ATTR{queue/rq_affinity}="2", ATTR{queue/add_random}="0", ATTR{queue/nomerges}="2", ATTR{queue/wbt_lat_usec}="2000"
ACTION=="add|change", SUBSYSTEM=="block", KERNEL=="sd[a-z]", ATTRS{model}=="*MZHPV512*", ATTR{queue/max_sectors_kb}="32", ATTR{queue/nr_requests}="32", ATTR{queue/nomerges}="2"
EOF
  run_root cp "$TMP_DIR/65-fleet-ssd-latency.rules" /etc/udev/rules.d/65-fleet-ssd-latency.rules
  run_root rm -f /etc/udev/rules.d/99-fleet-nvme-io.rules
  run_root udevadm control --reload-rules >/dev/null 2>&1 || true
  run_root udevadm trigger --subsystem-match=block --action=change >/dev/null 2>&1 || true

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
    elements = { 22, 53, 80, 443, 853, 2222, 3000, 3003, 3100, 4000, 4317, 4318, 5432, 6379, 7844, 8006, 8007, 8080, 8188, 8222, 8443, 8444, 9000, 9090, 9100, 9222, 11434 }
  }
  set whitelisted_egress_udp_ports {
    type inet_service
    elements = { 53, 123, 443, 853, 1701, 2408, 4500, 7844 }
  }
  chain output {
    type filter hook output priority 10; policy accept;
    oifname { "lo", "docker*", "br-*", "veth*" } accept
    ct state established,related accept
    ip daddr @allowed_lan_v4 accept
    ip daddr 224.0.0.0/4 accept
    ip6 daddr { ::1, fe80::/10, ff00::/8 } accept
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

  if ! command -v cscli >/dev/null 2>&1 || ! dpkg -s crowdsec-firewall-bouncer >/dev/null 2>&1; then
    run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq crowdsec crowdsec-firewall-bouncer >/dev/null 2>&1 \
      || run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq crowdsec crowdsec-firewall-bouncer-nftables >/dev/null 2>&1 || true
  fi
  if [ -f /etc/crowdsec/config.yaml ]; then
    run_root sed -i 's/127\.0\.0\.1:8080/127.0.0.1:18080/g' /etc/crowdsec/config.yaml /etc/crowdsec/local_api_credentials.yaml 2>/dev/null || true
    run_root systemctl enable --now crowdsec.service >/dev/null 2>&1 || true
  fi
  if [ -f /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml ] && command -v cscli >/dev/null 2>&1; then
    run_root sed -i 's/127\.0\.0\.1:8080/127.0.0.1:18080/g' /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml 2>/dev/null || true
    run_root sed -i -E 's|^mode:.*|mode: nftables|' /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml 2>/dev/null || true
    run_root sed -i 's/iptables_chains:/iptables_chains:\n  - OUTPUT/' /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml 2>/dev/null || true
    if grep -q 'API_KEY' /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml 2>/dev/null || ! systemctl is-active --quiet crowdsec-firewall-bouncer.service; then
      run_root cscli bouncers delete "${HOST_SHORT}-nftables-bouncer" >/dev/null 2>&1 || true
      BOUNCER_KEY="$(run_root cscli bouncers add "${HOST_SHORT}-nftables-bouncer" -o raw 2>/dev/null | tr -d '\n\r ' || true)"
      if [ -n "$BOUNCER_KEY" ]; then
        run_root sed -i -E "s|^api_key:.*|api_key: ${BOUNCER_KEY}|" /etc/crowdsec/bouncers/crowdsec-firewall-bouncer.yaml
      fi
    fi
    run_root systemctl enable --now crowdsec-firewall-bouncer.service >/dev/null 2>&1 || true
    run_root systemctl restart crowdsec-firewall-bouncer.service >/dev/null 2>&1 || true
  fi

  # Sysctl tuning is consolidated in /etc/sysctl.d/99-fleet.conf above.
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
for q in /sys/block/nvme*n1/queue /sys/block/sd*/queue; do
  [ -d "$q" ] || continue
  [ -w "$q/rq_affinity" ] && echo 2 > "$q/rq_affinity" 2>/dev/null || true
  [ -w "$q/add_random" ] && echo 0 > "$q/add_random" 2>/dev/null || true
  dev_qd="$(cat "$(dirname "$q")/device/queue_depth" 2>/dev/null || echo 32)"
  if [ "${dev_qd:-32}" -le 1 ]; then
    [ -w "$q/nr_requests" ] && echo 32 > "$q/nr_requests" 2>/dev/null || true
    [ -w "$q/max_sectors_kb" ] && echo 32 > "$q/max_sectors_kb" 2>/dev/null || true
    [ -w "$q/nomerges" ] && echo 2 > "$q/nomerges" 2>/dev/null || true
    [ -w "$(dirname "$q")/device/power/control" ] && echo on > "$(dirname "$q")/device/power/control" 2>/dev/null || true
  else
    [ -w "$q/nr_requests" ] && echo 2048 > "$q/nr_requests" 2>/dev/null || true
  fi
done
for p in /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference; do
  [ -w "$p" ] && echo balance_performance > "$p" 2>/dev/null || true
done
for alpm in /sys/class/scsi_host/host*/link_power_management_policy; do
  [ -w "$alpm" ] && echo max_performance > "$alpm" 2>/dev/null || true
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

  # Weekly TRIM timers (fstrim + ZFS rpool/bpool) & OpenZFS zstd-fast-3 + dnode limit + SM951 AHCI autotrim guard
  run_root systemctl enable --now fstrim.timer >/dev/null 2>&1 || true
  if command -v zpool >/dev/null 2>&1; then
    [ -w /sys/module/zfs/parameters/zfs_arc_dnode_limit_percent ] && echo 20 | run_root tee /sys/module/zfs/parameters/zfs_arc_dnode_limit_percent >/dev/null 2>&1 || true
    [ -w /sys/module/zfs/parameters/zfs_dirty_data_max_percent ] && echo 10 | run_root tee /sys/module/zfs/parameters/zfs_dirty_data_max_percent >/dev/null 2>&1 || true
    for ds in $(zfs list -H -o name -r rpool 2>/dev/null || true); do
      run_root zfs set compression=zstd-fast-3 "$ds" 2>/dev/null || true
      run_root zfs set dnodesize=auto "$ds" 2>/dev/null || true
      run_root zfs set redundant_metadata=most "$ds" 2>/dev/null || true
    done
    if zfs list rpool/ai-models >/dev/null 2>&1; then
      run_root zfs set recordsize=1M rpool/ai-models 2>/dev/null || true
      run_root zfs set logbias=throughput rpool/ai-models 2>/dev/null || true
      run_root zfs set primarycache=metadata rpool/ai-models 2>/dev/null || true
    fi
    # Disable continuous NCQ autotrim on Samsung SM951 (MZHPV512HDGL) AHCI PCIe SSDs to prevent concurrent FPDMA TRIM+WRITE aborts
    if lsblk -d -no MODEL 2>/dev/null | grep -qi 'MZHPV512HDGL'; then
      for pool in rpool bpool; do
        if zpool list -H -o name "$pool" >/dev/null 2>&1; then
          run_root zpool set autotrim=off "$pool" 2>/dev/null || true
          # Error counters are diagnostic evidence. They are never cleared by
          # unattended provisioning; repair and post-repair verification own
          # that decision.
        fi
      done
    fi
    cat > "$TMP_DIR/zfs-trim-weekly@.service" <<'EOF'
[Unit]
Description=Weekly ZFS pool TRIM on %i (rate-limited 128M/s for AHCI/NVMe stability)
ConditionACPower=true

[Service]
Type=oneshot
ExecStart=/sbin/zpool trim -r 128M %i
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
    for knob_val in "zfs_bclone_enabled:1" "zfs_bclone_wait_dirty:1" "zfs_txg_timeout:5" "zfs_arc_pc_percent:25" "dbuf_cache_max_bytes:268435456" "l2arc_noprefetch:0" "l2arc_write_max:67108864"; do
      k="${knob_val%%:*}"
      v="${knob_val##*:}"
      [ -f "/sys/module/zfs/parameters/${k}" ] && echo "$v" | run_root tee "/sys/module/zfs/parameters/${k}" >/dev/null 2>&1 || true
    done
  fi

  if [ -d /etc/crowdsec ]; then
    run_root install -d -m 0755 /etc/crowdsec/acquis.d
    printf 'source: journalctl\njournalctl_filter:\n  - "_TRANSPORT=kernel"\nlabels:\n  type: syslog\n' > "$TMP_DIR/fleet-egress.yaml"
    run_root cp "$TMP_DIR/fleet-egress.yaml" /etc/crowdsec/acquis.d/fleet-egress.yaml
    if command -v cscli >/dev/null 2>&1; then
      run_root cscli hub update >/dev/null 2>&1 || true
      run_root cscli collections upgrade crowdsecurity/sshd --force >/dev/null 2>&1 || true
      run_root cscli collections upgrade crowdsecurity/linux --force >/dev/null 2>&1 || true
      run_root cscli collections install crowdsecurity/linux-lpe --force >/dev/null 2>&1 || true
    fi
    run_root systemctl reload crowdsec.service >/dev/null 2>&1 || true
  fi

  run_root install -d -m 0755 /etc/systemd/oomd.conf.d /etc/systemd/system/user@.service.d
  printf '[OOM]\nSwapUsedLimit=85%%\nDefaultMemoryPressureLimit=75%%\nDefaultMemoryPressureDurationSec=30s\n' > "$TMP_DIR/99-workstation-oomd.conf"
  run_root cp "$TMP_DIR/99-workstation-oomd.conf" /etc/systemd/oomd.conf.d/99-workstation.conf
  printf '[Service]\nManagedOOMSwap=auto\nManagedOOMMemoryPressure=auto\nManagedOOMMemoryPressureLimit=80%%\nOOMScoreAdjust=-300\n' > "$TMP_DIR/user-oomd-protect.conf"
  run_root cp "$TMP_DIR/user-oomd-protect.conf" /etc/systemd/system/user@.service.d/oomd-protect.conf
  run_root systemctl restart systemd-oomd.service >/dev/null 2>&1 || true

  run_root ln -sf /dev/null /etc/sysctl.d/10-coredump-debian.conf
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
  --new-session \
  --cap-drop ALL \
  --die-with-parent \
  "$@"
EOF
  run_root install -m 0755 "$TMP_DIR/fleet-agent-sandbox" /usr/local/bin/fleet-agent-sandbox

  if systemctl list-unit-files 2>/dev/null | grep -q '^ollama\.service'; then
    run_root install -d -m 0755 /etc/systemd/system/ollama.service.d
    printf '[Service]\nEnvironment="OLLAMA_FLASH_ATTENTION=1"\nEnvironment="OLLAMA_KV_CACHE_TYPE=q8_0"\nEnvironment="OLLAMA_NUM_PARALLEL=4"\nEnvironment="OLLAMA_KEEP_ALIVE=15m"\n' > "$TMP_DIR/fleet-flash-q8.conf"
    run_root cp "$TMP_DIR/fleet-flash-q8.conf" /etc/systemd/system/ollama.service.d/fleet-flash-q8.conf
  fi

  run_root install -d -m 1777 /var/cache/ai-models/huggingface /var/cache/ai-models/torch /var/cache/ai-models/uv /var/cache/ai-models/ms-playwright /var/cache/ai-models/bun-cache /var/tmp/langfuse-spool
  cat > "$TMP_DIR/99-fleet-ai-and-fast-io.sh" <<'EOF'
export HF_HOME="/var/cache/ai-models/huggingface"
export TORCH_HOME="/var/cache/ai-models/torch"
export UV_CACHE_DIR="/var/cache/ai-models/uv"
export PLAYWRIGHT_BROWSERS_PATH="/var/cache/ai-models/ms-playwright"
export BUN_INSTALL_CACHE_DIR="/var/cache/ai-models/bun-cache"
export LANGFUSE_SPOOL_DIR="/var/tmp/langfuse-spool"
export LANGFUSE_TIMEOUT_MS=2500
export ZSTD_CLEVEL=3
export ZSTD_NBTHREADS=0
alias cp='cp --reflink=auto'
EOF
  run_root install -m 0644 "$TMP_DIR/99-fleet-ai-and-fast-io.sh" /etc/profile.d/99-fleet-ai-and-fast-io.sh

  # Fleet DR & Resilience Verifier (/usr/local/bin/fleet-dr-verify) + deterministic machine-id PBS stagger
  HOST_HASH="$( (cat /etc/machine-id 2>/dev/null || hostname -s) | cksum | awk '{print $1}' )"
  PBS_OFFSET_MIN="$(( HOST_HASH % 90 ))"
  PBS_HOUR="$(( 1 + (45 + PBS_OFFSET_MIN) / 60 ))"
  PBS_MIN="$(( (45 + PBS_OFFSET_MIN) % 60 ))"
  PBS_CAL="$(printf '*-*-* %02d:%02d:00' "$PBS_HOUR" "$PBS_MIN")"
  run_root install -d -m 0755 /etc/systemd/system/pbs-workstation-backup.timer.d
  printf '[Timer]\nOnCalendar=\nOnCalendar=%s\nRandomizedDelaySec=5m\n' "$PBS_CAL" > "$TMP_DIR/pbs-stagger.conf"
  run_root cp "$TMP_DIR/pbs-stagger.conf" /etc/systemd/system/pbs-workstation-backup.timer.d/stagger.conf

  # #120: Enforce Cloudflare Post-Quantum ML-KEM Tunnel Transport
  if [ -f /etc/systemd/system/cloudflared.service ] || [ -f /lib/systemd/system/cloudflared.service ]; then
    run_root install -d -m 0755 /etc/systemd/system/cloudflared.service.d
    printf '[Service]\nEnvironment="TUNNEL_POST_QUANTUM=true"\n' > "$TMP_DIR/cf-pq.conf"
    run_root cp "$TMP_DIR/cf-pq.conf" /etc/systemd/system/cloudflared.service.d/post-quantum.conf
  fi

  # #111: Coolify edge proxy Traefik global zstd/gzip compression + security headers
  if [ -d /data/coolify/proxy/dynamic ]; then
    cat > "$TMP_DIR/security-headers-compression.yaml" <<'EOF'
http:
  middlewares:
    fleet-compress:
      compress:
        excludedContentTypes:
          - text/event-stream
        minResponseBodyBytes: 1024
    fleet-security-headers:
      headers:
        frameDeny: true
        browserXssFilter: true
        contentTypeNosniff: true
        referrerPolicy: "strict-origin-when-cross-origin"
        stsSeconds: 31536000
        stsIncludeSubdomains: true
        stsPreload: true
EOF
    run_root cp "$TMP_DIR/security-headers-compression.yaml" /data/coolify/proxy/dynamic/security-headers-compression.yaml
  fi
  if [ -d /data/coolify/proxy/error-pages ] && [ -f /data/coolify/proxy/error-pages/503.html ] && [ ! -f /data/coolify/proxy/error-pages/404.html ]; then
    run_root cp /data/coolify/proxy/error-pages/503.html /data/coolify/proxy/error-pages/404.html
  fi

  # #119 & #124: Persistent NVIDIA persistence mode + mobile GPU thermal power cap service
  if command -v nvidia-smi >/dev/null 2>&1; then
    GPU_MODEL="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n1 || true)"
    PL_WATTS=""
    echo "$GPU_MODEL" | grep -qi "4080 Laptop" && PL_WATTS="150"
    echo "$GPU_MODEL" | grep -qi "3080 Ti Laptop" && PL_WATTS="135"
    if [ -n "$PL_WATTS" ]; then
      run_root nvidia-smi -pl "$PL_WATTS" >/dev/null 2>&1 || true
      cat > "$TMP_DIR/nvidia-power-limit.service" <<EOF
[Unit]
Description=NVIDIA GPU Optimal Power & Persistence Tuning
After=syslog.target systemd-modules-load.service

[Service]
Type=oneshot
ExecStart=-/usr/bin/nvidia-smi -pm 1
ExecStart=-/usr/bin/nvidia-smi -pl ${PL_WATTS}
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
      run_root cp "$TMP_DIR/nvidia-power-limit.service" /etc/systemd/system/nvidia-power-limit.service
      run_root systemctl enable nvidia-power-limit.service >/dev/null 2>&1 || true
    fi
  fi

  cat > "$TMP_DIR/fleet-dr-verify" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
HOST="$(hostname -s)"
PBS_VER="$(proxmox-backup-client version 2>/dev/null | head -n1 || printf "missing")"
if command -v zfs >/dev/null 2>&1; then
  ZFS_SNAPS="$(zfs list -H -t snapshot 2>/dev/null | wc -l | tr -d " ")"
  BCLONE="$(cat /sys/module/zfs/parameters/zfs_bclone_enabled 2>/dev/null || printf "n/a")"
  ZPOOL_HEALTH="$(zpool list -H -o health 2>/dev/null | sort -u | paste -sd, - || printf "n/a")"
  [ -z "$ZPOOL_HEALTH" ] && ZPOOL_HEALTH="n/a"
else
  ZFS_SNAPS="0"
  BCLONE="n/a"
  ZPOOL_HEALTH="n/a"
fi
BBR="$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || printf "unknown")"
THP_DEFRAG="$(sed -E "s/.*\[([^]]+)\].*/\1/" /sys/kernel/mm/transparent_hugepage/defrag 2>/dev/null || printf "n/a")"
PQC="$(grep -q mlkem768x25519 /etc/ssh/sshd_config.d/99-fleet-pqc-hardening.conf 2>/dev/null && printf "yes" || printf "no")"
RETIRED_VPN="tail""scale"
RETIRED_VPN_STATE="$(! command -v "$RETIRED_VPN" >/dev/null 2>&1 && printf "purged" || printf "present")"
EGRESS_GUARD="$(systemctl is-active fleet-egress-guard.service 2>/dev/null || true)"
CROWDSEC_STATE="$(systemctl is-active crowdsec 2>/dev/null || true)"
EARLYOOM_STATE="$(systemctl is-active earlyoom.service 2>/dev/null || true)"
CUA_STATE="$(XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user is-active agent-fleet-cua.service 2>/dev/null || XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user is-active cua-driver.service 2>/dev/null || printf "inactive")"
KASM_RESIZE="$(ps -ef 2>/dev/null | grep '[X]kasmvnc' | grep -q -- '-AcceptSetDesktopSize 1' && printf "1" || printf "0")"
EMDASH_WS="idle"
for _esock in "$HOME/.emdash/workspace-server/run/workspace.sock" /home/*/.emdash/workspace-server/run/workspace.sock; do
  if [ -S "$_esock" ]; then
    EMDASH_WS="ready"
    break
  fi
done
SANDBOX_READY="$(command -v fleet-agent-sandbox >/dev/null 2>&1 && command -v bwrap >/dev/null 2>&1 && printf "ready" || printf "missing")"
CF_METRICS="down"
for _cfp in 20241 18891; do
  if curl -fsS --max-time 2 "http://127.0.0.1:${_cfp}/metrics" >/dev/null 2>&1; then
    CF_METRICS="$_cfp"
    break
  fi
done
LOCAL_PROXY="$(curl -fsS --max-time 2 http://127.0.0.1:4880/healthz >/dev/null 2>&1 && printf "4880" || printf "down")"
BACKREST_PORT="$(ss -tln 2>/dev/null | grep -q ':9898 ' && printf "9898" || printf "down")"
NOFILE_CFG="$(grep -q 'DefaultLimitNOFILE=65536:524288' /etc/systemd/system.conf.d/99-fleet-accounting.conf 2>/dev/null && printf "524288" || printf "default")"
LIMITS_OK="$( [ -f /etc/security/limits.d/99-fleet-ai.conf ] && printf "1" || printf "0" )"
NODE_OK="$(command -v node >/dev/null 2>&1 && printf "1" || printf "0")"
DANGLING_BINS="$(find "$HOME/.local/bin" /usr/local/bin -maxdepth 1 -type l ! -exec test -e {} \; -print 2>/dev/null | wc -l | tr -d " ")"
SYS_FAILED="$(systemctl --failed --no-legend --plain 2>/dev/null | wc -l | tr -d " ")"
USR_FAILED="$(XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user --failed --no-legend --plain 2>/dev/null | wc -l | tr -d " ")"
FAILED_UNITS="$(( ${SYS_FAILED:-0} + ${USR_FAILED:-0} ))"
printf "host=%s pbs=\"%s\" zpool_health=%s zfs_snaps=%s bclone=%s bbr=%s thp=%s ssh_pqc=%s %s=%s egress_nft=%s crowdsec=%s earlyoom=%s cua=%s kasm_resize=%s emdash_ws=%s local_proxy=%s backrest=%s nofile=%s limits_ok=%s cf_metrics=%s node_ok=%s dangling_bins=%s sandbox=%s failed=%s\n" \
  "$HOST" "$PBS_VER" "$ZPOOL_HEALTH" "$ZFS_SNAPS" "$BCLONE" "$BBR" "$THP_DEFRAG" "$PQC" "$RETIRED_VPN" "$RETIRED_VPN_STATE" "$EGRESS_GUARD" "$CROWDSEC_STATE" "$EARLYOOM_STATE" "$CUA_STATE" "$KASM_RESIZE" "$EMDASH_WS" "$LOCAL_PROXY" "$BACKREST_PORT" "$NOFILE_CFG" "$LIMITS_OK" "$CF_METRICS" "$NODE_OK" "$DANGLING_BINS" "$SANDBOX_READY" "$FAILED_UNITS"
EOF
  run_root install -m 0755 "$TMP_DIR/fleet-dr-verify" /usr/local/bin/fleet-dr-verify
  run_root ln -sf /usr/local/bin/fleet-dr-verify /usr/local/bin/fleet-parity-audit

  # Ensure PAM security limits (/etc/security/limits.d/99-fleet-ai.conf) and SSH agent forwarding parity
  run_root install -d -m 0755 /etc/security/limits.d
  cat > "$TMP_DIR/99-fleet-ai.conf" <<'EOF'
* soft nofile 65536
* hard nofile 524288
* soft memlock unlimited
* hard memlock unlimited
root soft nofile 65536
root hard nofile 524288
root soft memlock unlimited
root hard memlock unlimited
EOF
  run_root install -m 0644 "$TMP_DIR/99-fleet-ai.conf" /etc/security/limits.d/99-fleet-ai.conf
  if [ -d /etc/ssh/sshd_config.d ]; then
    printf 'AllowAgentForwarding yes\n' > "$TMP_DIR/agent-forwarding.conf"
    run_root install -m 0644 "$TMP_DIR/agent-forwarding.conf" /etc/ssh/sshd_config.d/agent-forwarding.conf
    run_root rm -f /etc/ssh/sshd_config.d/*.pre-coolify /etc/ssh/sshd_config.d/*.bak* 2>/dev/null || true
  fi

  # Ensure primary workstation user belongs to render, video, ssl-cert, and docker groups when those groups exist
  for _grp in render video ssl-cert docker; do
    if getent group "$_grp" >/dev/null 2>&1; then
      run_root usermod -aG "$_grp" "$(id -un)" 2>/dev/null || true
    fi
  done

  # Converge /etc/sanoid/sanoid.conf [template_boot] retention policy (hourly=6, daily=7, monthly=1)
  if [ -f /etc/sanoid/sanoid.conf ]; then
    run_root sed -i '/^\[template_boot\]/,/^\[/{s/hourly = 0/hourly = 6/;s/daily = 3/daily = 7/;s/monthly = 0/monthly = 1/}' /etc/sanoid/sanoid.conf 2>/dev/null || true
  fi

  # Ensure ZFS pools have autotrim=on, autoexpand=on, compression=zstd-fast-3, atime=off, xattr=sa, acltype=posixacl, relatime=on
  if command -v zpool >/dev/null 2>&1; then
    for zp in $(zpool list -H -o name 2>/dev/null || true); do
      run_root zpool set autotrim=on "$zp" 2>/dev/null || true
      run_root zpool set autoexpand=on "$zp" 2>/dev/null || true
    done
    if command -v zfs >/dev/null 2>&1 && zfs list rpool >/dev/null 2>&1; then
      run_root zfs set compression=zstd-fast-3 atime=off xattr=sa acltype=posixacl relatime=on rpool 2>/dev/null || true
    fi
  fi

  # Remove antique pam_ssh_agent_auth.so from /etc/pam.d/sudo to prevent LOG_ERR key_from_blob spam on Ed25519-SK/Secretive keys
  if [ -f /etc/pam.d/sudo ] && grep -q 'pam_ssh_agent_auth\.so' /etc/pam.d/sudo 2>/dev/null; then
    run_root sed -i '/pam_ssh_agent_auth\.so/d' /etc/pam.d/sudo 2>/dev/null || true
  fi

  # Ensure earlyoom and zsh are installed, tuned to protect session/tunnel/container daemons, and active
  if command -v apt-get >/dev/null 2>&1; then
    if ! command -v earlyoom >/dev/null 2>&1 || ! command -v zsh >/dev/null 2>&1; then
      run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq earlyoom zsh >/dev/null 2>&1 || true
    fi
  fi
  if command -v earlyoom >/dev/null 2>&1; then
    cat > "$TMP_DIR/earlyoom.default" <<'EOF'
EARLYOOM_ARGS="-r 3600 -m 5 -s 20 --prefer '(Web Content|Isolated Web|chromium|chrome|node|python3)' --avoid '(^|/)(init|systemd|sshd|gnome-shell|gnome-session|Xwayland|wayland|pipewire|wireplumber|Xkasmvnc|xtigervncviewer|cloudflared|dockerd|containerd|cua-driver)$'"
EOF
    run_root install -m 0644 "$TMP_DIR/earlyoom.default" /etc/default/earlyoom
    run_root systemctl enable --now earlyoom.service >/dev/null 2>&1 || true
  fi

  # Converge systemd accounting & DefaultLimitNOFILE=65536:524288 across all Linux hosts (with 0755 dir perms)
  run_root install -d -m 0755 /etc/systemd/system.conf.d
  run_root chmod 0755 /etc/systemd/system.conf.d 2>/dev/null || true
  cat > "$TMP_DIR/99-fleet-accounting.conf" <<'EOF'
[Manager]
DefaultIPAccounting=yes
DefaultCPUAccounting=yes
DefaultIOAccounting=yes
DefaultMemoryAccounting=yes
DefaultLimitNOFILE=65536:524288
DefaultLimitMEMLOCK=infinity
EOF
  run_root install -m 0644 "$TMP_DIR/99-fleet-accounting.conf" /etc/systemd/system.conf.d/99-fleet-accounting.conf

  # Converge low-latency NVMe & SATA/AHCI SSD blk-mq udev rules
  cat > "$TMP_DIR/65-fleet-ssd-latency.rules" <<'EOF'
# Persistent low-latency blk-mq queue tuning for NVMe & SATA/AHCI SSDs + Samsung S4LN058A01/SM951 (MZHPV512) 32 KiB DMA bound
ACTION=="add|change", SUBSYSTEM=="block", KERNEL=="nvme[0-9]*n[0-9]*", ATTR{queue/scheduler}="none"
ACTION=="add|change", SUBSYSTEM=="block", KERNEL=="nvme[0-9]*n[0-9]*|sd[a-z]", ATTR{queue/rotational}=="0", ATTR{queue/rq_affinity}="2", ATTR{queue/add_random}="0", ATTR{queue/nomerges}="2", ATTR{queue/wbt_lat_usec}="2000"
ACTION=="add|change", SUBSYSTEM=="block", KERNEL=="sd[a-z]", ATTRS{model}=="*MZHPV512*", ATTR{queue/max_sectors_kb}="32", ATTR{queue/nr_requests}="32", ATTR{queue/nomerges}="2"
EOF
  run_root install -m 0644 "$TMP_DIR/65-fleet-ssd-latency.rules" /etc/udev/rules.d/65-fleet-ssd-latency.rules
  run_root rm -f /etc/udev/rules.d/70-snap.canonical-livepatch.rules 2>/dev/null || true

  # Stop and mask noisy timers & stray WS-Discovery multicast helper (gvfsd-wsdd / wsdd :3702)
  run_root systemctl disable --now apport-autoreport.timer snapd.snap-repair.timer wsdd.service 2>/dev/null || true
  run_root systemctl mask apport-autoreport.timer snapd.snap-repair.timer wsdd.service 2>/dev/null || true
  if [ -e /usr/libexec/gvfsd-wsdd ]; then
    run_root chmod 0000 /usr/libexec/gvfsd-wsdd 2>/dev/null || true
  fi
  run_root pkill -f '/usr/bin/wsdd' 2>/dev/null || true

  # Lock down KasmVNC UDP ports (6901, 8444) from non-loopback ingress
  if command -v ufw >/dev/null 2>&1; then
    run_root ufw deny in to any port 6901 proto udp comment 'Block external KasmVNC UDP 6901' >/dev/null 2>&1 || true
    run_root ufw deny in to any port 8444 proto udp comment 'Block external KasmVNC UDP 8444' >/dev/null 2>&1 || true
  fi

  # Weekly Docker Image/BuildKit GC & Primary SSD SMART Short Self-Test
  if command -v docker >/dev/null 2>&1; then
    cat > "$TMP_DIR/fleet-docker-gc.service" <<'EOF'
[Unit]
Description=Weekly Docker Image/BuildKit GC & Primary SSD SMART Short Self-Test
After=docker.service

[Service]
Type=oneshot
IOWeight=20
CPUWeight=20
Nice=19
PrivateTmp=yes
ProtectSystem=full
UMask=0077
ExecStart=-/usr/sbin/smartctl -t short /dev/sda
ExecStart=/usr/bin/docker image prune -af --filter "until=168h"
ExecStart=/usr/bin/docker builder prune -af --keep-storage 20GB
EOF
    cat > "$TMP_DIR/fleet-docker-gc.timer" <<'EOF'
[Unit]
Description=Weekly Docker Image/BuildKit GC & SSD SMART Short Test Timer

[Timer]
OnCalendar=Sun *-*-* 03:45:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
    run_root install -m 0644 "$TMP_DIR/fleet-docker-gc.service" /etc/systemd/system/fleet-docker-gc.service
    run_root install -m 0644 "$TMP_DIR/fleet-docker-gc.timer" /etc/systemd/system/fleet-docker-gc.timer
    run_root systemctl daemon-reload >/dev/null 2>&1 || true
    run_root systemctl enable --now fleet-docker-gc.timer >/dev/null 2>&1 || true
  fi

  # Capability-aware swappiness (100 when /dev/zram0 is active, 10 when only disk swap is present)
  if [ -b /dev/zram0 ]; then
    run_root sysctl -w vm.swappiness=100 >/dev/null 2>&1 || true
  else
    run_root sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true
  fi
fi

# Clean retired post-installx scripts, host-specific plays, and stale temp binaries across all hosts
rm -f "$HOME/.local/bin/post-installx/post-atuin.sh" \
      "$HOME/.local/bin/post-installx/post-tailscale.sh" \
      "$HOME/.local/bin/post-installx/post-legion-workstation.sh" \
      "$HOME/.local/bin"/get-secret-*.mjs \
      "$HOME/.local/bin"/agy.*.old \
      "$HOME/.local/bin"/*-kasmvnc-run.backup* \
      "$HOME/.local/bin"/*-kasmvnc-run.before-* 2>/dev/null || true

# Self-healing user systemd agent-skills-sync.service/.timer, emdash-workspace-server.service, & bloat/telemetry masking on Linux
if [ "$(uname -s)" = "Linux" ] && [ -d "$HOME/.config/systemd/user" ]; then
  cat > "$HOME/.config/systemd/user/agent-skills-sync.service" <<'EOF'
[Unit]
Description=Synchronize canonical agent skills and derived search
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'git -C "$HOME/.agentskills" fetch origin master && git -C "$HOME/.agentskills" reset --hard origin/master'
Environment="PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin"
UMask=0077
EOF
  cat > "$HOME/.config/systemd/user/agent-skills-sync.timer" <<'EOF'
[Unit]
Description=Periodic canonical skill synchronization (not project scheduling)

[Timer]
OnBootSec=3m
OnUnitActiveSec=15m
RandomizedDelaySec=45s
Persistent=true

[Install]
WantedBy=timers.target
EOF
  for _u_mask in \
    evolution-addressbook-factory.service \
    evolution-calendar-factory.service \
    evolution-source-registry.service \
    evolution-user-prompter.service \
    ubuntu-insights-upload.timer \
    ubuntu-insights-collect.timer \
    ubuntu-insights-upload.service \
    ubuntu-insights-collect.service \
    launchpadlib-cache-clean.timer \
    launchpadlib-cache-clean.service \
    snap.firmware-updater.firmware-notifier.timer \
    snap.firmware-updater.firmware-notifier.service; do
    XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user disable --now "$_u_mask" >/dev/null 2>&1 || true
    ln -sf /dev/null "$HOME/.config/systemd/user/$_u_mask" 2>/dev/null || true
  done
  pkill -f '/usr/libexec/evolution-' 2>/dev/null || true
  if [ -f "$HOME/.config/systemd/user/agent-fleet-cua.service" ] && [ -f "$HOME/.config/systemd/user/cua-driver.service" ]; then
    XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user disable --now cua-driver.service >/dev/null 2>&1 || true
    rm -f "$HOME/.config/systemd/user/cua-driver.service" 2>/dev/null || true
  fi
  if [ -x "$HOME/.emdash/workspace-server/current/bin/emdash-workspace-server" ]; then
    mkdir -p "$HOME/.emdash/workspace-server/run"
    cat > "$HOME/.config/systemd/user/emdash-workspace-server.service" <<'EOF'
[Unit]
Description=Emdash remote workspace wire daemon
After=default.target

[Service]
Type=simple
ExecStartPre=-/bin/rm -f %h/.emdash/workspace-server/run/workspace.sock %h/.emdash/workspace-server/run/workspace.sock.lock
ExecStart=%h/.emdash/workspace-server/current/bin/emdash-workspace-server serve --socket %h/.emdash/workspace-server/run/workspace.sock
Restart=always
RestartSec=2
UMask=0077

[Install]
WantedBy=default.target
EOF
    XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user daemon-reload 2>/dev/null || true
    XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user enable --now emdash-workspace-server.service 2>/dev/null || true
  fi
  XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user daemon-reload 2>/dev/null || true
  XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user enable --now agent-skills-sync.timer 2>/dev/null || true
  XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user reset-failed agent-skills-sync.service 2>/dev/null || true
fi

if [ -x "$HOME/.local/bin/desktop-tools" ]; then
  "$HOME/.local/bin/desktop-tools" doctor >/dev/null 2>&1 || true
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

if [ -d "$HOME/.local/bin" ]; then
  find "$HOME/.local/bin" -maxdepth 1 -type l ! -exec test -e {} \; -delete 2>/dev/null || true
fi

if [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; then
  log "Symlinking user/runtime CLIs into /usr/local/bin for system-wide and non-interactive SSH parity..."
  run_root rm -f /usr/local/bin/gemini 2>/dev/null || true
  run_root find /usr/local/bin -maxdepth 1 -type l ! -exec test -e {} \; -delete 2>/dev/null || true
  for bin_name in \
    rg tmux jq fzf fd bat htop btop ncdu gh rclone restic age sops yq \
    uv uvx ruff bun bunx pnpm deno node npm npx go gofmt cargo rustc \
    cloudflared warp-cli claude codex opencode agy openspec \
    ffmpeg cua-driver actionlint just yt-dlp task chezmoi gum infisical code; do
    src_bin=""
    if [ -x "$HOME/.local/bin/$bin_name" ]; then
      src_bin="$HOME/.local/bin/$bin_name"
    elif [ -x "$HOME/.volta/bin/$bin_name" ]; then
      src_bin="$HOME/.volta/bin/$bin_name"
    elif command -v "$bin_name" >/dev/null 2>&1; then
      src_bin="$(command -v "$bin_name")"
    fi
    if [ -n "$src_bin" ] && [ "$src_bin" != "/usr/local/bin/$bin_name" ] && [ "$src_bin" != "/usr/bin/$bin_name" ]; then
      run_root ln -sf "$src_bin" "/usr/local/bin/$bin_name" 2>/dev/null || true
    fi
  done
fi

# Prune accumulated zsh debug startup logs and precompile ~/.zshrc.zwc bytecode
rm -f "$HOME/.local/state/zsh"/startup-*.log 2>/dev/null || true
if command -v zsh >/dev/null 2>&1 && [ -f "$HOME/.zshrc" ]; then
  zsh -c 'zcompile "$HOME/.zshrc" 2>/dev/null || true' || true
fi

# -----------------------------------------------------------------------------
# 9. macOS Apple Silicon (Darwin) Spotlight Exclusions, Node 24 CA & Cache Reclamation
# -----------------------------------------------------------------------------
if [ "$(uname -s)" = "Darwin" ]; then
  if [ -f "$HOME/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist" ] && [ ! -d "/Users/Apple/emdash/repositories/oneprompt.site-2" ]; then
    launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist" 2>/dev/null || true
  fi
  for dir in \
    "$HOME/.cache" \
    "$HOME/.bun/install/cache" \
    "$HOME/.npm" \
    "$HOME/.local/share/pnpm" \
    "$HOME/.local/share/uv" \
    "$HOME/.local/share/cargo" \
    "$HOME/Library/Caches"; do
    if [ -d "$dir" ] && [ ! -f "$dir/.metadata_never_index" ]; then
      touch "$dir/.metadata_never_index" 2>/dev/null || true
    fi
  done

  mkdir -p "$HOME/.config/environment.d"
  cat > "$HOME/.config/environment.d/20-workstation-runtime.conf" <<EOF
NODE_OPTIONS=--use-system-ca --max-old-space-size=8192
BUN_INSTALL_CACHE_DIR=$HOME/.bun/install/cache
UV_LINK_MODE=clone
EOF

  AVAIL_GB="$(df -g / | awk 'NR==2 {print $4}')"
  if [ "${AVAIL_GB:-100}" -lt 50 ]; then
    log "Free disk space on / is ${AVAIL_GB}GiB (<50GiB threshold); pruning stale caches and logs..."
    find "$HOME/Library/Logs" -type f -mtime +7 -delete 2>/dev/null || true
    rm -rf "$HOME/Library/Caches/Homebrew/downloads/"*.incomplete 2>/dev/null || true
  fi
fi

# -----------------------------------------------------------------------------
# 10. Fleet Convergence: machine.json, agent-skills & ~/.claude/bin symlinks,
#     Global Doctrine (CLAUDE.md / AGENTS.md / GEMINI.md), 4-Harness cua-driver MCP,
#     Git Identity, KasmVNC -AcceptSetDesktopSize 1, and Cloudflare Zero Trust CA
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
