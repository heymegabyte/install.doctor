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

TMP_DIR="$(mktemp -d)"
chmod 0755 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR" 2>/dev/null || true' EXIT

# -----------------------------------------------------------------------------
# 0. Completely remove Superset across all platforms
# -----------------------------------------------------------------------------
if [ "$(uname -s)" = "Darwin" ]; then
  if command -v brew >/dev/null 2>&1 && brew list --cask superset >/dev/null 2>&1; then
    log "Removing Superset cask on macOS..."
    brew uninstall --cask --zap superset >/dev/null 2>&1 || brew uninstall --cask superset >/dev/null 2>&1 || true
  fi
  rm -rf "/Applications/Superset.app" \
    "$HOME/Library/Application Support/Superset" \
    "$HOME/Library/Caches/com.superset.desktop" \
    "$HOME/Library/HTTPStorages/com.superset.desktop" \
    "$HOME/Library/Logs/Superset" \
    "$HOME/Library/Preferences/com.superset.desktop.plist" \
    "$HOME/Library/Saved Application State/com.superset.desktop.savedState" \
    "$HOME/.superset" 2>/dev/null || true
else
  rm -rf "$HOME/.superset" "$HOME/.config/Superset" "$HOME/.local/share/Superset" "$HOME/.local/bin/superset" 2>/dev/null || true
fi

# Exit cleanly on macOS after Superset removal + CNF shims refresh
if [ "$(uname -s)" != "Linux" ]; then
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
cred_path = Path(cfg.get("credentialsFile", str(Path.home() / ".config/agent-fleet/infisical-credentials.json"))).expanduser()
creds = json.loads(cred_path.read_text())
base = cfg["url"].rstrip("/")
req = Request(f"{base}/api/v1/auth/universal-auth/login", data=json.dumps(creds).encode(), headers={"Content-Type": "application/json"})
with urlopen(req, timeout=10) as resp:
    tok = json.load(resp)["accessToken"]
q = urlencode({"projectId": cfg["projectId"], "environment": cfg.get("environment", "prod"), "secretPath": cfg.get("secretPath", "/"), "type": "shared"})
req2 = Request(f"{base}/api/v4/secrets/SUDO_PASSWORD?{q}", headers={"Authorization": f"Bearer {tok}"})
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
# 1. Eager Base APT Packages (Substrates, GPU/System Monitors, ZFS Sanoid, Media, Editors, Fleet Tools)
# -----------------------------------------------------------------------------
if command -v apt-get >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
  log "Installing eager foundation packages via APT..."
  run_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates curl wget git jq zsh tmux vim neovim ripgrep fd-find fzf bat \
    htop btop nvtop ncdu gh rclone restic sanoid lzop pv mbuffer flatpak gnome-shell-extension-prefs \
    age build-essential pkg-config libssl-dev unzip xz-utils zstd \
    ffmpeg poppler-utils tesseract-ocr qpdf imagemagick graphviz pandoc \
    smartmontools lynis just yt-dlp pipx net-tools bind9-dnsutils fail2ban ufw unattended-upgrades apt-listchanges \
    lm-sensors i2c-tools dkms python3-yaml python3-pip python3-venv >/dev/null 2>&1 || true
fi

# Symlink Ubuntu's fdfind -> fd and batcat -> bat in ~/.local/bin
if command -v fdfind >/dev/null 2>&1 && ! command -v fd >/dev/null 2>&1; then
  ln -sf "$(command -v fdfind)" "$HOME/.local/bin/fd"
fi
if command -v batcat >/dev/null 2>&1 && ! command -v bat >/dev/null 2>&1; then
  ln -sf "$(command -v batcat)" "$HOME/.local/bin/bat"
fi

# Install actionlint if missing
if ! command -v actionlint >/dev/null 2>&1; then
  log "Installing actionlint..."
  AL_VER="1.7.7"
  if curl -fsSL "https://github.com/rhysd/actionlint/releases/download/v${AL_VER}/actionlint_${AL_VER}_linux_amd64.tar.gz" -o "$TMP_DIR/actionlint.tar.gz"; then
    tar -xzf "$TMP_DIR/actionlint.tar.gz" -C "$TMP_DIR" actionlint 2>/dev/null || true
    if [ -f "$TMP_DIR/actionlint" ]; then
      mv "$TMP_DIR/actionlint" "$HOME/.local/bin/actionlint"
      chmod +x "$HOME/.local/bin/actionlint"
    fi
  fi
fi

# -----------------------------------------------------------------------------
# 2. Bootstrap & Runtime Substrates (chezmoi, task, gum, yq, mise, node, bun, deno, uv, go, rust)
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

if ! command -v ruff >/dev/null 2>&1; then
  log "Installing ruff..."
  if command -v uv >/dev/null 2>&1; then
    UV_INSECURE_HOST="127.0.0.1:4880" uv tool install ruff >/dev/null 2>&1 || true
  fi
  if ! command -v ruff >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/ruff/install.sh | env RUFF_INSTALL_DIR="$HOME/.local/bin" sh >/dev/null 2>&1 || true
  fi
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

if ! command -v deno >/dev/null 2>&1; then
  log "Installing deno..."
  curl -fsSL https://deno.land/install.sh | sh -s -- -y --no-modify-path >/dev/null 2>&1 || true
  if [ -x "$HOME/.deno/bin/deno" ]; then
    ln -sf "$HOME/.deno/bin/deno" "$HOME/.local/bin/deno"
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
    curl -fsSL "https://github.com/romkatv/powerlevel10k-media/raw/master/MesloLGS%20NF%20${style}.ttf" -o "$FONT_DIR/$fname" || true
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
# 7. Tier 7: Flatpak + Flathub, VS Code, Emdash, GNOME Clipboard & Orphaned xfce4 Cleanup
# -----------------------------------------------------------------------------
if command -v flatpak >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
  run_root flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo >/dev/null 2>&1 || true
fi

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

# Purge orphaned xfce4-* packages on GNOME 50 loopback hosts
if [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; then
  if dpkg -l 2>/dev/null | grep -q '^ii  xfce4-session'; then
    log "Purging orphaned xfce4-* / thunar desktop packages (live GNOME 50 loopback preserved)..."
    XDG_RUNTIME_DIR="/run/user/$(id -u)" systemctl --user stop thunar.service >/dev/null 2>&1 || true
    run_root env DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq \
      'xfce4-*' 'libxfce4*' 'xfconf*' 'xfdesktop4*' 'xfwm4*' 'thunar*' 'exo-utils' >/dev/null 2>&1 || true
    run_root env DEBIAN_FRONTEND=noninteractive apt-get autoremove -y -qq >/dev/null 2>&1 || true
  fi
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
  for bin_name in \
    rg tmux jq fzf fd bat htop btop ncdu gh rclone restic age sops yq \
    uv uvx ruff bun bunx pnpm deno node npm npx go gofmt cargo rustc \
    cloudflared warp-cli claude codex opencode gemini openspec \
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
