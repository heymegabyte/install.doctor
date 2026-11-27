#!/usr/bin/env node

import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { fileURLToPath } from "node:url";

export const SWARML_MEM0_BINDING = Object.freeze({
  origin: "https://app.infisical.com",
  projectId: "cb49d4e4-4b17-46c4-9807-a48ada5e040b",
  environment: "prod",
  secretPath: "/",
  secretName: "MEM0_API_KEY",
  tokenRelativePath: ".config/agent-fleet/swarml-infisical-service-token",
  requestTimeoutMs: 10_000,
});

function enableVerifiedSystemCaTrust() {
  setDefaultCACertificates([
    ...new Set([...getCACertificates("default"), ...getCACertificates("system")]),
  ]);
}

function readOwnerOnlyToken(tokenPath, expectedUid) {
  const info = lstatSync(tokenPath);
  const uid = expectedUid ?? (typeof process.getuid === "function" ? process.getuid() : info.uid);
  if (!info.isFile() || info.uid !== uid || (info.mode & 0o077) !== 0) {
    throw new Error("Workload credential is not owner-only");
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  if (token.length < 20 || token.length > 4096 || /[\r\n]/.test(token)) {
    throw new Error("Workload credential is malformed");
  }
  return token;
}

async function requestJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "swarml-mem0-broker/1.0",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(SWARML_MEM0_BINDING.requestTimeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Redirect refused");
  }
  if (!response.ok) {
    throw new Error("Workload secret lookup failed");
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Workload secret response is malformed");
  }
  return payload;
}

export async function resolveSwarmlinkMem0(options = {}) {
  enableVerifiedSystemCaTrust();
  const home = options.homeDir ?? homedir();
  const tokenPath = join(home, SWARML_MEM0_BINDING.tokenRelativePath);
  const token = readOwnerOnlyToken(tokenPath, options.uid);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const query = new URLSearchParams({
    workspaceId: SWARML_MEM0_BINDING.projectId,
    environment: SWARML_MEM0_BINDING.environment,
    secretPath: SWARML_MEM0_BINDING.secretPath,
    type: "shared",
  });

  // The current project/path contains only MEM0. Refuse to operate if that
  // provider-side scope ever grows until a narrower token is provisioned.
  const inventoryQuery = new URLSearchParams(query);
  inventoryQuery.set("recursive", "true");
  inventoryQuery.set("include_imports", "true");
  const inventory = await requestJson(
    `${SWARML_MEM0_BINDING.origin}/api/v3/secrets/raw?${inventoryQuery}`,
    token,
    fetchImpl,
  );
  const names = Array.isArray(inventory.secrets)
    ? inventory.secrets.map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry) ? entry.secretKey : null,
      )
    : [];
  if (names.length !== 1 || names[0] !== SWARML_MEM0_BINDING.secretName) {
    throw new Error("Workload secret scope no longer matches its exact binding");
  }

  const payload = await requestJson(
    `${SWARML_MEM0_BINDING.origin}/api/v3/secrets/raw/${SWARML_MEM0_BINDING.secretName}?${query}`,
    token,
    fetchImpl,
  );
  const secret = payload.secret;
  if (
    !secret ||
    typeof secret !== "object" ||
    Array.isArray(secret) ||
    secret.secretKey !== SWARML_MEM0_BINDING.secretName ||
    typeof secret.secretValue !== "string" ||
    secret.secretValue.length === 0
  ) {
    throw new Error("Workload secret response is malformed");
  }
  return secret.secretValue;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 2) {
    process.exit(2);
  }
  try {
    const value = await resolveSwarmlinkMem0();
    process.stdout.write(`${value}\n`);
  } catch {
    process.stderr.write("swarml MEM0 secret unavailable\n");
    process.exit(1);
  }
}
