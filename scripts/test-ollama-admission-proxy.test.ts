import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

test("streams hold admission slots until the upstream closes", { timeout: 10000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ollama-stream-test-"));
  t.after(() => rmSync(directory, { recursive: true }));
  const tokenPath = join(directory, "token");
  const drainPath = join(directory, "drain");
  writeFileSync(tokenPath, "fixture-token", { mode: 0o600 });

  const { promise: upstreamClosed, resolve: markClosed } = Promise.withResolvers<void>();
  let upstreamRequests = 0;
  let inventoryRequests = 0;
  let inventoryMode: "valid" | "missing" | "malformed" | "unavailable" | "oversized" | "timeout" = "valid";
  const models = ["qwen2.5:7b-instruct", "qwen2.5-coder:14b", "nomic-embed-text:latest"]
    .map((name) => ({ name, digest: "a".repeat(64) }));
  const upstream = createServer(async (request, response) => {
    if (request.url === "/api/tags") {
      inventoryRequests += 1;
      if (inventoryMode === "timeout") return;
      if (inventoryMode === "unavailable") response.writeHead(503);
      const value = inventoryMode === "malformed" ? "{"
        : inventoryMode === "oversized" ? " ".repeat(70000)
        : JSON.stringify({ models: inventoryMode === "missing" ? models.slice(1) : models });
      response.end(value);
      return;
    }
    upstreamRequests += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, "qwen2.5:7b-instruct");
    if (request.url === "/api/generate") {
      assert.equal(body.options.num_ctx, upstreamRequests === 1 ? 2048 : 4096);
    } else {
      assert.equal(request.url, "/v1/chat/completions");
      assert.deepEqual(body.messages, [{ role: "user", content: "READY" }]);
    }
    assert.equal(body.options?.temperature ?? body.temperature, 0);
    assert.equal(body.keep_alive, upstreamRequests === 1 ? 0 : 1800);
    if (upstreamRequests === 1) response.once("close", markClosed);
    response.write('{"partial":true}\n');
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const upstreamAddress = upstream.address();
  assert(upstreamAddress && typeof upstreamAddress !== "string");

  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const proxyAddress = probe.address();
  assert(proxyAddress && typeof proxyAddress !== "string");
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => error ? reject(error) : resolve()),
  );

  const proxy = spawn(process.execPath, ["home/dot_local/libexec/executable_ollama-admission-proxy.mts"], {
    env: {
      ...process.env,
      OLLAMA_PROXY_PORT: String(proxyAddress.port),
      OLLAMA_UPSTREAM_PORT: String(upstreamAddress.port),
      OLLAMA_GATEWAY_TOKEN_FILE: tokenPath,
      OLLAMA_PROXY_DRAIN_FILE: drainPath,
    },
    stdio: "ignore",
  });
  t.after(() => proxy.kill());

  const origin = `http://127.0.0.1:${proxyAddress.port}`;
  const ready = AbortSignal.any([t.signal, AbortSignal.timeout(5000)]);
  try {
    while (!await fetch(`${origin}/healthz`, { signal: ready }).then((response) => response.ok, () => false)) {
      assert.equal(proxy.exitCode, null, "Proxy exited before its health endpoint was ready");
      assert.equal(proxy.signalCode, null, "Proxy was terminated before its health endpoint was ready");
      await delay(25, undefined, { signal: ready });
    }
  } catch (error) {
    if (ready.aborted) throw new Error("Proxy health endpoint did not become ready within five seconds", { cause: error });
    throw error;
  }

  const admission = (token?: string) => fetch(origin + "/admissionz", {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  const unauthenticated = await admission();
  assert.equal(unauthenticated.status, 401);
  await unauthenticated.text();
  assert.equal(inventoryRequests, 0);
  const initialAdmission = await admission("fixture-token");
  assert.equal(initialAdmission.status, 200);
  await initialAdmission.text();
  for (inventoryMode of ["missing", "malformed", "unavailable", "oversized", "timeout"] as const) {
    const unavailable = await admission("fixture-token");
    assert.equal(unavailable.status, 503, inventoryMode);
    assert.equal((await unavailable.json()).available, false);
  }
  inventoryMode = "valid";
  const recoveredAdmission = await admission("fixture-token");
  assert.equal(recoveredAdmission.status, 200);
  await recoveredAdmission.text();

  const tokenTimestamp = new Date("2026-01-01T00:00:00Z");
  utimesSync(tokenPath, tokenTimestamp, tokenTimestamp);
  const checkCredential = async (token: string) => {
    const response = await fetch(origin + "/api/delete", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: "{}",
    });
    await response.text();
    return response.status;
  };
  assert.equal(await checkCredential("fixture-token"), 404);
  const replacement = join(directory, "replacement");
  writeFileSync(replacement, "rotated-token", { mode: 0o600 });
  utimesSync(replacement, tokenTimestamp, tokenTimestamp);
  renameSync(replacement, tokenPath);
  assert.equal(await checkCredential("fixture-token"), 401);
  assert.equal(await checkCredential("rotated-token"), 404);
  rmSync(tokenPath);
  assert.equal(await checkCredential("rotated-token"), 401);
  writeFileSync(tokenPath, "fixture-token", { mode: 0o600 });

  for (const path of ["/api/pull", "/api/delete", "/api/push", "/api/%70ull"]) {
    const denied = await fetch(origin + path, {
      method: "POST",
      headers: { Authorization: "Bearer fixture-token" },
      body: "{}",
    });
    assert.equal(denied.status, 404);
    await denied.text();
  }
  assert.equal(upstreamRequests, 0);

  const unknown = await fetch(origin + "/api/generate", {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify({ model: "unapproved-model" }),
  });
  assert.equal(unknown.status, 403);
  await unknown.text();
  assert.equal(upstreamRequests, 0);

  const client = new AbortController();
  t.after(() => client.abort());
  const invalid = await fetch(`${origin}/api/generate`, {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify({ model: "qwen2.5:7b-instruct", options: { num_ctx: -1 } }),
  });
  assert.equal(invalid.status, 400);
  await invalid.text();
  assert.equal(upstreamRequests, 0);

  for (const fields of [{ keep_alive: "not-a-duration" }, { Keep_Alive: -1 }]) {
    const response = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: { Authorization: "Bearer fixture-token" },
      body: JSON.stringify({ model: "qwen2.5:7b-instruct", ...fields }),
    });
    assert.equal(response.status, 400);
    await response.text();
  }
  assert.equal(upstreamRequests, 0);

  const generate = (signal: AbortSignal, num_ctx = 65536, keep_alive: number | string = "1h15m") => fetch(`${origin}/api/generate`, {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify({ model: "qwen2.5:7b-instruct", keep_alive, options: { num_ctx, temperature: 0 } }),
    signal,
  });
  const response = await generate(client.signal, 2048, 0);
  assert.equal(response.status, 200);
  assert(response.body);
  const first = await response.body.getReader().read();
  assert.equal(new TextDecoder().decode(first.value), '{"partial":true}\n');
  const secondClient = new AbortController();
  t.after(() => secondClient.abort());
  const compatible = await fetch(`${origin}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: "Bearer fixture-token" },
    body: JSON.stringify({
      model: "qwen2.5:7b-instruct", keep_alive: -1, temperature: 0,
      messages: [{ role: "user", content: "READY" }],
    }),
    signal: secondClient.signal,
  });
  assert.equal(compatible.status, 200);
  const refused = await generate(AbortSignal.timeout(1000));
  assert.equal(refused.status, 503);
  assert.equal(upstreamRequests, 2);
  client.abort();

  await Promise.race([
    upstreamClosed,
    delay(1500, undefined, { ref: false }).then(() => assert.fail("Upstream stream stayed open")),
  ]);

  writeFileSync(drainPath, "");
  const readiness = await fetch(`${origin}/admissionz`, { headers: { Authorization: "Bearer fixture-token" } });
  assert.equal(readiness.status, 503);
  assert.deepEqual(await readiness.json(), { draining: true, inFlight: 1, available: false });
  const drainRefused = await generate(AbortSignal.timeout(1000));
  assert.equal(drainRefused.status, 503);
  assert.deepEqual(await drainRefused.json(), { error: "Ollama origin is draining" });
  assert.equal(upstreamRequests, 2);
  unlinkSync(drainPath);

  const retryDeadline = AbortSignal.timeout(1000);
  while (true) {
    const retry = await generate(retryDeadline);
    if (retry.status === 200) break;
    assert.equal(retry.status, 503);
    await delay(20, undefined, { signal: retryDeadline });
  }
  assert.equal(upstreamRequests, 3);
});
