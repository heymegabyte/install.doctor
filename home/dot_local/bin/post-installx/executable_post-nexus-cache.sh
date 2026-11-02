#!/usr/bin/env bash
# @file executable_post-nexus-cache.sh
# @description Configure Sonatype Nexus (nexus.megabyte.space / registry.megabyte.space) as the default
# dependency/cache endpoint for all installed package managers and enforce scoped ~/.cache/megabyte hierarchy (§8 & §9).
set -euo pipefail

log_info() { printf '\033[0;34mINFO\033[0m %s\n' "$*"; }
log_warn() { printf '\033[0;33mWARN\033[0m %s\n' "$*"; }

NEXUS_BASE="${MEGABYTE_NEXUS_URL:-https://nexus.megabyte.space}"
REGISTRY_HOST="${MEGABYTE_REGISTRY_HOST:-https://registry.megabyte.space}"
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/megabyte"
BACKUP_DIR="${CACHE_ROOT}/config-backups/$(date +%Y%m%d-%H%M%S)"

mkdir -p \
  "${CACHE_ROOT}/packages/npm" \
  "${CACHE_ROOT}/packages/pnpm" \
  "${CACHE_ROOT}/packages/yarn" \
  "${CACHE_ROOT}/packages/bun" \
  "${CACHE_ROOT}/packages/pip" \
  "${CACHE_ROOT}/packages/uv" \
  "${CACHE_ROOT}/packages/poetry" \
  "${CACHE_ROOT}/packages/cargo" \
  "${CACHE_ROOT}/packages/gomod" \
  "${CACHE_ROOT}/packages/m2" \
  "${CACHE_ROOT}/packages/gradle" \
  "${CACHE_ROOT}/build/go-build" \
  "${CACHE_ROOT}/build/ccache" \
  "${CACHE_ROOT}/build/sccache" \
  "${CACHE_ROOT}/build/buildkit" \
  "${CACHE_ROOT}/ai/huggingface/hub" \
  "${CACHE_ROOT}/ai/torch" \
  "${CACHE_ROOT}/ai/vllm" \
  "${CACHE_ROOT}/agents/opencode" \
  "${CACHE_ROOT}/agents/claude" \
  "${CACHE_ROOT}/agents/codex" \
  "${CACHE_ROOT}/agents/cua" \
  "$HOME/.config/shell" \
  "$HOME/.local/bin"

backup_if_exists() {
  local target="$1"
  if [[ -f "$target" ]]; then
    mkdir -p "$BACKUP_DIR"
    cp -a "$target" "$BACKUP_DIR/$(basename "$target")"
  fi
}

