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
  "${CACHE_ROOT}/ai/langfuse-spool" \
  "${CACHE_ROOT}/agents/opencode" \
  "${CACHE_ROOT}/agents/claude" \
  "${CACHE_ROOT}/agents/codex" \
  "${CACHE_ROOT}/agents/cua" \
  "$HOME/.config/shell" \
  "$HOME/.config/npm" \
  "$HOME/.config/pnpm" \
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

# Resolve an absolute Node binary so sudo-elevated mutators and systemd units can
# invoke `node --experimental-strip-types` without depending on the caller's PATH.
resolve_node_bin() {
  local candidate
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/share/mise/shims/node" "$HOME/.local/bin/node"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  command -v node 2>/dev/null || return 1
}
NODE_BIN="$(resolve_node_bin || echo node)"

# 1. Install the Tier-1 Local Loopback Pass-Through Caching Proxy (strict TypeScript on Node --experimental-strip-types)
rm -rf "$HOME/.local/bin/__pycache__" 2>/dev/null || true
rm -f "$HOME/.local/bin/megabyte-local-proxy.py" 2>/dev/null || true
cat <<'TSEOF' > "$HOME/.local/bin/megabyte-local-proxy.ts"
#!/usr/bin/env -S node --experimental-strip-types
/**
 * Loopback Pass-Through Artifact Cache Proxy (127.0.0.1:4880).
 *
 * Tier 1: Local content-addressed disk cache (~/.cache/megabyte/local-proxy) with bounded LRU pruning.
 * Tier 2: Central Sonatype Nexus pass-through proxy (https://nexus.megabyte.space).
 * Tier 3: Canonical upstream registries (npmjs.org, pypi.org, proxy.golang.org, crates.io, maven.org, ubuntu.com).
 *
 * Exposes /healthz, /stats (JSON), and /metrics (Prometheus text format 0.0.4).
 */

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface ProxyConfiguration {
  readonly host: string;
  readonly port: number;
  readonly localBaseUrl: string;
  readonly nexusBaseUrl: string;
  readonly cacheRootDir: string;
  readonly blobsDir: string;
  readonly metadataDir: string;
  readonly metadataFreshTtlSeconds: number;
  readonly maxCacheBytes: number;
  readonly upstreamTimeoutMs: number;
}

interface CacheEntryMetadata {
  readonly content_type: string;
  readonly ts: number;
  readonly source: string;
}

interface RepositoryStatsCounter {
  hits: number;
  misses: number;
  bytes: number;
}

interface ProxyTelemetryCounters {
  "HIT-LOCAL": number;
  "HIT-LOCAL-META": number;
  "HIT-LOCAL-STALE": number;
  "HIT-LOCAL-CARGO-CONFIG": number;
  "MISS-VIA-NEXUS": number;
  "MISS-VIA-UPSTREAM": number;
  "MISS-ERROR": number;
  bytes_served_local: number;
  bytes_served_remote: number;
  evictions_total: number;
  readonly by_repo: Record<string, RepositoryStatsCounter>;
}

interface RemoteFetchResult {
  readonly status: number;
  readonly contentType: string;
  readonly body: Buffer;
}

interface UpstreamCandidate {
  readonly tag: "MISS-VIA-NEXUS" | "MISS-VIA-UPSTREAM";
  readonly targetUrl: string;
}

const UPSTREAM_REGISTRY_ORIGINS: Readonly<Record<string, string>> = {
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
  "apt-ubuntu": "http://archive.ubuntu.com/ubuntu",
  "apt-security": "http://security.ubuntu.com/ubuntu",
};

const IMMUTABLE_ARTIFACT_SUFFIXES: readonly string[] = [
  ".tgz",
  ".tar.gz",
  ".tar.xz",
  ".tar.bz2",
  ".tar.zst",
  ".whl",
  ".zip",
  ".jar",
  ".pom",
  ".crate",
  ".deb",
  ".udeb",
  ".ddeb",
  ".nupkg",
  ".snupkg",
  ".mod",
  ".woff2",
  ".safetensors",
  ".gguf",
];

const MUTABLE_INDEX_SUFFIXES: readonly string[] = [
  "packages.gz",
  "packages.xz",
  "contents-amd64.gz",
  "by-hash",
];

const FORWARDED_CLIENT_HEADERS: readonly string[] = [
  "accept",
  "npm-scope",
  "npm-session",
  "pacote-version",
  "pacote-req-type",
  "pacote-pkg-id",
];

