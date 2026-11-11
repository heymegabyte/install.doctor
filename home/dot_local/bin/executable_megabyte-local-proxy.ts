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
mkdirSync(join(CONFIG.cacheRootDir, "logs"), { recursive: true });

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
  const payloadExtension = baseDirectory === CONFIG.metadataDir ? ".body.json" : ".bin";
  return {
    blobPath: join(shardDirectory, `${digest}${payloadExtension}`),
    headerPath: join(shardDirectory, `${digest}.hdr.json`),
  };
}

function pruneLegacyMetadataBinFiles(): void {
  try {
    for (const shard of readdirSync(CONFIG.metadataDir)) {
      const shardPath = join(CONFIG.metadataDir, shard);
      let shardFiles: string[];
      try {
        shardFiles = readdirSync(shardPath);
      } catch {
        continue;
      }
      for (const fileName of shardFiles) {
        if (!fileName.endsWith(".json")) {
          rmSync(join(shardPath, fileName), { force: true });
        }
      }
    }
  } catch {
    // Metadata cleanup is best-effort and never blocks proxy traffic.
  }
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

async function readBoundedRequestBody(req: IncomingMessage, maxBytes = 268_435_456): Promise<Buffer> {
  return new Promise<Buffer>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        rejectBody(new Error("Request payload exceeds maximum CAS blob size"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", rejectBody);
  });
}

async function handleProxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.on("error", () => {
    // Suppress client disconnect BrokenPipe/ECONNRESET noise.
  });

  const method = (req.method ?? "GET").toUpperCase();
  const rawPath = req.url ?? "/";
  const pathname = rawPath.split("?", 1)[0] ?? "/";

  // Turborepo Remote Cache status probe & CAS /v8/artifacts/:hash + /cas/v1/blobs/:sha256 (EPIC-36)
  if (pathname === "/v8/artifacts/status" && (method === "GET" || method === "HEAD")) {
    const statusPayload = Buffer.from(JSON.stringify({ status: "enabled" }), "utf8");
    sendBufferResponse(res, 200, "application/json", statusPayload, "HIT-LOCAL", method === "HEAD");
    return;
  }

  const casMatch = pathname.match(/^\/(?:v8\/artifacts|cas\/v1\/blobs)\/([a-fA-F0-9_-]{8,128})$/);
  if (casMatch?.[1] && (method === "GET" || method === "HEAD" || method === "PUT")) {
    const artifactHash = casMatch[1];
    const { blobPath, headerPath } = resolveCachePaths(CONFIG.blobsDir, `cas/${artifactHash}`);
    if (method === "PUT") {
      try {
        const body = await readBoundedRequestBody(req);
        writeAtomically(blobPath, body);
        const meta: CacheEntryMetadata = {
          content_type: "application/octet-stream",
          ts: Date.now() / 1000,
          source: "HIT-LOCAL",
        };
        writeAtomically(headerPath, Buffer.from(JSON.stringify(meta), "utf8"));
        const putResp = Buffer.from(
          JSON.stringify({ urls: [`${CONFIG.localBaseUrl}/v8/artifacts/${artifactHash}`] }),
          "utf8",
        );
        sendBufferResponse(res, 202, "application/json", putResp, "HIT-LOCAL", false);
      } catch {
        sendBufferResponse(res, 413, "text/plain", Buffer.from("Payload Too Large\n"), "MISS-ERROR", false);
      }
      return;
    }
    if (existsSync(blobPath)) {
      const payload = readFileSync(blobPath);
      recordProxyOutcome("HIT-LOCAL", "cas-turbo", payload.byteLength);
      sendBufferResponse(res, 200, "application/octet-stream", payload, "HIT-LOCAL", method === "HEAD");
      return;
    }
    sendBufferResponse(res, 404, "text/plain", Buffer.from("Artifact Not Found\n"), "MISS", method === "HEAD");
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    sendBufferResponse(res, 405, "text/plain", Buffer.from("Method Not Allowed\n"), "MISS", false);
    return;
  }
  const headOnly = method === "HEAD";

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
  pruneLegacyMetadataBinFiles();
  pruneBlobCacheIfOverBudget();
});