# 1. Install shell environment file
cat <<'EOF' > "$HOME/.config/shell/megabyte-cache.sh"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export MEGABYTE_CACHE_ROOT="${XDG_CACHE_HOME}/megabyte"
export npm_config_cache="${MEGABYTE_CACHE_ROOT}/packages/npm"
export npm_config_registry="${MEGABYTE_NEXUS_NPM_REGISTRY:-https://nexus.megabyte.space/repository/npm-group/}"
export YARN_CACHE_FOLDER="${MEGABYTE_CACHE_ROOT}/packages/yarn"
export BUN_INSTALL_CACHE_DIR="${MEGABYTE_CACHE_ROOT}/packages/bun"
export PIP_CACHE_DIR="${MEGABYTE_CACHE_ROOT}/packages/pip"
export PIP_INDEX_URL="${MEGABYTE_NEXUS_PYPI_URL:-https://nexus.megabyte.space/repository/pypi-group/simple/}"
export PIP_EXTRA_INDEX_URL="https://pypi.org/simple/"
export UV_CACHE_DIR="${MEGABYTE_CACHE_ROOT}/packages/uv"
export UV_INDEX_URL="${MEGABYTE_NEXUS_PYPI_URL:-https://nexus.megabyte.space/repository/pypi-group/simple}"
export UV_EXTRA_INDEX_URL="https://pypi.org/simple"
export POETRY_CACHE_DIR="${MEGABYTE_CACHE_ROOT}/packages/poetry"
export GOMODCACHE="${MEGABYTE_CACHE_ROOT}/packages/gomod"
export GOPROXY="${MEGABYTE_NEXUS_GOPROXY:-https://nexus.megabyte.space/repository/go-proxy/,https://proxy.golang.org,direct}"
export GRADLE_USER_HOME="${MEGABYTE_CACHE_ROOT}/packages/gradle"
export GOCACHE="${MEGABYTE_CACHE_ROOT}/build/go-build"
export CCACHE_DIR="${MEGABYTE_CACHE_ROOT}/build/ccache"
export SCCACHE_DIR="${MEGABYTE_CACHE_ROOT}/build/sccache"
export HF_HOME="${MEGABYTE_CACHE_ROOT}/ai/huggingface"
export HF_HUB_CACHE="${MEGABYTE_CACHE_ROOT}/ai/huggingface/hub"
export TORCH_HOME="${MEGABYTE_CACHE_ROOT}/ai/torch"
export VLLM_CACHE_ROOT="${MEGABYTE_CACHE_ROOT}/ai/vllm"
export MEGABYTE_AGENT_CACHE_DIR="${MEGABYTE_CACHE_ROOT}/agents"
EOF

for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  if [[ -f "$rc" ]] && ! grep -q "megabyte-cache.sh" "$rc" 2>/dev/null; then
    printf '\n# Megabyte Nexus & Scoped Cache Configuration\n[ -f "$HOME/.config/shell/megabyte-cache.sh" ] && . "$HOME/.config/shell/megabyte-cache.sh"\n' >> "$rc"
  fi
done

# 2. npm / pnpm / yarn / bun
backup_if_exists "$HOME/.npmrc"
touch "$HOME/.npmrc"
python3 - "$HOME/.npmrc" "${NEXUS_BASE}/repository/npm-group/" "${CACHE_ROOT}/packages/npm" "${CACHE_ROOT}/packages/pnpm" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
reg, npm_cache, pnpm_store = sys.argv[2], sys.argv[3], sys.argv[4]
lines = p.read_text().splitlines() if p.exists() else []
filtered = [l for l in lines if not l.startswith(("registry=", "cache=", "store-dir="))]
filtered.extend([
    f"registry={reg}",
    f"cache={npm_cache}",
    f"store-dir={pnpm_store}",
])
p.write_text("\n".join(filtered) + "\n")
PY

backup_if_exists "$HOME/.bunfig.toml"
cat <<EOF > "$HOME/.bunfig.toml"
[install]
registry = "${NEXUS_BASE}/repository/npm-group/"

[install.cache]
dir = "${CACHE_ROOT}/packages/bun"
EOF

# 3. pip & uv
mkdir -p "$HOME/.config/pip" "$HOME/.config/uv"
backup_if_exists "$HOME/.config/pip/pip.conf"
cat <<EOF > "$HOME/.config/pip/pip.conf"
[global]
index-url = ${NEXUS_BASE}/repository/pypi-group/simple/
extra-index-url = https://pypi.org/simple/
trusted-host = nexus.megabyte.space
cache-dir = ${CACHE_ROOT}/packages/pip
timeout = 20
EOF

backup_if_exists "$HOME/.config/uv/uv.toml"
cat <<EOF > "$HOME/.config/uv/uv.toml"
cache-dir = "${CACHE_ROOT}/packages/uv"
index-url = "${NEXUS_BASE}/repository/pypi-group/simple"
extra-index-url = ["https://pypi.org/simple"]
EOF

# 4. Cargo (Rust)
if command -v cargo >/dev/null 2>&1 || [[ -d "$HOME/.cargo" ]]; then
  mkdir -p "$HOME/.cargo"
  backup_if_exists "$HOME/.cargo/config.toml"
  cat <<EOF > "$HOME/.cargo/config.toml"
