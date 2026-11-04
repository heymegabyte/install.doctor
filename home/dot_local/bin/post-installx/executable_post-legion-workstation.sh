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

SUDO=""
COOLIFY_KEY="$HOME/legion-provision/private/coolify-legion-ed25519"
if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    SUDO="sudo"
  elif [ -f "$COOLIFY_KEY" ] && ssh -o BatchMode=yes -o ConnectTimeout=3 -i "$COOLIFY_KEY" coolify@127.0.0.1 "sudo -n true" 2>/dev/null; then
    SUDO="coolify-ssh"
  fi
fi

has_root() {
  [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
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
# 1. Eager Base APT Packages (Substrates, GPU/System Monitors, ZFS Sanoid, Media, Editors)
# -----------------------------------------------------------------------------
if command -v apt-get >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
  log "Installing eager foundation packages via APT..."
  run_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq || true
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates curl wget git jq zsh tmux vim neovim ripgrep fd-find fzf bat \
    btop nvtop sanoid flatpak gnome-shell-extension-prefs \
    age build-essential pkg-config libssl-dev unzip xz-utils zstd \
    ffmpeg poppler-utils tesseract-ocr qpdf imagemagick graphviz pandoc \
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
# 4. Tier 1: AI Coding Agents & LSPs (claude, codex, opencode, gemini, agy, LSP servers)
# -----------------------------------------------------------------------------
if command -v npm >/dev/null 2>&1; then
  log "Installing AI coding CLIs and LSP servers via npm..."
  npm install -g \
    @anthropic-ai/claude-code \
    @openai/codex \
    opencode-ai \
    @google/gemini-cli \
    @fission-ai/openspec \
    pnpm \
    typescript \
    typescript-language-server \
    pyright \
    bash-language-server \
    vscode-langservers-extracted \
    yaml-language-server >/dev/null 2>&1 || true
fi

# Ensure ~/.local/bin symlinks for mise-installed npm globals
MISE_NODE_BIN="$(find "$HOME/.local/share/mise/installs/node" -maxdepth 2 -type d -name bin 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$MISE_NODE_BIN" ] && [ -d "$MISE_NODE_BIN" ]; then
  for bin_name in node npm npx claude codex opencode gemini openspec pnpm tsc typescript-language-server pyright bash-language-server yaml-language-server; do
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
  log "Applying workstation sysctl tuning (BBR, fq, vm.swappiness=10)..."
  cat > "$TMP_DIR/99-megabyte-workstation.conf" <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
vm.swappiness = 10
fs.inotify.max_user_watches = 1048576
fs.inotify.max_user_instances = 1024
vm.max_map_count = 1048576
EOF
  run_root cp "$TMP_DIR/99-megabyte-workstation.conf" /etc/sysctl.d/99-megabyte-workstation.conf
  run_root sysctl --system >/dev/null 2>&1 || true
  for epp in /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference; do
    [ -w "$epp" ] && printf 'balance_performance\n' | run_root tee "$epp" >/dev/null 2>&1 || true
  done
fi

# -----------------------------------------------------------------------------
# 6. Tier 4: ZFS Storage Lifecycle (sanoid, monthly scrub, atime=off, rpool/ai-models)
# -----------------------------------------------------------------------------
if command -v zfs >/dev/null 2>&1 && { [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; }; then
  log "Configuring ZFS datasets, atime=off, sanoid snapshots, and monthly scrub timers..."
  run_root zfs set atime=off rpool >/dev/null 2>&1 || true

  # Create rpool/ai-models with recordsize=1M for large sequential LLM/GGUF weight reads
  if ! zfs list rpool/ai-models >/dev/null 2>&1; then
    run_root zfs create -o recordsize=1M -o compression=zstd -o atime=off -o mountpoint=/var/lib/ai-models rpool/ai-models >/dev/null 2>&1 || true
  fi

  # Configure sanoid policy for rpool datasets
  run_root mkdir -p /etc/sanoid
  ROOT_DS="$(zfs list -H -o name / 2>/dev/null | tr -d ' ' || echo rpool/ROOT/ubuntu)"
  HOME_DS="$(zfs list -H -o name /home 2>/dev/null | tr -d ' ' || echo rpool/home)"
  cat > "$TMP_DIR/sanoid.conf" <<EOF
[${ROOT_DS}]
  use_template = workstation
  recursive = yes

[${HOME_DS}]
  use_template = workstation
  recursive = yes

[template_workstation]
  frequently = 0
  hourly = 24
  daily = 14
  monthly = 3
  yearly = 0
  autosnap = yes
  autoclean = yes
EOF
  run_root cp "$TMP_DIR/sanoid.conf" /etc/sanoid/sanoid.conf
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
# 8. Build CNF Index & Non-Interactive Lazy CLI Shims (~/.cache/cnf/shims)
# -----------------------------------------------------------------------------
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
