#!/usr/bin/env -S node --experimental-strip-types
/**
 * Integration & Behavioral Test Suite for Canonical Workstation TypeScript Daemons:
 * - megabyte-local-proxy.ts (:4880 runtime contract)
 * - ollama-auth-proxy.ts (:11435 zero-buffering auth gateway contract)
 * - workstation-hw-exporter.ts (:9835 Prometheus telemetry contract)
 * - workstation-doctor.ts (JSON diagnostic schema contract)
 */

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(CURRENT_DIR);
const NODE_BIN = process.execPath;

function extractHeredoc(scriptPath: string, pattern: RegExp, outputName: string): string {
  const source = readFileSync(scriptPath, "utf8");
  const match = source.match(pattern);
  assert.ok(match?.[1], `Unable to extract ${outputName} from ${scriptPath}`);
  const outputPath = join(FIXTURE_DIR, outputName);
  writeFileSync(outputPath, match[1], { mode: 0o755 });
  return outputPath;
}

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "workstation-daemons-"));
const LOCAL_PROXY_PATH = join(REPO_ROOT, "home/dot_local/bin/executable_megabyte-local-proxy.ts");
const DOCTOR_PATH = join(REPO_ROOT, "home/dot_local/bin/executable_workstation-doctor.ts");
const OLLAMA_PROXY_PATH = extractHeredoc(
  join(REPO_ROOT, "home/dot_local/bin/post-installx/executable_post-litellm-enroll.sh"),
  /cat <<'TSEOF' > "\$HOME\/\.local\/bin\/ollama-auth-proxy\.ts"\n([\s\S]*?)\nTSEOF/,
  "ollama-auth-proxy.ts",
);
const HW_EXPORTER_PATH = extractHeredoc(
  join(REPO_ROOT, "home/dot_local/bin/post-installx/executable_post-workstation.sh"),
  /cat > "\$TMP_DIR\/workstation-hw-exporter\.ts" <<'TSEOF'\n([\s\S]*?)\nTSEOF/,
  "workstation-hw-exporter.ts",
);

function allocateRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Unable to allocate ephemeral port")));
      }
    });
  });
}