function resolveConfiguration(): ProxyConfiguration {
  const host = process.env.MEGABYTE_LOCAL_PROXY_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.MEGABYTE_LOCAL_PROXY_PORT ?? "4880", 10) || 4880;
  const nexusBaseUrl = (process.env.MEGABYTE_NEXUS_URL ?? "https://nexus.megabyte.space").replace(/\/+$/, "");
  const baseCacheRoot = process.env.MEGABYTE_CACHE_ROOT ?? join(homedir(), ".cache", "megabyte");
  const cacheRootDir = join(baseCacheRoot, "local-proxy");
  const metadataFreshTtlSeconds =
    Number.parseInt(process.env.MEGABYTE_LOCAL_PROXY_META_TTL ?? "300", 10) || 300;
  const maxCacheBytes =
    Number.parseInt(process.env.MEGABYTE_LOCAL_PROXY_MAX_BYTES ?? String(10 * 1024 * 1024 * 1024), 10) ||
    10 * 1024 * 1024 * 1024;
  const upstreamTimeoutMs =
    Number.parseInt(process.env.MEGABYTE_LOCAL_PROXY_TIMEOUT_MS ?? "20000", 10) || 20_000;

  return {
    host,
    port,
    localBaseUrl: `http://${host}:${port}`,
    nexusBaseUrl,
    cacheRootDir,
    blobsDir: join(cacheRootDir, "blobs"),
    metadataDir: join(cacheRootDir, "meta"),
    metadataFreshTtlSeconds,
    maxCacheBytes,
    upstreamTimeoutMs,
  };
}

const CONFIG = resolveConfiguration();
const START_TIME_SECONDS = Date.now() / 1000;

mkdirSync(CONFIG.blobsDir, { recursive: true });
mkdirSync(CONFIG.metadataDir, { recursive: true });

const COUNTERS: ProxyTelemetryCounters = {
  "HIT-LOCAL": 0,
  "HIT-LOCAL-META": 0,
  "HIT-LOCAL-STALE": 0,
  "HIT-LOCAL-CARGO-CONFIG": 0,
  "MISS-VIA-NEXUS": 0,
  "MISS-VIA-UPSTREAM": 0,
  "MISS-ERROR": 0,
  bytes_served_local: 0,
  bytes_served_remote: 0,
  evictions_total: 0,
  by_repo: {},
};

let writesSinceLastPrune = 0;

function recordProxyOutcome(
  cacheResult:
    | "HIT-LOCAL"
    | "HIT-LOCAL-META"
    | "HIT-LOCAL-STALE"
    | "HIT-LOCAL-CARGO-CONFIG"
    | "MISS-VIA-NEXUS"
    | "MISS-VIA-UPSTREAM"
    | "MISS-ERROR",
  repositoryName: string | null,
  byteLength: number,
): void {
  COUNTERS[cacheResult] += 1;
  if (cacheResult.startsWith("HIT")) {
    COUNTERS.bytes_served_local += byteLength;
  } else if (cacheResult.startsWith("MISS-VIA")) {
    COUNTERS.bytes_served_remote += byteLength;
  }
  if (repositoryName) {
    const repoStats = COUNTERS.by_repo[repositoryName] ?? { hits: 0, misses: 0, bytes: 0 };
    if (cacheResult.startsWith("HIT")) {
      repoStats.hits += 1;
    } else {
      repoStats.misses += 1;
    }
    repoStats.bytes += byteLength;
    COUNTERS.by_repo[repositoryName] = repoStats;
  }
}

function isImmutableArtifact(repositoryName: string, relativePath: string): boolean {
  const cleanPath = (relativePath.split("?", 1)[0] ?? "").toLowerCase();
  if (repositoryName === "pypi-files" || repositoryName === "cargo-crates-proxy") {
    return true;
  }
  if (IMMUTABLE_ARTIFACT_SUFFIXES.some((suffix) => cleanPath.endsWith(suffix))) {
    if (MUTABLE_INDEX_SUFFIXES.some((mutableSuffix) => cleanPath.endsWith(mutableSuffix))) {
      return false;
    }
    return true;
  }
  if (repositoryName === "npm-group" || repositoryName === "npm-proxy") {
    return cleanPath.includes("/-/") && cleanPath.endsWith(".tgz");
  }
  if (repositoryName === "go-proxy" && (cleanPath.endsWith(".info") || cleanPath.endsWith(".mod") || cleanPath.endsWith(".zip"))) {
    return true;
  }
  return false;
}

