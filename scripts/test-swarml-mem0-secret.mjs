#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveSwarmlinkMem0,
  SWARML_MEM0_BINDING,
} from "../home/dot_local/bin/executable_get-swarml-mem0-secret.mjs";

function fixture() {
  const homeDir = mkdtempSync(join(tmpdir(), "swarml-mem0-broker-"));
  const root = join(homeDir, ".config", "agent-fleet");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const tokenPath = join(root, "swarml-infisical-service-token");
  writeFileSync(tokenPath, "fixture-service-token-with-sufficient-length", { mode: 0o600 });
  return { homeDir, tokenPath };
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

{
  const { homeDir } = fixture();
  const urls = [];
  const value = await resolveSwarmlinkMem0({
    homeDir,
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return jsonResponse(200, { secrets: [{ secretKey: "MEM0_API_KEY" }] });
      }
      return jsonResponse(200, {
        secret: { secretKey: "MEM0_API_KEY", secretValue: "fixture-mem0-value" },
      });
    },
  });
  assert.equal(value, "fixture-mem0-value");
  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.match(url, new RegExp(SWARML_MEM0_BINDING.projectId));
    assert.match(url, /environment=prod/);
    assert.match(url, /secretPath=%2F/);
  }
}

{
  const { homeDir } = fixture();
  let calls = 0;
  await assert.rejects(
    resolveSwarmlinkMem0({
      homeDir,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(200, {
          secrets: [{ secretKey: "MEM0_API_KEY" }, { secretKey: "DEEPSEEK_API_KEY" }],
        });
      },
    }),
    /scope no longer matches/,
  );
  assert.equal(calls, 1, "scope drift must fail before an exact-value lookup");
}

for (const status of [401, 403, 404, 429, 500, 503]) {
  const { homeDir } = fixture();
  await assert.rejects(
    resolveSwarmlinkMem0({
      homeDir,
      fetchImpl: async () => jsonResponse(status, { error: "fixture" }),
    }),
    /lookup failed/,
  );
}

{
  const { homeDir, tokenPath } = fixture();
  chmodSync(tokenPath, 0o640);
  await assert.rejects(resolveSwarmlinkMem0({ homeDir }), /owner-only/);
}

{
  const { homeDir } = fixture();
  await assert.rejects(
    resolveSwarmlinkMem0({
      homeDir,
      fetchImpl: async () => jsonResponse(200, { secrets: [{ secretKey: "MEM0_API_KEY" }] }),
    }),
    /response is malformed/,
  );
}

console.log("swarml MEM0 workload broker tests: PASS");
