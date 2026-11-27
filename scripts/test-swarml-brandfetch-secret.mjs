#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveSwarmlinkBrandfetch,
  SWARML_BRANDFETCH_BINDING,
} from "../home/dot_local/bin/executable_get-swarml-brandfetch-secret.mjs";

function fixture() {
  const homeDir = mkdtempSync(join(tmpdir(), "swarml-brandfetch-broker-"));
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
  const value = await resolveSwarmlinkBrandfetch({
    homeDir,
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return jsonResponse(200, { secrets: [{ secretKey: "BRANDFETCH_API_KEY" }] });
      }
      return jsonResponse(200, {
        secret: { secretKey: "BRANDFETCH_API_KEY", secretValue: "fixture-brandfetch-value" },
      });
    },
  });
  assert.equal(value, "fixture-brandfetch-value");
  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.match(url, new RegExp(SWARML_BRANDFETCH_BINDING.projectId));
    assert.match(url, /environment=prod/);
    assert.match(url, /secretPath=%2Fproviders%2Fbrandfetch/);
  }
}

{
  const { homeDir } = fixture();
  let calls = 0;
  await assert.rejects(
    resolveSwarmlinkBrandfetch({
      homeDir,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(200, {
          secrets: [{ secretKey: "BRANDFETCH_API_KEY" }, { secretKey: "MEM0_API_KEY" }],
        });
      },
    }),
    /scope no longer matches/,
  );
  assert.equal(calls, 1, "scope drift must fail before an exact-value lookup");
}

for (const status of [301, 401, 403, 404, 429, 500, 503]) {
  const { homeDir } = fixture();
  await assert.rejects(
    resolveSwarmlinkBrandfetch({
      homeDir,
      fetchImpl: async () => jsonResponse(status, { error: "fixture" }),
    }),
    status === 301 ? /Redirect refused/ : /lookup failed/,
  );
}

{
  const { homeDir, tokenPath } = fixture();
  chmodSync(tokenPath, 0o640);
  await assert.rejects(resolveSwarmlinkBrandfetch({ homeDir }), /owner-only/);
}

console.log("swarml Brandfetch workload broker tests: PASS");