async function waitForHttpReady(url: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.status > 0) {
        await res.arrayBuffer();
        return;
      }
    } catch {
      // Retry until ready.
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

describe("Workstation TypeScript Daemons", () => {
  const children: ChildProcess[] = [];
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  after(() => {
    for (const child of children) {
      child.kill("SIGTERM");
    }
    for (const srv of servers) {
      srv.close();
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("megabyte-local-proxy.ts serves /healthz, /stats, /metrics, and cargo-proxy config.json", async () => {
    const port = await allocateRandomPort();
    const cacheDir = mkdtempSync(join(tmpdir(), "mb-proxy-test-"));
    tempDirs.push(cacheDir);

    const proc = spawn(NODE_BIN, ["--experimental-strip-types", LOCAL_PROXY_PATH], {
      env: {
        ...process.env,
        MEGABYTE_LOCAL_PROXY_PORT: String(port),
        MEGABYTE_CACHE_ROOT: cacheDir,
      },
      stdio: "ignore",
    });
    children.push(proc);

    const base = `http://127.0.0.1:${port}`;
    await waitForHttpReady(`${base}/healthz`);

    const healthRes = await fetch(`${base}/healthz`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as Record<string, unknown>;
    assert.equal(healthJson.status, "ok");
    assert.equal(healthJson.runtime, "node-typescript");

    const cargoRes = await fetch(`${base}/repository/cargo-proxy/config.json`);
    assert.equal(cargoRes.status, 200);
    assert.equal(cargoRes.headers.get("x-megabyte-cache"), "HIT-LOCAL-CARGO-CONFIG");
    const cargoJson = (await cargoRes.json()) as { dl: string; api: string };
    assert.ok(cargoJson.dl.startsWith(`${base}/repository/cargo-crates-proxy/`));

    const statsRes = await fetch(`${base}/stats`);
    assert.equal(statsRes.status, 200);
    const statsJson = (await statsRes.json()) as { total_hits: number };
    assert.equal(statsJson.total_hits, 1);

    const metricsRes = await fetch(`${base}/metrics`);
    assert.equal(metricsRes.status, 200);
    const metricsText = await metricsRes.text();
    assert.match(metricsText, /megabyte_local_proxy_requests_total\{result="HIT-LOCAL-CARGO-CONFIG"\} 1/);
  });

  it("ollama-auth-proxy.ts enforces constant-time Bearer token auth and streams upstream responses", async () => {
    const upstreamPort = await allocateRandomPort();
    const proxyPort = await allocateRandomPort();
    const tempDir = mkdtempSync(join(tmpdir(), "ollama-proxy-test-"));
    tempDirs.push(tempDir);
    const tokenFile = join(tempDir, "ollama-gateway.token");
    writeFileSync(tokenFile, "super-secret-gateway-token-999\n", { mode: 0o600 });

    const upstream = createServer((req, res) => {
      if (req.url === "/api/version") {
        const body = JSON.stringify({ version: "0.40.13-mock", authStripped: !req.headers.authorization });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
        return;
      }
      res.writeHead(404).end();
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(upstreamPort, "127.0.0.1", resolve));

    const proc = spawn(NODE_BIN, ["--experimental-strip-types", OLLAMA_PROXY_PATH], {
      env: {
        ...process.env,
        OLLAMA_PROXY_PORT: String(proxyPort),
        OLLAMA_UPSTREAM_PORT: String(upstreamPort),
        OLLAMA_GATEWAY_TOKEN_FILE: tokenFile,
      },
      stdio: "ignore",
    });
    children.push(proc);

    const base = `http://127.0.0.1:${proxyPort}`;
    await waitForHttpReady(`${base}/healthz`);

    const unauthRes = await fetch(`${base}/api/version`);
    assert.equal(unauthRes.status, 401);

    const wrongTokenRes = await fetch(`${base}/api/version`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    assert.equal(wrongTokenRes.status, 401);

    const validRes = await fetch(`${base}/api/version`, {
      headers: { Authorization: "Bearer super-secret-gateway-token-999" },
    });
    assert.equal(validRes.status, 200);
    const validJson = (await validRes.json()) as { version: string; authStripped: boolean };
    assert.equal(validJson.version, "0.40.13-mock");
    assert.equal(validJson.authStripped, true);
  });

  it("workstation-hw-exporter.ts serves valid Prometheus metrics and /healthz", async () => {
    const exporterPort = await allocateRandomPort();
    const proc = spawn(NODE_BIN, ["--experimental-strip-types", HW_EXPORTER_PATH], {
      env: {
        ...process.env,
        HW_EXPORTER_PORT: String(exporterPort),
      },
      stdio: "ignore",
    });
    children.push(proc);

    const base = `http://127.0.0.1:${exporterPort}`;
    await waitForHttpReady(`${base}/healthz`);

    const metricsRes = await fetch(`${base}/metrics`);
    assert.equal(metricsRes.status, 200);
    const body = await metricsRes.text();
    assert.match(body, /# HELP nvidia_gpu_temperature_celsius/);
    assert.match(body, /# HELP nvme_smart_critical_warning/);
  });

  it("workstation-doctor.ts --json emits a structured WorkstationDoctorReport", () => {
    const res = spawnSync(
      NODE_BIN,
      ["--experimental-strip-types", DOCTOR_PATH, "--json"],
      { encoding: "utf8", timeout: 15_000 },
    );
    const parsed = JSON.parse(res.stdout) as {
      host: string;
      platform: string;
      findings: unknown[];
      passedCount: number;
    };
    assert.equal(typeof parsed.host, "string");
    assert.ok(Array.isArray(parsed.findings));
    assert.ok(parsed.findings.length >= 6);
  });
});