[source.crates-io]
replace-with = "nexus-Fallback"

[source.nexus]
registry = "sparse+${NEXUS_BASE}/repository/cargo-proxy/"

[source.nexus-Fallback]
registry = "sparse+https://index.crates.io/"

[net]
retry = 3
git-fetch-with-cli = true
EOF
fi

# 5. Go
if command -v go >/dev/null 2>&1; then
  go env -w GOPROXY="${NEXUS_BASE}/repository/go-proxy/,https://proxy.golang.org,direct" || true
  go env -w GOMODCACHE="${CACHE_ROOT}/packages/gomod" || true
  go env -w GOCACHE="${CACHE_ROOT}/build/go-build" || true
fi

# 6. Maven & Gradle
mkdir -p "$HOME/.m2" "$HOME/.gradle"
backup_if_exists "$HOME/.m2/settings.xml"
cat <<EOF > "$HOME/.m2/settings.xml"
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">
  <localRepository>${CACHE_ROOT}/packages/m2</localRepository>
  <mirrors>
    <mirror>
      <id>megabyte-nexus</id>
      <name>Megabyte Nexus Maven Public Group</name>
      <url>${NEXUS_BASE}/repository/maven-public/</url>
      <mirrorOf>central</mirrorOf>
    </mirror>
  </mirrors>
</settings>
EOF

backup_if_exists "$HOME/.gradle/init.gradle"
cat <<EOF > "$HOME/.gradle/init.gradle"
allprojects {
    buildscript {
        repositories {
            maven { url "${NEXUS_BASE}/repository/maven-public/" }
            mavenCentral()
        }
    }
    repositories {
        maven { url "${NEXUS_BASE}/repository/maven-public/" }
        mavenCentral()
    }
}
EOF

# 7. Linux APT & Docker Engine Registry Mirror
if [[ "$(uname -s)" == "Linux" ]]; then
  if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo -n"; fi
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO tee /etc/apt/apt.conf.d/90megabyte-nexus-cache >/dev/null <<EOF || true
Acquire::Retries "3";
Acquire::http::Timeout "15";
Acquire::https::Timeout "15";
Acquire::Queue-Mode "host";
EOF
  fi
  if command -v docker >/dev/null 2>&1 && [[ -d /etc/docker ]]; then
    $SUDO python3 - "$REGISTRY_HOST" <<'PY' || true
import json, pathlib, sys
mirror = sys.argv[1]
p = pathlib.Path("/etc/docker/daemon.json")
data = {}
if p.exists():
    try:
        data = json.loads(p.read_text())
    except Exception:
        data = {}
mirrors = data.get("registry-mirrors", [])
if mirror not in mirrors:
    mirrors.insert(0, mirror)
data["registry-mirrors"] = mirrors
p.write_text(json.dumps(data, indent=2) + "\n")
PY
    $SUDO systemctl reload docker 2>/dev/null || true
  fi
fi

# 8. Cache Pruning & Watermark Maintenance Utility
cat <<'EOF' > "$HOME/.local/bin/megabyte-cache-prune"
#!/usr/bin/env bash
set -euo pipefail
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/megabyte"
MAX_AGE_DAYS="${MEGABYTE_CACHE_MAX_AGE_DAYS:-30}"
if [[ -d "$CACHE_ROOT" ]]; then
  find "$CACHE_ROOT/agents" "$CACHE_ROOT/build" -type f -atime +"$MAX_AGE_DAYS" -delete 2>/dev/null || true
  find "$CACHE_ROOT/packages" -type f -atime +60 -delete 2>/dev/null || true
fi
EOF
chmod +x "$HOME/.local/bin/megabyte-cache-prune"

log_info "Configured Nexus endpoints ($NEXUS_BASE) and local cache hierarchy ($CACHE_ROOT)."