function resolveCachePaths(baseDirectory: string, cacheKey: string): { readonly blobPath: string; readonly headerPath: string } {
  const digest = createHash("sha256").update(cacheKey).digest("hex");
  const shardDirectory = join(baseDirectory, digest.slice(0, 2));
  mkdirSync(shardDirectory, { recursive: true });
  return {
    blobPath: join(shardDirectory, `${digest}.bin`),
    headerPath: join(shardDirectory, `${digest}.hdr.json`),
  };
}

function writeAtomically(targetPath: string, payload: Buffer): void {
  const parentDir = dirname(targetPath);
  mkdirSync(parentDir, { recursive: true });
  const tempPath = join(parentDir, `.tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(tempPath, payload);
    renameSync(tempPath, targetPath);
  } catch {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup race on failed atomic write.
    }
  }
}

function pruneBlobCacheIfOverBudget(): void {
  try {
    interface BlobFileDescriptor {
      readonly blobPath: string;
      readonly headerPath: string;
      readonly sizeBytes: number;
      readonly mtimeMs: number;
    }
    const entries: BlobFileDescriptor[] = [];
    let totalBytes = 0;

    for (const shard of readdirSync(CONFIG.blobsDir)) {
      const shardPath = join(CONFIG.blobsDir, shard);
      let shardFiles: string[];
      try {
        shardFiles = readdirSync(shardPath);
      } catch {
        continue;
      }
      for (const fileName of shardFiles) {
        if (!fileName.endsWith(".bin")) {
          continue;
        }
        const blobPath = join(shardPath, fileName);
        try {
          const st = statSync(blobPath);
          totalBytes += st.size;
          entries.push({
            blobPath,
            headerPath: blobPath.slice(0, -4) + ".hdr.json",
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
          });
        } catch {
          // Ignore concurrent unlink.
        }
      }
    }

    if (totalBytes <= CONFIG.maxCacheBytes) {
      return;
    }

    const targetBytes = Math.floor(CONFIG.maxCacheBytes * 0.85);
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of entries) {
      if (totalBytes <= targetBytes) {
        break;
      }
      rmSync(entry.blobPath, { force: true });
      rmSync(entry.headerPath, { force: true });
      totalBytes -= entry.sizeBytes;
      COUNTERS.evictions_total += 1;
    }
  } catch {
    // Cache pruning is best-effort and never blocks proxy traffic.
  }
}

function rewriteRegistryMetadata(
  repositoryName: string,
  relativePath: string,
  contentType: string,
  body: Buffer,
): Buffer {
  const normalizedType = contentType.toLowerCase();
  if (
    (repositoryName === "npm-group" || repositoryName === "npm-proxy") &&
    (normalizedType.includes("json") || !isImmutableArtifact(repositoryName, relativePath))
  ) {
    const text = body
      .toString("utf8")
      .replaceAll(`${CONFIG.nexusBaseUrl}/repository/npm-group/`, `${CONFIG.localBaseUrl}/repository/npm-group/`)
      .replaceAll(`${CONFIG.nexusBaseUrl}/repository/npm-proxy/`, `${CONFIG.localBaseUrl}/repository/npm-group/`)
      .replaceAll("https://registry.npmjs.org/", `${CONFIG.localBaseUrl}/repository/npm-group/`);
    return Buffer.from(text, "utf8");
  }
  if (
    (repositoryName === "pypi-group" || repositoryName === "pypi-proxy") &&
    (normalizedType.includes("html") || normalizedType.includes("json") || relativePath.includes("simple"))
  ) {
    const text = body
      .toString("utf8")
      .replaceAll(`${CONFIG.nexusBaseUrl}/repository/pypi-group/`, `${CONFIG.localBaseUrl}/repository/pypi-group/`)
      .replaceAll(`${CONFIG.nexusBaseUrl}/repository/pypi-proxy/`, `${CONFIG.localBaseUrl}/repository/pypi-group/`)
      .replaceAll("https://files.pythonhosted.org/", `${CONFIG.localBaseUrl}/pypi-files/`);
    return Buffer.from(text, "utf8");
  }
  return body;
}

async function fetchUpstreamArtifact(
  targetUrl: string,
  incomingHeaders: IncomingMessage["headers"],
): Promise<RemoteFetchResult> {
  const headers: Record<string, string> = {
    "user-agent":
      typeof incomingHeaders["user-agent"] === "string"
        ? incomingHeaders["user-agent"]
        : "MegabyteLocalProxy/2.0",
  };
  for (const headerName of FORWARDED_CLIENT_HEADERS) {
    const value = incomingHeaders[headerName];
    if (typeof value === "string" && value.length > 0) {
      headers[headerName] = value;
    }
  }
  const response = await fetch(targetUrl, {
    method: "GET",
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(CONFIG.upstreamTimeoutMs),
  });
  const arrayBuffer = await response.arrayBuffer();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    body: Buffer.from(arrayBuffer),
  };
}

function sendBufferResponse(
  res: ServerResponse,
  statusCode: number,
  contentType: string,
  body: Buffer,
  cacheHeader: string,
  headOnly: boolean,
): void {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": String(body.byteLength),
    "X-Megabyte-Cache": cacheHeader,
    Connection: "close",
  });
  if (headOnly || body.byteLength === 0) {
    res.end();
    return;
  }
  res.end(body);
}

async function handleProxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.on("error", () => {
    // Suppress client disconnect BrokenPipe/ECONNRESET noise.
  });

  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    sendBufferResponse(res, 405, "text/plain", Buffer.from("Method Not Allowed\n"), "MISS", false);
    return;
  }
  const headOnly = method === "HEAD";
  const rawPath = req.url ?? "/";

  if (rawPath === "/healthz") {
    const payload = Buffer.from(
      JSON.stringify({
        status: "ok",
        runtime: "node-typescript",
        local_proxy: CONFIG.localBaseUrl,
        nexus_upstream: CONFIG.nexusBaseUrl,
        cache_root: CONFIG.cacheRootDir,
        max_cache_bytes: CONFIG.maxCacheBytes,
      }),
      "utf8",
    );
    sendBufferResponse(res, 200, "application/json", payload, "LOCAL-HEALTHZ", headOnly);
    return;
  }

  if (rawPath === "/stats") {
    const totalHits =
      COUNTERS["HIT-LOCAL"] +
      COUNTERS["HIT-LOCAL-META"] +
      COUNTERS["HIT-LOCAL-STALE"] +
      COUNTERS["HIT-LOCAL-CARGO-CONFIG"];
    const totalMisses = COUNTERS["MISS-VIA-NEXUS"] + COUNTERS["MISS-VIA-UPSTREAM"];
    const totalRequests = totalHits + totalMisses;
    const hitRatio = totalRequests > 0 ? Number((totalHits / totalRequests).toFixed(4)) : 0;
    const snapshot = {
      status: "ok",
      runtime: "node-typescript",
      uptime_seconds: Number((Date.now() / 1000 - START_TIME_SECONDS).toFixed(1)),
      total_requests: totalRequests,
      total_hits: totalHits,
      total_misses: totalMisses,
      hit_ratio: hitRatio,
      counters: {
        "HIT-LOCAL": COUNTERS["HIT-LOCAL"],
        "HIT-LOCAL-META": COUNTERS["HIT-LOCAL-META"],
        "HIT-LOCAL-STALE": COUNTERS["HIT-LOCAL-STALE"],
        "HIT-LOCAL-CARGO-CONFIG": COUNTERS["HIT-LOCAL-CARGO-CONFIG"],
        "MISS-VIA-NEXUS": COUNTERS["MISS-VIA-NEXUS"],
        "MISS-VIA-UPSTREAM": COUNTERS["MISS-VIA-UPSTREAM"],
        "MISS-ERROR": COUNTERS["MISS-ERROR"],
        bytes_served_local: COUNTERS.bytes_served_local,
        bytes_served_remote: COUNTERS.bytes_served_remote,
        evictions_total: COUNTERS.evictions_total,
      },
      by_repo: COUNTERS.by_repo,
    };
    sendBufferResponse(
      res,
      200,
      "application/json",
      Buffer.from(JSON.stringify(snapshot, null, 2), "utf8"),
      "LOCAL-STATS",
      headOnly,
    );
    return;
  }

  if (rawPath === "/metrics") {
    const metricKeys = [
      "HIT-LOCAL",
      "HIT-LOCAL-META",
      "HIT-LOCAL-STALE",
      "HIT-LOCAL-CARGO-CONFIG",
      "MISS-VIA-NEXUS",
      "MISS-VIA-UPSTREAM",
      "MISS-ERROR",
    ] as const;
    const lines: string[] = [
      "# HELP megabyte_local_proxy_requests_total Total proxy requests by cache result",
      "# TYPE megabyte_local_proxy_requests_total counter",
      ...metricKeys.map((key) => `megabyte_local_proxy_requests_total{result="${key}"} ${COUNTERS[key]}`),
      "# HELP megabyte_local_proxy_bytes_total Total bytes served by source",
      "# TYPE megabyte_local_proxy_bytes_total counter",
      `megabyte_local_proxy_bytes_total{source="local"} ${COUNTERS.bytes_served_local}`,
      `megabyte_local_proxy_bytes_total{source="remote"} ${COUNTERS.bytes_served_remote}`,
      "# HELP megabyte_local_proxy_evictions_total Total cached blobs evicted by LRU budget enforcement",
      "# TYPE megabyte_local_proxy_evictions_total counter",
      `megabyte_local_proxy_evictions_total ${COUNTERS.evictions_total}`,
    ];
    sendBufferResponse(
      res,
      200,
      "text/plain; version=0.0.4",
      Buffer.from(`${lines.join("\n")}\n`, "utf8"),
      "LOCAL-METRICS",
      headOnly,
    );
    return;
  }

  let repositoryName = "";
  let relativePath = "";
  if (rawPath.startsWith("/pypi-files/")) {
    repositoryName = "pypi-files";
    relativePath = rawPath.slice("/pypi-files/".length);
  } else if (rawPath.startsWith("/repository/")) {
    const remainder = rawPath.slice("/repository/".length);
    const slashIdx = remainder.indexOf("/");
    if (slashIdx === -1) {
      repositoryName = remainder;
      relativePath = "";
    } else {
      repositoryName = remainder.slice(0, slashIdx);
      relativePath = remainder.slice(slashIdx + 1);
    }
  } else {
    sendBufferResponse(res, 404, "text/plain", Buffer.from("Not Found\n"), "MISS", headOnly);
    return;
  }

  if (repositoryName === "cargo-proxy" && (relativePath.split("?", 1)[0] ?? "") === "config.json") {
    const cargoConfig = Buffer.from(
      JSON.stringify({
        dl: `${CONFIG.localBaseUrl}/repository/cargo-crates-proxy/crates/{crate}/{crate}-{version}.crate`,
        api: "https://crates.io",
      }),
      "utf8",
    );
    recordProxyOutcome("HIT-LOCAL-CARGO-CONFIG", repositoryName, cargoConfig.byteLength);
    sendBufferResponse(res, 200, "application/json", cargoConfig, "HIT-LOCAL-CARGO-CONFIG", headOnly);
    return;
  }

  const acceptHeader = typeof req.headers.accept === "string" ? req.headers.accept : "";
  const acceptDiscriminator =
    repositoryName.includes("npm") || repositoryName.includes("pypi") ? acceptHeader : "";
  const cacheKey = `${repositoryName}/${relativePath}|accept=${acceptDiscriminator}`;
  const immutable = isImmutableArtifact(repositoryName, relativePath);
  const { blobPath, headerPath } = resolveCachePaths(
    immutable ? CONFIG.blobsDir : CONFIG.metadataDir,
    cacheKey,
  );

  if (existsSync(blobPath) && existsSync(headerPath)) {
    try {
      const metadata = JSON.parse(readFileSync(headerPath, "utf8")) as CacheEntryMetadata;
      const nowSeconds = Date.now() / 1000;
      if (immutable || nowSeconds - metadata.ts < CONFIG.metadataFreshTtlSeconds) {
        const cachedPayload = readFileSync(blobPath);
        if (immutable) {
          const nowDate = new Date();
          try {
            utimesSync(blobPath, nowDate, nowDate);
          } catch {
            // Best-effort LRU touch.
          }
        }
        const hitTag = immutable ? "HIT-LOCAL" : "HIT-LOCAL-META";
        recordProxyOutcome(hitTag, repositoryName, cachedPayload.byteLength);
        sendBufferResponse(
          res,
          200,
          metadata.content_type || (immutable ? "application/octet-stream" : "application/json"),
          cachedPayload,
          hitTag,
          headOnly,
        );
        return;
      }
    } catch {
      // Fall through to remote fetch if cached metadata is unreadable.
    }
  }

  const candidates: UpstreamCandidate[] = [];
  if (repositoryName !== "pypi-files") {
    candidates.push({
      tag: "MISS-VIA-NEXUS",
      targetUrl: `${CONFIG.nexusBaseUrl}/repository/${repositoryName}/${relativePath}`,
    });
  }
  const upstreamOrigin = UPSTREAM_REGISTRY_ORIGINS[repositoryName];
  if (upstreamOrigin) {
    candidates.push({
      tag: "MISS-VIA-UPSTREAM",
      targetUrl: `${upstreamOrigin.replace(/\/+$/, "")}/${relativePath}`,
    });
  }

  let lastStatus = 502;
  let lastBody = Buffer.from("Bad Gateway\n", "utf8");

  for (const candidate of candidates) {
    try {
      const remote = await fetchUpstreamArtifact(candidate.targetUrl, req.headers);
      if (remote.status === 200) {
        const rewrittenPayload = rewriteRegistryMetadata(
          repositoryName,
          relativePath,
          remote.contentType,
          remote.body,
        );
        writeAtomically(blobPath, rewrittenPayload);
        const entryMetadata: CacheEntryMetadata = {
          content_type: remote.contentType,
          ts: Date.now() / 1000,
          source: candidate.tag,
        };
        writeAtomically(headerPath, Buffer.from(JSON.stringify(entryMetadata), "utf8"));
        if (immutable) {
          writesSinceLastPrune += 1;
          if (writesSinceLastPrune >= 25) {
            writesSinceLastPrune = 0;
            pruneBlobCacheIfOverBudget();
          }
        }
        recordProxyOutcome(candidate.tag, repositoryName, rewrittenPayload.byteLength);
        sendBufferResponse(res, 200, remote.contentType, rewrittenPayload, candidate.tag, headOnly);
        return;
      }
      lastStatus = remote.status;
      if (remote.body.byteLength > 0) {
        lastBody = remote.body;
      }
    } catch {
      continue;
    }
  }

  if (existsSync(blobPath) && existsSync(headerPath)) {
    try {
      const metadata = JSON.parse(readFileSync(headerPath, "utf8")) as CacheEntryMetadata;
      const stalePayload = readFileSync(blobPath);
      recordProxyOutcome("HIT-LOCAL-STALE", repositoryName, stalePayload.byteLength);
      sendBufferResponse(
        res,
        200,
        metadata.content_type || "application/octet-stream",
        stalePayload,
        "HIT-LOCAL-STALE",
        headOnly,
      );
      return;
    } catch {
      // Ignore corrupt stale entry.
    }
  }

  recordProxyOutcome("MISS-ERROR", repositoryName, 0);
  sendBufferResponse(res, lastStatus, "text/plain", lastBody, "MISS-ERROR", headOnly);
}

const server = createServer((req, res) => {
  void handleProxyRequest(req, res);
});

server.listen(CONFIG.port, CONFIG.host, () => {
  pruneBlobCacheIfOverBudget();
});

TSEOF
chmod 0755 "$HOME/.local/bin/megabyte-local-proxy.ts"

cat <<'SHEOF' > "$HOME/.local/bin/megabyte-local-proxy"
#!/usr/bin/env sh
set -eu
for candidate in /opt/homebrew/bin/node /usr/local/bin/node "${HOME:-}/.local/share/mise/shims/node" "${HOME:-}/.local/bin/node"; do
  if [ -x "$candidate" ]; then
    exec "$candidate" --experimental-strip-types "${HOME}/.local/bin/megabyte-local-proxy.ts" "$@"
  fi
done
exec node --experimental-strip-types "${HOME}/.local/bin/megabyte-local-proxy.ts" "$@"

SHEOF
chmod 0755 "$HOME/.local/bin/megabyte-local-proxy"

# 2. Ensure megabyte-local-proxy runs as an always-on local daemon (macOS LaunchAgent / Linux systemd)
#    The POSIX launcher selects an available Node runtime and runs the strict-TypeScript proxy
#    via `node --experimental-strip-types` — no Python interpreter is involved.
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
ExecStart=${HOME}/.local/bin/megabyte-local-proxy
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
ExecStart=${HOME}/.local/bin/megabyte-local-proxy
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
  nohup "$HOME/.local/bin/megabyte-local-proxy" >/dev/null 2>&1 &
  sleep 0.5
fi

# 3. Install shell environment file (mirrors home/dot_config/shell/megabyte-cache.sh.tmpl)
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
export LANGFUSE_TIMEOUT_MS="\${LANGFUSE_TIMEOUT_MS:-2500}"
export LANGFUSE_FAIL_OPEN="\${LANGFUSE_FAIL_OPEN:-true}"
export LANGFUSE_FLUSH_AT="\${LANGFUSE_FLUSH_AT:-10}"
export LANGFUSE_SPOOL_DIR="\${LANGFUSE_SPOOL_DIR:-\${MEGABYTE_CACHE_ROOT}/ai/langfuse-spool}"
EOF

for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
  if [[ -f "$rc" ]] && ! grep -q "megabyte-cache.sh" "$rc" 2>/dev/null; then
    # shellcheck disable=SC2016 # Write the runtime HOME expression literally into the target rc file.
    printf '\n# Megabyte Nexus & Scoped Cache Configuration\n[ -f "$HOME/.config/shell/megabyte-cache.sh" ] && . "$HOME/.config/shell/megabyte-cache.sh"\n' >> "$rc"
  fi
done

# 4. npm / pnpm / yarn / bun (both ~/.npmrc and XDG ~/.config/npm/npmrc).
#    `store-dir` is NOT written to .npmrc (npm 11+ emits `npm warn Unknown user config "store-dir"`);
#    it is written to ~/.config/pnpm/rc instead.
for npmrc_target in "$HOME/.npmrc" "$HOME/.config/npm/npmrc"; do
  backup_if_exists "$npmrc_target"
  touch "$npmrc_target"
  "$NODE_BIN" -e '
const fs = require("node:fs");
const [file, reg, cache] = process.argv.slice(1);
let lines = [];
try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch {}
const filtered = lines.filter((l) => l && !/^(registry=|cache=|store-dir=)/.test(l));
filtered.push("registry=" + reg, "cache=" + cache);
fs.writeFileSync(file, filtered.join("\n") + "\n");
' "$npmrc_target" "${LOCAL_PROXY_BASE}/repository/npm-group/" "${CACHE_ROOT}/packages/npm" || log_warn "npmrc update skipped for $npmrc_target"
done

# pnpm store-dir lives in ~/.config/pnpm/rc (keeps it out of .npmrc so npm 11+ does not warn)
backup_if_exists "$HOME/.config/pnpm/rc"
"$NODE_BIN" -e '
const fs = require("node:fs");
const [file, store] = process.argv.slice(1);
let lines = [];
try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch {}
const filtered = lines.filter((l) => l && !/^store-dir=/.test(l));
filtered.push("store-dir=" + store);
fs.writeFileSync(file, filtered.join("\n") + "\n");
' "$HOME/.config/pnpm/rc" "${CACHE_ROOT}/packages/pnpm" || log_warn "pnpm rc update skipped"

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

# 6. Cargo (Rust) — both ~/.cargo/config.toml and XDG ~/.local/share/cargo/config.toml so Cargo
#    resolves 127.0.0.1:4880 even when CARGO_HOME is unset in non-interactive shells.
for cargo_dir in "$HOME/.cargo" "$HOME/.local/share/cargo"; do
  mkdir -p "$cargo_dir"
  backup_if_exists "$cargo_dir/config.toml"
  cat <<EOF > "$cargo_dir/config.toml"
[source.crates-io]
replace-with = "megabyte-local"

[source.megabyte-local]
registry = "sparse+${LOCAL_PROXY_BASE}/repository/cargo-proxy/"

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
  local node_script='
const fs = require("node:fs");
const path = require("node:path");
const [file, mirror] = process.argv.slice(1);
fs.mkdirSync(path.dirname(file), { recursive: true });
let data = {};
try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
const mirrors = Array.isArray(data["registry-mirrors"]) ? data["registry-mirrors"] : [];
if (!mirrors.includes(mirror)) mirrors.unshift(mirror);
data["registry-mirrors"] = mirrors;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
'
  if [[ "$use_sudo" == "true" ]]; then
    $SUDO "$NODE_BIN" -e "$node_script" "$target_file" "$REGISTRY_HOST" || true
  else
    "$NODE_BIN" -e "$node_script" "$target_file" "$REGISTRY_HOST" || true
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
    # shellcheck disable=SC1091 # Standard runtime OS metadata, unavailable on non-Linux lint hosts.
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
