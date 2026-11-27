#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolvePinnedInfisicalSecret } from "../lib/swarml-infisical-secret-broker.mjs";

export const SWARML_MEM0_BINDING = Object.freeze({
  origin: "https://app.infisical.com",
  projectId: "cb49d4e4-4b17-46c4-9807-a48ada5e040b",
  environment: "prod",
  secretPath: "/",
  secretName: "MEM0_API_KEY",
  tokenRelativePath: ".config/agent-fleet/swarml-infisical-service-token",
  requestTimeoutMs: 10_000,
  userAgent: "swarml-mem0-broker/1.0",
});

export async function resolveSwarmlinkMem0(options = {}) {
  return resolvePinnedInfisicalSecret(SWARML_MEM0_BINDING, options);
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
