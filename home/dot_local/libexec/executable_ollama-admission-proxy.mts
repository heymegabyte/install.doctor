#!/usr/bin/env -S node --experimental-strip-types
/**
 * Zero-Buffering Authenticated Loopback Reverse Proxy (127.0.0.1:11435 -> 127.0.0.1:11434)
 * for Cloudflare Tunnel -> Ollama Gateway Ingress.
 *
 * Enforces constant-time Bearer / X-Ollama-Token validation against
 * ~/.config/megabyte/ollama-gateway.token and streams request/response bodies
 * after validating bounded JSON requests.
 */

import { timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, statSync } from "node:fs";
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
  readonly drainFilePath: string;
  readonly upstreamTimeoutMs: number;
}

const CONFIG: OllamaGatewayProxyConfig = {
  listenHost: "127.0.0.1",
  listenPort: Number.parseInt(process.env.OLLAMA_PROXY_PORT ?? "11435", 10) || 11435,
  upstreamHost: "127.0.0.1",
  upstreamPort: Number.parseInt(process.env.OLLAMA_UPSTREAM_PORT ?? "11434", 10) || 11434,
  tokenFilePath:
    process.env.OLLAMA_GATEWAY_TOKEN_FILE ??
    join(homedir(), ".config", "megabyte", "ollama-gateway.token"),
  drainFilePath: process.env.OLLAMA_PROXY_DRAIN_FILE ?? join(homedir(), ".config", "megabyte", "ollama-draining"),
  upstreamTimeoutMs: Number.parseInt(process.env.OLLAMA_PROXY_TIMEOUT_MS ?? "300000", 10) || 300_000,
};

const maxTokenFileBytes = 4096;

