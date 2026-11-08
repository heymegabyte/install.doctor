#!/usr/bin/env bash
# @file executable_post-nexus-cache.sh
# @description Provision the 3-tier pass-through caching proxy architecture:
#   Tier 1: Local loopback caching proxy daemon (http://127.0.0.1:4880, ~/.cache/megabyte/local-proxy)
#   Tier 2: Central fleet Sonatype Nexus pass-through proxy (https://nexus.megabyte.space / https://registry.megabyte.space)
#   Tier 3: Canonical upstream registries (npmjs.org, pypi.org, proxy.golang.org, crates.io, maven.org, archive.ubuntu.com)
set -euo pipefail

log_info() { printf '\033[0;34mINFO\033[0m %s\n' "$*"; }
log_warn() { printf '\033[0;33mWARN\033[0m %s\n' "$*"; }

if [[ "${INSTALL_DOCTOR_NEXUS_CACHE:-0}" != "1" ]]; then
  log_info "Nexus/local proxy integration is lazy; set INSTALL_DOCTOR_NEXUS_CACHE=1 to configure it."
  exit 0
fi

LOCAL_PROXY_HOST="127.0.0.1"
LOCAL_PROXY_PORT="${MEGABYTE_LOCAL_PROXY_PORT:-4880}"
LOCAL_PROXY_BASE="http://${LOCAL_PROXY_HOST}:${LOCAL_PROXY_PORT}"
NEXUS_BASE="${MEGABYTE_NEXUS_URL:-https://nexus.megabyte.space}"
REGISTRY_HOST="${MEGABYTE_REGISTRY_HOST:-https://registry.megabyte.space}"
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/megabyte"
BACKUP_DIR="${CACHE_ROOT}/config-backups/$(date +%Y%m%d-%H%M%S)"

mkdir -p \
  "${CACHE_ROOT}/local-proxy/blobs" \
  "${CACHE_ROOT}/local-proxy/meta" \
  "${CACHE_ROOT}/local-proxy/logs" \
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
  "$HOME/.config/npm" \
  "$HOME/.config/maven" \
  "$HOME/.local/share/cargo" \
  "$HOME/.local/share/gradle" \
  "$HOME/.local/bin"

backup_if_exists() {
  local target="$1"
  if [[ -f "$target" ]]; then
    mkdir -p "$BACKUP_DIR"
    cp -a "$target" "$BACKUP_DIR/$(basename "$target").$(cksum "$target" | awk '{print $1}')"
  fi
}

# 1. Install the Tier-1 Local Loopback Pass-Through Caching Proxy (megabyte-local-proxy)
cat <<'PYEOF' > "$HOME/.local/bin/megabyte-local-proxy"
#!/usr/bin/env python3
"""
Megabyte Tier-1 Local Loopback Pass-Through Caching Proxy (127.0.0.1:4880).
Combines a local on-machine disk cache (~/.cache/megabyte/local-proxy) with automatic
pass-through to Sonatype Nexus (https://nexus.megabyte.space) and instant failover to
canonical upstream registries (npmjs.org, pypi.org, proxy.golang.org, crates.io, maven.org, ubuntu.com).
Exposes /healthz, /stats (JSON), and /metrics (Prometheus).
"""
import gzip
import hashlib
import http.server
import json
import os
import pathlib
import socketserver
import ssl
import tempfile
import threading
import time
import urllib.error
import urllib.request

