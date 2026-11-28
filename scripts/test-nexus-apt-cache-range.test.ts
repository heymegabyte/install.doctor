import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("Debian resume uses a complete warm archive and preserves If-Range origin validation", async () => {
  const fixture = Buffer.concat([Buffer.from("!<arch>\n"), Buffer.alloc(24, 0x61)]);
  const path = "/repository/apt-ubuntu-proxy/pool/example.deb";
  const cache = await mkdtemp(join(tmpdir(), "legion-apt-range-"));
  let originStatus = 200;
  let requests = 0;
  let lastIfRange: string | undefined;
  const origin = createServer((request, response) => {
    requests++;
    lastIfRange = request.headers["if-range"];
    assert.equal(request.url, path);
    if (originStatus === 206) {
      response.writeHead(206, { "Content-Range": "bytes 0-7/32" });
      response.end(fixture.subarray(0, 8));
      return;
    }
    response.writeHead(originStatus, { "Content-Type": "application/x-debian-package" });
    response.end(originStatus === 200 ? fixture : undefined);
  });
  const reserve = createServer();
  origin.listen(0, "127.0.0.1");
  reserve.listen(0, "127.0.0.1");
  await Promise.all([once(origin, "listening"), once(reserve, "listening")]);
  const originAddress = origin.address();
  const proxyAddress = reserve.address();
  assert.ok(originAddress && typeof originAddress !== "string");
  assert.ok(proxyAddress && typeof proxyAddress !== "string");
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const base = `http://127.0.0.1:${proxyAddress.port}`;
  const script = process.env.MEGABYTE_PROXY_TEST_SCRIPT ?? fileURLToPath(
    new URL("../home/dot_local/bin/executable_megabyte-local-proxy.ts", import.meta.url),
  );
  const proxy = spawn(process.execPath, ["--experimental-strip-types", script], {
    env: {
      ...process.env,
      MEGABYTE_LOCAL_PROXY_PORT: String(proxyAddress.port),
      MEGABYTE_CACHE_ROOT: cache,
      MEGABYTE_NEXUS_URL: `http://127.0.0.1:${originAddress.port}`,
    },
    stdio: "ignore",
  });
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        if ((await fetch(base + "/healthz", { signal: AbortSignal.timeout(500) })).ok) break;
      } catch {
        // Wait for the fixture process to bind.
      }
      assert.ok(attempt < 30 && proxy.exitCode === null);
      await delay(50);
    }
    const url = base + path;
    originStatus = 206;
    const coldPart = await fetch(url, { headers: { range: "bytes=0-7" } });
    assert.equal(coldPart.status, 206);
    assert.equal(coldPart.headers.get("x-megabyte-cache"), "BYPASS-RANGE");
    assert.deepEqual(Buffer.from(await coldPart.arrayBuffer()), fixture.subarray(0, 8));
    originStatus = 200;
    const cold = await fetch(url);
    assert.equal(cold.status, 200);
    assert.deepEqual(Buffer.from(await cold.arrayBuffer()), fixture);
    originStatus = 401;
    for (const [range, start, end] of [
      ["bytes=0-7", 0, 7],
      ["bytes=8-", 8, 31],
      ["bytes=-4", 28, 31],
    ] as const) {
      const part = await fetch(url, { headers: { range } });
      assert.equal(part.status, 206);
      assert.equal(part.headers.get("content-range"), `bytes ${start}-${end}/32`);
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), fixture.subarray(start, end + 1));
    }
    const outside = await fetch(url, { headers: { range: "bytes=32-" } });
    assert.equal(outside.status, 416);
    assert.equal(outside.headers.get("content-range"), "bytes */32");
    assert.equal(requests, 2);
    const conditional = await fetch(url, { headers: { range: "bytes=0-7", "if-range": '"fixture"' } });
    assert.equal(conditional.status, 401);
    assert.equal(lastIfRange, '"fixture"');
    assert.equal(requests, 3);
  } finally {
    proxy.kill();
    if (proxy.exitCode === null && proxy.signalCode === null) await once(proxy, "exit");
    await new Promise<void>((resolve) => origin.close(() => resolve()));
    await rm(cache, { recursive: true });
  }
});