function loadExpectedToken(): Buffer | null {
  let fd: number | undefined;
  try {
    fd = openSync(CONFIG.tokenFilePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 ||
        stat.size < 1 || stat.size > maxTokenFileBytes) {
      return null;
    }
    const bytes = Buffer.alloc(maxTokenFileBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(fd, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > maxTokenFileBytes) return null;
    const token = bytes.subarray(0, length).toString("utf8").trim();
    return token ? Buffer.from(token, "utf8") : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
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

const readPaths = new Set(["/api/version", "/api/tags", "/api/ps", "/v1/models"]);
const inferencePaths = new Set([
  "/api/chat",
  "/api/generate",
  "/api/embed",
  "/api/embeddings",
  "/api/show",
  "/v1/chat/completions",
  "/v1/completions",
  "/v1/embeddings",
  "/v1/responses",
]);
const maxInFlight = 2;
let inFlight = 0;

function isDraining(): boolean {
  try {
    return statSync(CONFIG.drainFilePath, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

const supportedModels = ["qwen2.5:7b-instruct", "qwen2.5-coder:14b", "nomic-embed-text:latest"];
const configuredModels = process.env.OLLAMA_PROXY_MODELS;
const selectedModels = configuredModels === undefined
  ? supportedModels
  : configuredModels.split(",").map((model) => model.trim());
const allowedModels = new Set(selectedModels);
if (allowedModels.size !== selectedModels.length ||
    selectedModels.some((model) => !supportedModels.includes(model))) {
  throw new Error("OLLAMA_PROXY_MODELS must be a nonempty, unique subset of supported local models");
}
const maxInventoryBytes = 64 * 1024;
let inventoryProbe: Promise<boolean> | undefined;

async function checkLocalInventory(): Promise<boolean> {
  try {
    const response = await fetch(`http://${CONFIG.upstreamHost}:${CONFIG.upstreamPort}/api/tags`, {
      redirect: "error",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return false;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxInventoryBytes) {
        await reader.cancel();
        return false;
      }
      chunks.push(value);
    }
    const inventory: unknown = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    if (!inventory || typeof inventory !== "object" || !("models" in inventory) || !Array.isArray(inventory.models)) {
      return false;
    }
    const models = new Set<string>();
    const entries: readonly unknown[] = inventory.models;
    for (const entry of entries) {
      if (entry && typeof entry === "object" &&
          "name" in entry && typeof entry.name === "string" &&
          "digest" in entry && typeof entry.digest === "string" &&
          /^[0-9a-f]{64}$/.test(entry.digest)) {
        models.add(entry.name);
      }
    }
    return [...allowedModels].every((model) => models.has(model));
  } catch {
    return false;
  }
}

function localInventoryReady(): Promise<boolean> {
  inventoryProbe ??= checkLocalInventory().finally(() => { inventoryProbe = undefined; });
  return inventoryProbe;
}

const maxNativeContext = 4096;
const maxKeepAliveSeconds = 1800;
const nativeCanonicalFields = new Set(["model", "name", "options", "keep_alive"]);
const durationUnitSeconds = new Map([
  ["ns", 1e-9], ["us", 1e-6], ["µs", 1e-6], ["μs", 1e-6],
  ["ms", 1e-3], ["s", 1], ["m", 60], ["h", 3600],
]);
const maxRequestBytes = 25 * 1024 * 1024;

function keepAliveSeconds(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.length > 128) return NaN;
  if (/^[+-]?0$/.test(value)) return 0;
  const duration = value.replace(/^[+-]/, "");
  let end = 0;
  let seconds = 0;
  for (const part of duration.matchAll(/(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/g)) {
    if (part.index !== end) return NaN;
    const unit = durationUnitSeconds.get(part[2]);
    if (unit === undefined) return NaN;
    seconds += Number(part[1]) * unit;
    end += part[0].length;
  }
  if (end === 0 || end !== duration.length) return NaN;
  return value.startsWith("-") ? -seconds : seconds;
}

async function readModelRequest(req: IncomingMessage, res: ServerResponse, path: string): Promise<Buffer | null> {
  const encoding = req.headers["content-encoding"];
  if (encoding && encoding !== "identity") {
    req.resume();
    writeJsonResponse(res, 415, { error: "Compressed request bodies are unsupported" }, false);
    return null;
  }
  if (Number(req.headers["content-length"]) > maxRequestBytes) {
    req.resume();
    writeJsonResponse(res, 413, { error: "Ollama request exceeds the body limit" }, false);
    return null;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxRequestBytes) {
      req.resume();
      writeJsonResponse(res, 413, { error: "Ollama request exceeds the body limit" }, false);
      return null;
    }
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    writeJsonResponse(res, 400, { error: "Expected an Ollama JSON request" }, false);
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    writeJsonResponse(res, 400, { error: "Expected an Ollama JSON object" }, false);
    return null;
  }
  const request = body as Record<string, unknown>;
  const native = path.startsWith("/api/");
  // The upstream struct decoder matches alternate casing. Require the same field names at both layers.
  if (Object.keys(request).some((key) => {
    const canonical = key.toLowerCase();
    return key !== canonical && (canonical === "model" || canonical === "keep_alive" ||
      (native && nativeCanonicalFields.has(canonical)));
  })) {
    writeJsonResponse(res, 400, { error: "Use canonical Ollama request field names" }, false);
    return null;
  }
  const model = request.model ?? (path === "/api/show" ? request.name : undefined);
  if (typeof model !== "string" || !allowedModels.has(model) ||
      (path === "/api/show" && request.name !== undefined && request.name !== model)) {
    writeJsonResponse(res, 403, { error: "Model unavailable through this proxy" }, false);
    return null;
  }
  const options = request.options;
  if (native && path !== "/api/show" && options != null) {
    if (typeof options !== "object" || Array.isArray(options)) {
      writeJsonResponse(res, 400, { error: "Expected an Ollama options object" }, false);
      return null;
    }
    const nativeOptions = options as Record<string, unknown>;
    const context = nativeOptions.num_ctx;
    if (context !== undefined) {
      if (typeof context !== "number" || !Number.isSafeInteger(context) || context < 1) {
        writeJsonResponse(res, 400, { error: "num_ctx must be a positive integer" }, false);
        return null;
      }
      nativeOptions.num_ctx = Math.min(context, maxNativeContext);
    }
  }
  if (path !== "/api/show" && request.keep_alive != null) {
    const seconds = keepAliveSeconds(request.keep_alive);
    if (!Number.isFinite(seconds)) {
      writeJsonResponse(res, 400, { error: "Expected a valid Ollama keep_alive duration" }, false);
      return null;
    }
    if (seconds < 0 || seconds > maxKeepAliveSeconds) {
      request.keep_alive = maxKeepAliveSeconds;
    }
  }
  return Buffer.from(JSON.stringify(request), "utf8");
}

async function handleGatewayRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  if (path === "/admissionz" && (method === "GET" || headOnly)) {
    const ready = !isDraining() && inFlight < maxInFlight && await localInventoryReady();
    const draining = isDraining();
    const available = ready && !draining && inFlight < maxInFlight;
    writeJsonResponse(res, available ? 200 : 503, { draining, inFlight, available }, headOnly);
    return;
  }

  const allowed = method === "POST"
    ? inferencePaths.has(path)
    : (method === "GET" || headOnly) && readPaths.has(path);
  if (!allowed) {
    req.resume();
    writeJsonResponse(res, 404, { error: "Ollama route unavailable through this proxy" }, headOnly);
    return;
  }

  if (method === "POST" && isDraining()) {
    req.resume();
    writeJsonResponse(res, 503, { error: "Ollama origin is draining" }, false);
    return;
  }

  if (inFlight >= maxInFlight) {
    req.resume();
    writeJsonResponse(res, 503, { error: "Ollama origin is at capacity" }, headOnly);
    return;
  }

  inFlight += 1;
  let body: Buffer | null = null;
  const headers = buildForwardedHeaders(req.headers);
  if (method === "POST") {
    try {
      body = await readModelRequest(req, res, path);
    } catch {
      writeJsonResponse(res, 400, { error: "Ollama request body was interrupted" }, false);
    }
    if (body === null || res.destroyed) {
      inFlight -= 1;
      return;
    }
    delete headers["transfer-encoding"];
    delete headers["content-encoding"];
    headers["content-length"] = String(body.length);
    headers["content-type"] = "application/json";
  }

  const upstreamReq = httpRequest(
    {
      host: CONFIG.upstreamHost,
      port: CONFIG.upstreamPort,
      method,
      path,
      headers,
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

  upstreamReq.once("close", () => { inFlight -= 1; });

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

  res.once("close", () => {
    if (!res.writableFinished) {
      upstreamReq.destroy();
    }
  });

  if (body !== null) upstreamReq.end(body);
  else req.pipe(upstreamReq);
}

// Bound the time a partial upload can hold an admission slot. Streaming
// responses are governed separately by the upstream socket timeout.
const server = createServer({
  headersTimeout: 10_000,
  requestTimeout: 30_000,
  connectionsCheckingInterval: 1000,
}, handleGatewayRequest);
server.listen(CONFIG.listenPort, CONFIG.listenHost);
