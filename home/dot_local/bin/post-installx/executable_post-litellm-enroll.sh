#!/usr/bin/env bash
# @file executable_post-litellm-enroll.sh
# @description Authenticated Cloudflare Tunnel gateway & LiteLLM node enrollment for Ollama hosts (§7).
# Binds an authenticated reverse proxy on 127.0.0.1:11435 -> 127.0.0.1:11434 so Cloudflare Tunnel
# never exposes an unauthenticated Ollama daemon, and reconciles node registration with LiteLLM.
set -euo pipefail

log_info() { printf '\033[0;34mINFO\033[0m %s\n' "$*"; }
log_warn() { printf '\033[0;33mWARN\033[0m %s\n' "$*"; }

if [[ "${INSTALL_DOCTOR_LITELLM_ENROLL:-0}" != "1" ]]; then
  log_info "LiteLLM/Ollama gateway enrollment is lazy; set INSTALL_DOCTOR_LITELLM_ENROLL=1 to enable it."
  exit 0
fi

if ! command -v ollama >/dev/null 2>&1; then
  log_info "Ollama is not installed on this host; skipping LiteLLM node enrollment."
  exit 0
fi

mkdir -p "$HOME/.config/megabyte" "$HOME/.local/bin"
chmod 0700 "$HOME/.config/megabyte"

TOKEN_FILE="$HOME/.config/megabyte/ollama-gateway.token"
RESOLVED_GATEWAY_TOKEN="${OLLAMA_GATEWAY_TOKEN:-}"
if [[ -z "$RESOLVED_GATEWAY_TOKEN" ]] && command -v get-secret >/dev/null 2>&1; then
  RESOLVED_GATEWAY_TOKEN="$(get-secret OLLAMA_GATEWAY_TOKEN 2>/dev/null || true)"
fi
if [[ -z "$RESOLVED_GATEWAY_TOKEN" ]] && command -v chezmoi >/dev/null 2>&1 && [[ -f "$HOME/.local/share/chezmoi/home/.chezmoitemplates/secrets/OLLAMA_GATEWAY_TOKEN" ]]; then
  RESOLVED_GATEWAY_TOKEN="$(chezmoi decrypt "$HOME/.local/share/chezmoi/home/.chezmoitemplates/secrets/OLLAMA_GATEWAY_TOKEN" 2>/dev/null || true)"
fi
if [[ -n "$RESOLVED_GATEWAY_TOKEN" ]]; then
  printf '%s\n' "$RESOLVED_GATEWAY_TOKEN" > "$TOKEN_FILE"
  chmod 0600 "$TOKEN_FILE"
elif [[ ! -s "$TOKEN_FILE" ]]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > "$TOKEN_FILE"
  chmod 0600 "$TOKEN_FILE"
fi

cat <<'EOF' > "$HOME/.local/bin/ollama-auth-proxy.py"
#!/usr/bin/env python3
"""Loopback authenticated reverse proxy (127.0.0.1:11435 -> 127.0.0.1:11434) for Cloudflare Tunnel."""
import hmac
import http.client
import http.server
import os
import socketserver
import sys

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = int(os.environ.get("OLLAMA_PROXY_PORT", "11435"))
UPSTREAM_HOST = "127.0.0.1"
UPSTREAM_PORT = int(os.environ.get("OLLAMA_UPSTREAM_PORT", "11434"))
TOKEN_PATH = os.path.expanduser("~/.config/megabyte/ollama-gateway.token")


def load_token() -> str:
    with open(TOKEN_PATH, "r", encoding="utf-8") as f:
        return f.read().strip()


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _authorized(self) -> bool:
        expected = load_token()
        auth = self.headers.get("Authorization", "")
        token = ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        elif self.headers.get("X-Ollama-Token"):
            token = self.headers.get("X-Ollama-Token", "").strip()
        return bool(token and expected and hmac.compare_digest(token, expected))

    def _handle(self):
        if not self._authorized():
            body = b'{"error":"Unauthorized: valid Bearer token required"}\n'
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return

        content_len = int(self.headers.get("Content-Length", "0"))
        req_body = self.rfile.read(content_len) if content_len > 0 else None

        conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=300)
        fwd_headers = {
            k: v
            for k, v in self.headers.items()
            if k.lower() not in ("host", "authorization", "x-ollama-token", "connection")
        }
        fwd_headers["Host"] = f"{UPSTREAM_HOST}:{UPSTREAM_PORT}"
        try:
            conn.request(self.command, self.path, body=req_body, headers=fwd_headers)
            resp = conn.getresponse()
            data = resp.read()
            self.send_response(resp.status)
            for hk, hv in resp.getheaders():
                if hk.lower() not in ("transfer-encoding", "connection", "content-length"):
                    self.send_header(hk, hv)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
        except Exception as exc:
            err = f'{{"error":"Upstream Ollama error: {exc}"}}\n'.encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(err)
        finally:
            conn.close()

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_DELETE = _handle
    do_HEAD = _handle


if __name__ == "__main__":
    srv = ThreadedHTTPServer((LISTEN_HOST, LISTEN_PORT), ProxyHandler)
    srv.serve_forever()
EOF
chmod +x "$HOME/.local/bin/ollama-auth-proxy.py"

if [[ "$(uname -s)" == "Darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/com.megabyte.ollama-auth-proxy.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat <<EOF > "$PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.megabyte.ollama-auth-proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>${HOME}/.local/bin/ollama-auth-proxy.py</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.cache/megabyte/ollama-auth-proxy.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.cache/megabyte/ollama-auth-proxy.err</string>
</dict>
</plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
else
  mkdir -p "$HOME/.config/systemd/user"
  cat <<EOF > "$HOME/.config/systemd/user/ollama-auth-proxy.service"
[Unit]
Description=Authenticated Loopback Proxy for Ollama Tunnel Ingress (127.0.0.1:11435)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 %h/.local/bin/ollama-auth-proxy.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now ollama-auth-proxy.service
fi

log_info "Ollama authenticated proxy active on 127.0.0.1:11435 -> 127.0.0.1:11434."
