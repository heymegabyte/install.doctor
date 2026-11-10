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
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url") + "\n")' > "$TOKEN_FILE"
  chmod 0600 "$TOKEN_FILE"
fi

# Install the zero-buffering authenticated reverse proxy as strict TypeScript (Node --experimental-strip-types).
rm -f "$HOME/.local/bin/ollama-auth-proxy.py" 2>/dev/null || true
cat <<'TSEOF' > "$HOME/.local/bin/ollama-auth-proxy.ts"
#!/usr/bin/env -S node --experimental-strip-types
/**
 * Zero-Buffering Authenticated Loopback Reverse Proxy (127.0.0.1:11435 -> 127.0.0.1:11434)
 * for Cloudflare Tunnel -> Ollama Gateway Ingress.
 *
 * Enforces constant-time Bearer / X-Ollama-Token validation against
 * ~/.config/megabyte/ollama-gateway.token and streams request/response bodies
 * directly over Node HTTP sockets without buffering model payloads in memory.
 */

import { timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

interface OllamaGatewayProxyConfig {
  readonly listenHost: string;
  readonly listenPort: number;
  readonly upstreamHost: string;
  readonly upstreamPort: number;
  readonly tokenFilePath: string;
  readonly upstreamTimeoutMs: number;
}

interface CachedTokenState {
  mtimeMs: number;
  sizeBytes: number;
  tokenValue: Buffer;
}

const CONFIG: OllamaGatewayProxyConfig = {
  listenHost: "127.0.0.1",
  listenPort: Number.parseInt(process.env.OLLAMA_PROXY_PORT ?? "11435", 10) || 11435,
  upstreamHost: "127.0.0.1",
  upstreamPort: Number.parseInt(process.env.OLLAMA_UPSTREAM_PORT ?? "11434", 10) || 11434,
  tokenFilePath:
    process.env.OLLAMA_GATEWAY_TOKEN_FILE ??
    join(homedir(), ".config", "megabyte", "ollama-gateway.token"),
  upstreamTimeoutMs: Number.parseInt(process.env.OLLAMA_PROXY_TIMEOUT_MS ?? "300000", 10) || 300_000,
};

const tokenCache: CachedTokenState = {
  mtimeMs: -1,
  sizeBytes: -1,
  tokenValue: Buffer.alloc(0),
};

function loadExpectedToken(): Buffer | null {
  try {
    const st = statSync(CONFIG.tokenFilePath);
    if (tokenCache.mtimeMs !== st.mtimeMs || tokenCache.sizeBytes !== st.size) {
      const trimmed = readFileSync(CONFIG.tokenFilePath, "utf8").trim();
      tokenCache.tokenValue = Buffer.from(trimmed, "utf8");
      tokenCache.mtimeMs = st.mtimeMs;
      tokenCache.sizeBytes = st.size;
    }
    return tokenCache.tokenValue.byteLength > 0 ? tokenCache.tokenValue : null;
  } catch {
    return null;
  }
}

function extractPresentedToken(headers: IncomingHttpHeaders): string {
  const authHeader = headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  const customHeader = headers["x-ollama-token"];
  if (typeof customHeader === "string") {
    return customHeader.trim();
  }
  return "";
}

function isRequestAuthorized(headers: IncomingHttpHeaders): boolean {
  const expected = loadExpectedToken();
  if (!expected) {
    return false;
  }
  const presentedRaw = extractPresentedToken(headers);
  if (!presentedRaw) {
    return false;
  }
  const presented = Buffer.from(presentedRaw, "utf8");
  if (presented.byteLength !== expected.byteLength) {
    return false;
  }
  return timingSafeEqual(presented, expected);
}

function writeJsonResponse(
  res: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
  headOnly: boolean,
): void {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  const encoded = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": String(encoded.byteLength),
    Connection: "close",
  });
  if (headOnly) {
    res.end();
    return;
  }
  res.end(encoded);
}

function buildForwardedHeaders(incoming: IncomingHttpHeaders): Record<string, string | string[]> {
  const stripped = new Set([
    "host",
    "authorization",
    "x-ollama-token",
    "connection",
    "keep-alive",
  ]);
  const forwarded: Record<string, string | string[]> = {
    Host: `${CONFIG.upstreamHost}:${CONFIG.upstreamPort}`,
  };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || stripped.has(key.toLowerCase())) {
      continue;
    }
    forwarded[key] = value;
  }
  return forwarded;
}

function handleGatewayRequest(req: IncomingMessage, res: ServerResponse): void {
  res.on("error", () => {
    // Suppress client disconnect socket errors.
  });

  const method = (req.method ?? "GET").toUpperCase();
  const headOnly = method === "HEAD";
  const path = req.url ?? "/";

  if (path === "/healthz") {
    writeJsonResponse(
      res,
      200,
      {
        status: "ok",
        runtime: "node-typescript",
        listen: `${CONFIG.listenHost}:${CONFIG.listenPort}`,
        upstream: `${CONFIG.upstreamHost}:${CONFIG.upstreamPort}`,
        tokenConfigured: loadExpectedToken() !== null,
      },
      headOnly,
    );
    return;
  }

  if (!isRequestAuthorized(req.headers)) {
    req.resume();
    writeJsonResponse(
      res,
      401,
      { error: "Unauthorized: valid Bearer token required" },
      headOnly,
    );
    return;
  }

  const upstreamReq = httpRequest(
    {
      host: CONFIG.upstreamHost,
      port: CONFIG.upstreamPort,
      method,
      path,
      headers: buildForwardedHeaders(req.headers),
      timeout: CONFIG.upstreamTimeoutMs,
    },
    (upstreamRes) => {
      const responseHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || key.toLowerCase() === "keep-alive") {
          continue;
        }
        responseHeaders[key] = value;
      }
      if (upstreamRes.headers["transfer-encoding"]?.includes("chunked")) {
        responseHeaders["X-Accel-Buffering"] = "no";
      }
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      if (headOnly) {
        upstreamRes.resume();
        res.end();
        return;
      }
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("timeout", () => {
    upstreamReq.destroy(new Error("Upstream Ollama request timed out"));
  });

  upstreamReq.on("error", (err) => {
    if (!res.headersSent) {
      writeJsonResponse(
        res,
        502,
        { error: `Upstream Ollama error: ${err.message}` },
        headOnly,
      );
    } else if (!res.destroyed) {
      res.destroy();
    }
  });

  req.on("aborted", () => {
    upstreamReq.destroy();
  });

  req.pipe(upstreamReq);
}

const server = createServer(handleGatewayRequest);
server.listen(CONFIG.listenPort, CONFIG.listenHost);

TSEOF
chmod 0755 "$HOME/.local/bin/ollama-auth-proxy.ts"

# Resolve a Node binary for the Darwin LaunchAgent (prefer Homebrew, fall back to PATH).
NODE_BIN="/opt/homebrew/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node 2>/dev/null || echo /usr/local/bin/node)"

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
    <string>${NODE_BIN}</string>
    <string>--experimental-strip-types</string>
    <string>${HOME}/.local/bin/ollama-auth-proxy.ts</string>
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
Environment="PATH=/usr/local/bin:%h/.local/share/mise/shims:/usr/bin:/bin"
ExecStart=/usr/local/bin/node --experimental-strip-types %h/.local/bin/ollama-auth-proxy.ts
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now ollama-auth-proxy.service
fi

log_info "Ollama authenticated proxy active on 127.0.0.1:11435 -> 127.0.0.1:11434."
