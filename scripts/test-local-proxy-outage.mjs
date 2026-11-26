import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("an npm cache survives a Nexus outage and still serves cold public artifacts", async t => {
  const cache = mkdtempSync(join(tmpdir(), "install-doctor-proxy-test-"));
  const archive = Buffer.from("first-party npm tarball fixture");
  const publicArchive = Buffer.from("public npm tarball fixture");
  const packagePath = "/repository/npm-group/@theme-tools%2ftesting";
  const tarballPath = "/repository/npm-group/@theme-tools/testing/-/testing-1.0.0.tgz";
  let nexusAvailable = true;
  const upstreamRequests = [];
  const fixture = createServer((request, response) => {
    if (request.url.startsWith("/public/")) upstreamRequests.push(request.url);
    if (request.url === "/public/is-number/-/is-number-7.0.0.tgz") {
      response.end(publicArchive);
    } else if (!nexusAvailable) {
      response.writeHead(503).end();
    } else if (request.url === packagePath) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ versions: { "1.0.0": { dist: { tarball: nexus + tarballPath } } } }));
    } else if (request.url === tarballPath) {
      response.end(archive);
    } else {
      response.writeHead(404).end();
    }
  });
  const nexus = `http://127.0.0.1:${await listen(fixture)}`;
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const proxy = `http://127.0.0.1:${port}`;
  const intercept = `
    const fetchImpl = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      const url = new URL(input);
      if (url.origin === "https://registry.npmjs.org") {
        return fetchImpl(${JSON.stringify(nexus)} + "/public" + url.pathname, options);
      }
      if (url.origin !== ${JSON.stringify(nexus)}) throw new Error("Unexpected registry request");
      return fetchImpl(input, options);
    };
  `;
  const script = fileURLToPath(new URL("../home/dot_local/bin/executable_megabyte-local-proxy.ts", import.meta.url));
  const child = spawn(process.execPath, [
    "--experimental-strip-types", "--import", `data:text/javascript;base64,${Buffer.from(intercept).toString("base64")}`, script,
  ], {
    env: { ...process.env, MEGABYTE_LOCAL_PROXY_HOST: "127.0.0.1", MEGABYTE_LOCAL_PROXY_PORT: String(port),
      MEGABYTE_CACHE_ROOT: cache, MEGABYTE_NEXUS_URL: nexus, MEGABYTE_LOCAL_PROXY_META_TTL: "1" },
    stdio: "inherit",
  });
  const exited = once(child, "exit");
  t.after(async () => {
    child.kill();
    await exited;
    await close(fixture);
    rmSync(cache, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    const health = await fetch(proxy + "/healthz").catch(() => undefined);
    if (health?.ok) break;
    if (attempt === 49) assert.fail("Local proxy startup timed out");
    await setTimeout(100);
  }
  const read = async (path, expectedCache) => {
    const response = await fetch(proxy + path, { signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-megabyte-cache"), expectedCache);
    return Buffer.from(await response.arrayBuffer());
  };
  const metadata = await read(packagePath, "MISS-VIA-NEXUS");
  assert.equal(JSON.parse(metadata).versions["1.0.0"].dist.tarball, proxy + tarballPath);
  assert.deepEqual(await read(tarballPath, "MISS-VIA-NEXUS"), archive);

  nexusAvailable = false;
  await setTimeout(1_100);
  assert.deepEqual(await read(tarballPath, "HIT-LOCAL"), archive);
  assert.deepEqual(await read(packagePath, "HIT-LOCAL-STALE"), metadata);
  for (const path of [
    "/repository/npm-group/@theme-tools%2fcold",
    "/repository/npm-proxy/%40theme.tools%2Fcold",
    "/repository/npm-group/@theme.tools/cold/-/cold-1.0.0.tgz",
  ]) {
    const rejected = await fetch(proxy + path, { signal: AbortSignal.timeout(5_000) });
    assert.equal(rejected.status, 503);
    assert.equal(rejected.headers.get("x-megabyte-cache"), "MISS-ERROR");
    await rejected.arrayBuffer();
  }
  assert.deepEqual(await read("/repository/npm-group/is-number/-/is-number-7.0.0.tgz", "MISS-VIA-UPSTREAM"), publicArchive);
  assert.deepEqual(upstreamRequests, ["/public/is-number/-/is-number-7.0.0.tgz"]);
});
