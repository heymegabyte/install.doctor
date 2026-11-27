import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  const source = readFileSync(fileURLToPath(new URL("../home/dot_local/bin/executable_megabyte-local-proxy.ts", import.meta.url)));
  const script = join(cache, "megabyte-local-proxy.ts");
  writeFileSync(script, source);
  const child = spawn(process.execPath, [
    "--experimental-strip-types", "--import", `data:text/javascript;base64,${Buffer.from(intercept).toString("base64")}`, script,
  ], {
    env: { ...process.env, MEGABYTE_LOCAL_PROXY_HOST: "127.0.0.1", MEGABYTE_LOCAL_PROXY_PORT: String(port),
      MEGABYTE_CACHE_ROOT: cache, MEGABYTE_NEXUS_URL: nexus, MEGABYTE_LOCAL_PROXY_META_TTL: "1", MEGABYTE_LOCAL_PROXY_SOURCE_SHA256: "0".repeat(64) },
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
  const startupDigest = createHash("sha256").update(source).digest("hex");
  const replacementPath = join(cache, "replacement.ts");
  const replacement = Buffer.concat([source, Buffer.from("\n// Isolated replacement fixture\n")]);
  const replacementDigest = createHash("sha256").update(replacement).digest("hex");
  const readHealthIdentity = async () => {
    const response = await fetch(proxy + "/healthz", { signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200);
    return (await response.json()).source_sha256;
  };
  assert.equal(await readHealthIdentity(), startupDigest);
  assert.notEqual(replacementDigest, startupDigest);
  writeFileSync(replacementPath, replacement);
  renameSync(replacementPath, script);
  assert.equal(createHash("sha256").update(readFileSync(script)).digest("hex"), replacementDigest);
  assert.equal(await readHealthIdentity(), startupDigest);
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
  // Model on-disk entries left by older versions of the proxy.
  const legacyEntries = [
    { path: "/repository/npm-group/@theme-tools%2flegacy-fresh", age: 0, directory: "meta", extension: ".body.json" },
    { path: "/repository/npm-group/@theme-tools%2flegacy-stale", age: 60, directory: "meta", extension: ".body.json" },
    { path: "/repository/npm-group/@theme.tools/legacy/-/legacy-1.0.0.tgz", age: 0, directory: "blobs", extension: ".bin" },
  ];
  for (const { path, age, directory, extension } of legacyEntries) {
    const key = path.slice("/repository/".length) + "|accept=*/*";
    const digest = createHash("sha256").update(key).digest("hex");
    const shard = join(cache, "local-proxy", directory, digest.slice(0, 2));
    mkdirSync(shard, { recursive: true });
    writeFileSync(join(shard, digest + extension), Buffer.from("legacy cache fixture"));
    writeFileSync(join(shard, digest + ".hdr.json"), JSON.stringify({
      content_type: "application/octet-stream",
      source: "MISS-VIA-UPSTREAM",
      ts: Date.now() / 1000 - age,
    }));
  }
  assert.deepEqual(await read(tarballPath, "HIT-LOCAL"), archive);
  assert.deepEqual(await read(packagePath, "HIT-LOCAL-STALE"), metadata);
  for (const path of [
    "/repository/npm-group/@theme-tools%2fcold",
    "/repository/npm-proxy/%40theme.tools%2Fcold",
    "/repository/npm-group/@theme.tools/cold/-/cold-1.0.0.tgz",
    ...legacyEntries.map(({ path }) => path),
  ]) {
    const rejected = await fetch(proxy + path, { signal: AbortSignal.timeout(5_000) });
    assert.equal(rejected.status, 503);
    assert.equal(rejected.headers.get("x-megabyte-cache"), "MISS-ERROR");
    await rejected.arrayBuffer();
  }
  assert.deepEqual(await read("/repository/npm-group/is-number/-/is-number-7.0.0.tgz", "MISS-VIA-UPSTREAM"), publicArchive);
  assert.deepEqual(upstreamRequests, ["/public/is-number/-/is-number-7.0.0.tgz"]);
});