HOST = os.environ.get("MEGABYTE_LOCAL_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("MEGABYTE_LOCAL_PROXY_PORT", "4880"))
LOCAL_BASE = f"http://{HOST}:{PORT}"
NEXUS_BASE = os.environ.get("MEGABYTE_NEXUS_URL", "https://nexus.megabyte.space").rstrip("/")
CACHE_ROOT = pathlib.Path(
    os.environ.get("MEGABYTE_CACHE_ROOT", os.path.expanduser("~/.cache/megabyte"))
) / "local-proxy"
BLOBS_DIR = CACHE_ROOT / "blobs"
META_DIR = CACHE_ROOT / "meta"
META_FRESH_TTL_SEC = int(os.environ.get("MEGABYTE_LOCAL_PROXY_META_TTL", "300"))
START_TIME = time.time()

BLOBS_DIR.mkdir(parents=True, exist_ok=True)
META_DIR.mkdir(parents=True, exist_ok=True)

STATS_LOCK = threading.Lock()
STATS = {
    "HIT-LOCAL": 0,
    "HIT-LOCAL-META": 0,
    "HIT-LOCAL-STALE": 0,
    "HIT-LOCAL-CARGO-CONFIG": 0,
    "MISS-VIA-NEXUS": 0,
    "MISS-VIA-UPSTREAM": 0,
    "MISS-ERROR": 0,
    "bytes_served_local": 0,
    "bytes_served_remote": 0,
    "by_repo": {},
}


def record_stat(cache_hdr: str, repo: str = None, num_bytes: int = 0):
    with STATS_LOCK:
        if cache_hdr in STATS:
            STATS[cache_hdr] += 1
        if cache_hdr.startswith("HIT-"):
            STATS["bytes_served_local"] += num_bytes
        elif cache_hdr.startswith("MISS-VIA-"):
            STATS["bytes_served_remote"] += num_bytes
        if repo:
            r = STATS["by_repo"].setdefault(repo, {"hits": 0, "misses": 0, "bytes": 0})
            if cache_hdr.startswith("HIT-"):
                r["hits"] += 1
            elif cache_hdr.startswith("MISS-"):
                r["misses"] += 1
            r["bytes"] += num_bytes


UPSTREAM_MAP = {
    "npm-group": "https://registry.npmjs.org",
    "npm-proxy": "https://registry.npmjs.org",
    "pypi-group": "https://pypi.org",
    "pypi-proxy": "https://pypi.org",
    "pypi-files": "https://files.pythonhosted.org",
    "go-proxy": "https://proxy.golang.org",
    "cargo-proxy": "https://index.crates.io",
    "cargo-crates-proxy": "https://static.crates.io",
    "maven-public": "https://repo1.maven.org/maven2",
    "maven-central": "https://repo1.maven.org/maven2",
    "nuget-group": "https://api.nuget.org",
    "apt-ubuntu-proxy": "http://archive.ubuntu.com/ubuntu",
    "apt-security-proxy": "http://security.ubuntu.com/ubuntu",
    "huggingface-proxy": "https://huggingface.co",
    "github-releases-proxy": "https://github.com",
}

IMMUTABLE_SUFFIXES = (
    ".tgz",
    ".tar.gz",
    ".whl",
    ".zip",
    ".jar",
    ".pom",
    ".crate",
    ".deb",
    ".udeb",
    ".nupkg",
    ".xz",
    ".gz",
    ".bz2",
    ".zst",
    ".mod",
    ".safetensors",
    ".gguf",
)


def is_immutable_artifact(repo: str, rest: str) -> bool:
    clean = rest.split("?", 1)[0].lower()
    if repo in ("pypi-files", "cargo-crates-proxy"):
        return True
    if clean.endswith(IMMUTABLE_SUFFIXES):
        if clean.endswith(("packages.gz", "packages.xz", "contents-amd64.gz", "by-hash")):
            return False
        return True
    if "/-/" in clean or "/packages/" in clean or ("/@v/" in clean and not clean.endswith(".info")):
        return True
    if "/by-hash/" in clean or "/pool/" in clean:
        return True
    return False


def cache_paths(base_dir: pathlib.Path, key: str):
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    sub = base_dir / digest[:2]
    sub.mkdir(parents=True, exist_ok=True)
    return sub / f"{digest}.bin", sub / f"{digest}.hdr.json"


def atomic_write(path: pathlib.Path, data: bytes):
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def rewrite_metadata(repo: str, rest: str, content_type: str, body: bytes) -> bytes:
    ct = (content_type or "").lower()
    if repo in ("npm-group", "npm-proxy") and ("json" in ct or not is_immutable_artifact(repo, rest)):
        try:
            text = body.decode("utf-8")
            text = text.replace(f"{NEXUS_BASE}/repository/npm-group/", f"{LOCAL_BASE}/repository/npm-group/")
            text = text.replace(f"{NEXUS_BASE}/repository/npm-proxy/", f"{LOCAL_BASE}/repository/npm-group/")
            text = text.replace("https://registry.npmjs.org/", f"{LOCAL_BASE}/repository/npm-group/")
            return text.encode("utf-8")
        except UnicodeDecodeError:
            return body
    if repo in ("pypi-group", "pypi-proxy") and ("html" in ct or "json" in ct or "simple" in rest):
        try:
            text = body.decode("utf-8")
            text = text.replace(f"{NEXUS_BASE}/repository/pypi-group/", f"{LOCAL_BASE}/repository/pypi-group/")
            text = text.replace(f"{NEXUS_BASE}/repository/pypi-proxy/", f"{LOCAL_BASE}/repository/pypi-group/")
            text = text.replace("https://files.pythonhosted.org/", f"{LOCAL_BASE}/pypi-files/")
            return text.encode("utf-8")
        except UnicodeDecodeError:
            return body
    return body


def fetch_remote(url: str, req_headers: dict, timeout: int = 20):
    headers = {"User-Agent": req_headers.get("User-Agent", "MegabyteLocalProxy/1.0")}
    for h in ("Accept", "Npm-Scope", "Npm-Session", "Pacote-Version", "Pacote-Req-Type", "Pacote-Pkg-Id"):
        if h in req_headers:
            headers[h] = req_headers[h]
    headers["Accept-Encoding"] = "identity"
    req = urllib.request.Request(url, headers=headers, method="GET")
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding", "").lower() == "gzip":
            raw = gzip.decompress(raw)
        ct = resp.headers.get("Content-Type", "application/octet-stream")
        return resp.status, ct, raw


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def _send(self, status: int, content_type: str, body: bytes, cache_hdr: str, head_only: bool = False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Megabyte-Cache", cache_hdr)
        self.send_header("Connection", "close")
        self.end_headers()
        if not head_only and body:
            try:
                self.wfile.write(body)
            except BrokenPipeError:
                pass

    def do_HEAD(self):
        self._handle(head_only=True)

    def do_GET(self):
        self._handle(head_only=False)

    def _handle(self, head_only: bool):
        raw_path = self.path
        if raw_path == "/healthz":
            payload = json.dumps(
                {
                    "status": "ok",
                    "local_proxy": LOCAL_BASE,
                    "nexus_upstream": NEXUS_BASE,
                    "cache_root": str(CACHE_ROOT),
                }
            ).encode("utf-8")
            self._send(200, "application/json", payload, "LOCAL-HEALTHZ", head_only)
            return

        if raw_path == "/stats":
            with STATS_LOCK:
                total_hits = (
                    STATS["HIT-LOCAL"]
                    + STATS["HIT-LOCAL-META"]
                    + STATS["HIT-LOCAL-STALE"]
                    + STATS["HIT-LOCAL-CARGO-CONFIG"]
                )
                total_misses = STATS["MISS-VIA-NEXUS"] + STATS["MISS-VIA-UPSTREAM"]
                total_reqs = total_hits + total_misses
                hit_ratio = round(total_hits / total_reqs, 4) if total_reqs > 0 else 0.0
                snap = {
                    "status": "ok",
                    "uptime_seconds": round(time.time() - START_TIME, 1),
                    "total_requests": total_reqs,
                    "total_hits": total_hits,
                    "total_misses": total_misses,
                    "hit_ratio": hit_ratio,
                    "counters": {k: v for k, v in STATS.items() if k != "by_repo"},
                    "by_repo": STATS["by_repo"],
                }
            payload = json.dumps(snap, indent=2).encode("utf-8")
            self._send(200, "application/json", payload, "LOCAL-STATS", head_only)
            return

        if raw_path == "/metrics":
            with STATS_LOCK:
                lines = [
                    "# HELP megabyte_local_proxy_requests_total Total proxy requests by cache result",
                    "# TYPE megabyte_local_proxy_requests_total counter",
                ]
                for key in (
                    "HIT-LOCAL",
                    "HIT-LOCAL-META",
                    "HIT-LOCAL-STALE",
                    "HIT-LOCAL-CARGO-CONFIG",
                    "MISS-VIA-NEXUS",
                    "MISS-VIA-UPSTREAM",
                    "MISS-ERROR",
                ):
                    lines.append(f'megabyte_local_proxy_requests_total{{result="{key}"}} {STATS[key]}')
                lines.append("# HELP megabyte_local_proxy_bytes_total Total bytes served by source")
                lines.append("# TYPE megabyte_local_proxy_bytes_total counter")
                lines.append(f'megabyte_local_proxy_bytes_total{{source="local"}} {STATS["bytes_served_local"]}')
                lines.append(f'megabyte_local_proxy_bytes_total{{source="remote"}} {STATS["bytes_served_remote"]}')
            payload = ("\n".join(lines) + "\n").encode("utf-8")
            self._send(200, "text/plain; version=0.0.4", payload, "LOCAL-METRICS", head_only)
            return

        repo = None
        rest = ""
        if raw_path.startswith("/pypi-files/"):
            repo = "pypi-files"
            rest = raw_path[len("/pypi-files/"):]
        elif raw_path.startswith("/repository/"):
            parts = raw_path[len("/repository/"):].split("/", 1)
            repo = parts[0]
            rest = parts[1] if len(parts) > 1 else ""
        else:
            self._send(404, "text/plain", b"Not Found\n", "MISS", head_only)
            return

        if repo == "cargo-proxy" and rest.split("?", 1)[0] == "config.json":
            cfg = json.dumps(
                {
                    "dl": f"{LOCAL_BASE}/repository/cargo-crates-proxy/crates/{{crate}}/{{crate}}-{{version}}.crate",
                    "api": "https://crates.io",
                }
            ).encode("utf-8")
            record_stat("HIT-LOCAL-CARGO-CONFIG", repo, len(cfg))
            self._send(200, "application/json", cfg, "HIT-LOCAL-CARGO-CONFIG", head_only)
            return

        accept_hdr = self.headers.get("Accept", "")
        cache_key = f"{repo}/{rest}|accept={accept_hdr if 'npm' in repo or 'pypi' in repo else ''}"
        immutable = is_immutable_artifact(repo, rest)
        blob_file, hdr_file = cache_paths(BLOBS_DIR if immutable else META_DIR, cache_key)

        if immutable and blob_file.exists() and hdr_file.exists():
            try:
                meta = json.loads(hdr_file.read_text())
                data = blob_file.read_bytes()
                record_stat("HIT-LOCAL", repo, len(data))
                self._send(200, meta.get("content_type", "application/octet-stream"), data, "HIT-LOCAL", head_only)
                return
            except Exception:
                pass
        elif not immutable and blob_file.exists() and hdr_file.exists():
            try:
                meta = json.loads(hdr_file.read_text())
                if time.time() - meta.get("ts", 0) < META_FRESH_TTL_SEC:
                    data = blob_file.read_bytes()
                    record_stat("HIT-LOCAL-META", repo, len(data))
                    self._send(200, meta.get("content_type", "application/json"), data, "HIT-LOCAL-META", head_only)
                    return
            except Exception:
                pass

        candidates = []
        if repo != "pypi-files":
            candidates.append(("MISS-VIA-NEXUS", f"{NEXUS_BASE}/repository/{repo}/{rest}"))
        if repo in UPSTREAM_MAP:
            upstream_base = UPSTREAM_MAP[repo].rstrip("/")
            candidates.append(("MISS-VIA-UPSTREAM", f"{upstream_base}/{rest}"))

        last_status = 502
        last_body = b"Bad Gateway\n"
        for tag, target_url in candidates:
            try:
                st, ct, body = fetch_remote(target_url, dict(self.headers))
                if st == 200:
                    rewritten = rewrite_metadata(repo, rest, ct, body)
                    atomic_write(blob_file, rewritten)
                    atomic_write(
                        hdr_file,
                        json.dumps({"content_type": ct, "ts": time.time(), "source": tag}).encode("utf-8"),
                    )
                    record_stat(tag, repo, len(rewritten))
                    self._send(200, ct, rewritten, tag, head_only)
                    return
                last_status = st
            except urllib.error.HTTPError as e:
                last_status = e.code
                try:
                    last_body = e.read()
                except Exception:
                    pass
                continue
            except Exception:
                continue

        if blob_file.exists() and hdr_file.exists():
            try:
                meta = json.loads(hdr_file.read_text())
                data = blob_file.read_bytes()
                record_stat("HIT-LOCAL-STALE", repo, len(data))
                self._send(200, meta.get("content_type", "application/octet-stream"), data, "HIT-LOCAL-STALE", head_only)
                return
            except Exception:
                pass

        record_stat("MISS-ERROR", repo, 0)
        self._send(last_status, "text/plain", last_body, "MISS-ERROR", head_only)


if __name__ == "__main__":
    srv = ThreadedHTTPServer((HOST, PORT), ProxyHandler)
    srv.serve_forever()
PYEOF
chmod +x "$HOME/.local/bin/megabyte-local-proxy"

# 2. Ensure megabyte-local-proxy runs as an always-on local daemon (macOS LaunchAgent / Linux systemd)
if [[ "$(uname -s)" == "Darwin" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  PLIST="$HOME/Library/LaunchAgents/space.megabyte.local-proxy.plist"
  cat <<EOF > "$PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>space.megabyte.local-proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>${HOME}/.local/bin/megabyte-local-proxy</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MEGABYTE_CACHE_ROOT</key>
    <string>${CACHE_ROOT}</string>
    <key>MEGABYTE_NEXUS_URL</key>
    <string>${NEXUS_BASE}</string>
    <key>MEGABYTE_LOCAL_PROXY_PORT</key>
    <string>${LOCAL_PROXY_PORT}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${CACHE_ROOT}/local-proxy/logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${CACHE_ROOT}/local-proxy/logs/stderr.log</string>
</dict>
</plist>
EOF
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load -w "$PLIST" >/dev/null 2>&1 || true
elif [[ "$(uname -s)" == "Linux" ]]; then
  if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo -n"; fi
  if $SUDO true 2>/dev/null; then
    $SUDO tee /etc/systemd/system/megabyte-local-proxy.service >/dev/null <<EOF
[Unit]
Description=Megabyte Tier-1 Local Loopback Pass-Through Caching Proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${USER:-$(id -un)}
Environment=HOME=${HOME}
Environment=MEGABYTE_CACHE_ROOT=${CACHE_ROOT}
Environment=MEGABYTE_NEXUS_URL=${NEXUS_BASE}
Environment=MEGABYTE_LOCAL_PROXY_PORT=${LOCAL_PROXY_PORT}
Environment=MALLOC_TRIM_THRESHOLD_=65536
ExecStart=/usr/bin/python3 ${HOME}/.local/bin/megabyte-local-proxy
MemoryHigh=256M
MemoryMax=512M
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable --now megabyte-local-proxy.service
    $SUDO systemctl restart megabyte-local-proxy.service
  else
    mkdir -p "$HOME/.config/systemd/user"
    cat <<EOF > "$HOME/.config/systemd/user/megabyte-local-proxy.service"
[Unit]
Description=Megabyte Tier-1 Local Loopback Pass-Through Caching Proxy
After=network.target

[Service]
Type=simple
Environment=MEGABYTE_CACHE_ROOT=${CACHE_ROOT}
Environment=MEGABYTE_NEXUS_URL=${NEXUS_BASE}
Environment=MEGABYTE_LOCAL_PROXY_PORT=${LOCAL_PROXY_PORT}
Environment=MALLOC_TRIM_THRESHOLD_=65536
ExecStart=/usr/bin/python3 ${HOME}/.local/bin/megabyte-local-proxy
MemoryHigh=256M
MemoryMax=512M
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload 2>/dev/null || true
    systemctl --user enable --now megabyte-local-proxy.service 2>/dev/null || true
  fi
fi

for _ in {1..15}; do
  if curl -fsS "${LOCAL_PROXY_BASE}/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
done
if ! curl -fsS "${LOCAL_PROXY_BASE}/healthz" >/dev/null 2>&1; then
  nohup /usr/bin/python3 "$HOME/.local/bin/megabyte-local-proxy" >/dev/null 2>&1 &
  sleep 0.5
fi

# 3. Install shell environment file
cat <<EOF > "$HOME/.config/shell/megabyte-cache.sh"
export XDG_CACHE_HOME="\${XDG_CACHE_HOME:-\$HOME/.cache}"
export MEGABYTE_CACHE_ROOT="\${XDG_CACHE_HOME}/megabyte"
export MEGABYTE_LOCAL_PROXY_URL="\${MEGABYTE_LOCAL_PROXY_URL:-${LOCAL_PROXY_BASE}}"
export MEGABYTE_NEXUS_URL="\${MEGABYTE_NEXUS_URL:-${NEXUS_BASE}}"
export npm_config_cache="\${MEGABYTE_CACHE_ROOT}/packages/npm"
export npm_config_registry="\${MEGABYTE_NEXUS_NPM_REGISTRY:-\${MEGABYTE_LOCAL_PROXY_URL}/repository/npm-group/}"
export YARN_CACHE_FOLDER="\${MEGABYTE_CACHE_ROOT}/packages/yarn"
export BUN_INSTALL_CACHE_DIR="\${MEGABYTE_CACHE_ROOT}/packages/bun"
export PIP_CACHE_DIR="\${MEGABYTE_CACHE_ROOT}/packages/pip"
export PIP_INDEX_URL="\${MEGABYTE_NEXUS_PYPI_URL:-\${MEGABYTE_LOCAL_PROXY_URL}/repository/pypi-group/simple/}"
export PIP_EXTRA_INDEX_URL="\${MEGABYTE_NEXUS_URL}/repository/pypi-group/simple/ https://pypi.org/simple/"
export PIP_TRUSTED_HOST="127.0.0.1 nexus.megabyte.space"
export UV_CACHE_DIR="\${MEGABYTE_CACHE_ROOT}/packages/uv"
export UV_INDEX_URL="\${MEGABYTE_NEXUS_PYPI_URL:-\${MEGABYTE_LOCAL_PROXY_URL}/repository/pypi-group/simple}"
export UV_EXTRA_INDEX_URL="\${MEGABYTE_NEXUS_URL}/repository/pypi-group/simple https://pypi.org/simple"
export UV_INSECURE_HOST="127.0.0.1:${LOCAL_PROXY_PORT}"
export POETRY_CACHE_DIR="\${MEGABYTE_CACHE_ROOT}/packages/poetry"
export GOMODCACHE="\${MEGABYTE_CACHE_ROOT}/packages/gomod"
export GOPROXY="\${MEGABYTE_NEXUS_GOPROXY:-\${MEGABYTE_LOCAL_PROXY_URL}/repository/go-proxy/,\${MEGABYTE_NEXUS_URL}/repository/go-proxy/,https://proxy.golang.org,direct}"
export GRADLE_USER_HOME="\${MEGABYTE_CACHE_ROOT}/packages/gradle"
export GOCACHE="\${MEGABYTE_CACHE_ROOT}/build/go-build"
export CCACHE_DIR="\${MEGABYTE_CACHE_ROOT}/build/ccache"
export SCCACHE_DIR="\${MEGABYTE_CACHE_ROOT}/build/sccache"
export HF_HOME="\${MEGABYTE_CACHE_ROOT}/ai/huggingface"
export HF_HUB_CACHE="\${MEGABYTE_CACHE_ROOT}/ai/huggingface/hub"
export TORCH_HOME="\${MEGABYTE_CACHE_ROOT}/ai/torch"
export VLLM_CACHE_ROOT="\${MEGABYTE_CACHE_ROOT}/ai/vllm"
export MEGABYTE_AGENT_CACHE_DIR="\${MEGABYTE_CACHE_ROOT}/agents"
EOF

for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  if [[ -f "$rc" ]] && ! grep -q "megabyte-cache.sh" "$rc" 2>/dev/null; then
    printf '\n# Megabyte Nexus & Scoped Cache Configuration\n[ -f "$HOME/.config/shell/megabyte-cache.sh" ] && . "$HOME/.config/shell/megabyte-cache.sh"\n' >> "$rc"
  fi
done

# 4. npm / pnpm / yarn / bun (both ~/.npmrc and XDG ~/.config/npm/npmrc)
for npmrc_target in "$HOME/.npmrc" "$HOME/.config/npm/npmrc"; do
  backup_if_exists "$npmrc_target"
  touch "$npmrc_target"
  python3 - "$npmrc_target" "${LOCAL_PROXY_BASE}/repository/npm-group/" "${CACHE_ROOT}/packages/npm" "${CACHE_ROOT}/packages/pnpm" <<'PY'
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
done

backup_if_exists "$HOME/.bunfig.toml"
cat <<EOF > "$HOME/.bunfig.toml"
[install]
registry = "${LOCAL_PROXY_BASE}/repository/npm-group/"

[install.cache]
dir = "${CACHE_ROOT}/packages/bun"
EOF

# 5. pip & uv (3-tier: local-proxy -> nexus.megabyte.space -> pypi.org)
mkdir -p "$HOME/.config/pip" "$HOME/.config/uv"
backup_if_exists "$HOME/.config/pip/pip.conf"
cat <<EOF > "$HOME/.config/pip/pip.conf"
[global]
index-url = ${LOCAL_PROXY_BASE}/repository/pypi-group/simple/
extra-index-url =
    ${NEXUS_BASE}/repository/pypi-group/simple/
    https://pypi.org/simple/
trusted-host =
    127.0.0.1
    nexus.megabyte.space
cache-dir = ${CACHE_ROOT}/packages/pip
timeout = 20
EOF

backup_if_exists "$HOME/.config/uv/uv.toml"
cat <<EOF > "$HOME/.config/uv/uv.toml"
cache-dir = "${CACHE_ROOT}/packages/uv"
index-url = "${LOCAL_PROXY_BASE}/repository/pypi-group/simple"
extra-index-url = ["${NEXUS_BASE}/repository/pypi-group/simple", "https://pypi.org/simple"]
allow-insecure-host = ["127.0.0.1:${LOCAL_PROXY_PORT}", "127.0.0.1"]
EOF

# 6. Cargo (Rust) — both ~/.cargo/config.toml and XDG ~/.local/share/cargo/config.toml
for cargo_dir in "$HOME/.cargo" "$HOME/.local/share/cargo"; do
  mkdir -p "$cargo_dir"
  backup_if_exists "$cargo_dir/config.toml"
  cat <<EOF > "$cargo_dir/config.toml"
[source.crates-io]
replace-with = "megabyte-local"

[source.megabyte-local]
registry = "sparse+${LOCAL_PROXY_BASE}/repository/cargo-proxy/"

[source.nexus]
registry = "sparse+${NEXUS_BASE}/repository/cargo-proxy/"

[source.crates-io-upstream]
registry = "sparse+https://index.crates.io/"

[net]
retry = 3
git-fetch-with-cli = true
EOF
done

# 7. Go (3-tier GOPROXY chain: local-proxy -> nexus.megabyte.space -> proxy.golang.org -> direct)
if command -v go >/dev/null 2>&1; then
  go env -w GOPROXY="${LOCAL_PROXY_BASE}/repository/go-proxy/,${NEXUS_BASE}/repository/go-proxy/,https://proxy.golang.org,direct" || true
  go env -w GOMODCACHE="${CACHE_ROOT}/packages/gomod" || true
  go env -w GOCACHE="${CACHE_ROOT}/build/go-build" || true
fi

# 8. Maven & Gradle (both standard and XDG paths)
for m2_file in "$HOME/.m2/settings.xml" "$HOME/.config/maven/settings.xml"; do
  mkdir -p "$(dirname "$m2_file")"
  backup_if_exists "$m2_file"
  cat <<EOF > "$m2_file"
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">
  <localRepository>${CACHE_ROOT}/packages/m2</localRepository>
  <mirrors>
    <mirror>
      <id>megabyte-local-nexus</id>
      <name>Megabyte 3-Tier Local + Nexus Maven Public Group</name>
      <url>${LOCAL_PROXY_BASE}/repository/maven-public/</url>
      <mirrorOf>central</mirrorOf>
    </mirror>
  </mirrors>
</settings>
EOF
done

for gradle_file in "$HOME/.gradle/init.gradle" "$HOME/.local/share/gradle/init.gradle" "${CACHE_ROOT}/packages/gradle/init.gradle"; do
  mkdir -p "$(dirname "$gradle_file")"
  backup_if_exists "$gradle_file"
  cat <<EOF > "$gradle_file"
allprojects {
    buildscript {
        repositories {
            maven { allowInsecureProtocol = true; url "${LOCAL_PROXY_BASE}/repository/maven-public/" }
            maven { url "${NEXUS_BASE}/repository/maven-public/" }
            mavenCentral()
        }
    }
    repositories {
        maven { allowInsecureProtocol = true; url "${LOCAL_PROXY_BASE}/repository/maven-public/" }
        maven { url "${NEXUS_BASE}/repository/maven-public/" }
        mavenCentral()
    }
}
EOF
done

# 9. Docker Registry Mirror (Linux /etc/docker/daemon.json & macOS ~/.docker/daemon.json + ~/.config/docker/daemon.json)
update_docker_json() {
  local target_file="$1"
  local use_sudo="${2:-false}"
  if [[ "$use_sudo" == "true" ]]; then
    $SUDO python3 - "$target_file" "$REGISTRY_HOST" <<'PY' || true
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
mirror = sys.argv[2]
p.parent.mkdir(parents=True, exist_ok=True)
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
  else
    python3 - "$target_file" "$REGISTRY_HOST" <<'PY' || true
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
mirror = sys.argv[2]
p.parent.mkdir(parents=True, exist_ok=True)
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
  fi
}

if [[ "$(uname -s)" == "Darwin" ]]; then
  update_docker_json "$HOME/.docker/daemon.json" "false"
  update_docker_json "$HOME/.config/docker/daemon.json" "false"
elif [[ "$(uname -s)" == "Linux" ]]; then
  if [[ $EUID -eq 0 ]]; then SUDO=""; else SUDO="sudo -n"; fi
  if command -v apt-get >/dev/null 2>&1 && $SUDO true 2>/dev/null; then
    $SUDO tee /etc/apt/apt.conf.d/90megabyte-nexus-cache >/dev/null <<EOF || true
Acquire::Retries "3";
Acquire::http::Timeout "15";
Acquire::https::Timeout "15";
Acquire::Queue-Mode "host";
EOF
    CODENAME="$(. /etc/os-release 2>/dev/null && echo "${VERSION_CODENAME:-}")"
    ARCH="$(dpkg --print-architecture 2>/dev/null || echo "")"
    if [[ "$CODENAME" == "resolute" && "$ARCH" == "amd64" ]]; then
      $SUDO tee /etc/apt/sources.list.d/00-megabyte-nexus-mirror.list >/dev/null <<EOF || true
deb [arch=amd64] ${LOCAL_PROXY_BASE}/repository/apt-ubuntu-proxy/ resolute main restricted universe multiverse
deb [arch=amd64] ${LOCAL_PROXY_BASE}/repository/apt-ubuntu-proxy/ resolute-updates main restricted universe multiverse
deb [arch=amd64] ${LOCAL_PROXY_BASE}/repository/apt-ubuntu-proxy/ resolute-backports main restricted universe multiverse
deb [arch=amd64] ${LOCAL_PROXY_BASE}/repository/apt-security-proxy/ resolute-security main restricted universe multiverse
EOF
    fi
  fi
  if command -v docker >/dev/null 2>&1 && [[ -d /etc/docker ]] && $SUDO true 2>/dev/null; then
    update_docker_json "/etc/docker/daemon.json" "true"
    $SUDO systemctl reload docker 2>/dev/null || true
  fi
fi

# 10. Cache Pruning & Watermark Maintenance Utility
cat <<'EOF' > "$HOME/.local/bin/megabyte-cache-prune"
#!/usr/bin/env bash
set -euo pipefail
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/megabyte"
MAX_AGE_DAYS="${MEGABYTE_CACHE_MAX_AGE_DAYS:-30}"
if [[ -d "$CACHE_ROOT" ]]; then
  find "$CACHE_ROOT/agents" "$CACHE_ROOT/build" -type f -atime +"$MAX_AGE_DAYS" -delete 2>/dev/null || true
  find "$CACHE_ROOT/packages" "$CACHE_ROOT/local-proxy/blobs" -type f -atime +60 -delete 2>/dev/null || true
  find "$CACHE_ROOT/local-proxy/meta" -type f -mtime +7 -delete 2>/dev/null || true
fi
EOF
chmod +x "$HOME/.local/bin/megabyte-cache-prune"

log_info "Configured 3-tier pass-through proxy (local: $LOCAL_PROXY_BASE -> nexus: $NEXUS_BASE -> upstream) and cache ($CACHE_ROOT)."
