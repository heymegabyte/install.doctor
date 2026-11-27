#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolvePinnedInfisicalSecret } from "../lib/swarml-infisical-secret-broker.mjs";

export const SWARML_BRANDFETCH_BINDING = Object.freeze({
  origin: "https://app.infisical.com",
  projectId: "cb49d4e4-4b17-46c4-9807-a48ada5e040b",
  environment: "prod",
  secretPath: "/providers/brandfetch",
  secretName: "BRANDFETCH_API_KEY",
  tokenRelativePath: ".config/agent-fleet/swarml-infisical-service-token",
  requestTimeoutMs: 10_000,
  userAgent: "swarml-brandfetch-broker/1.0",
});

export async function resolveSwarmlinkBrandfetch(options = {}) {
  return resolvePinnedInfisicalSecret(SWARML_BRANDFETCH_BINDING, options);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 2) {
    process.exit(2);
  }
  try {
    const value = await resolveSwarmlinkBrandfetch();
    process.stdout.write(`${value}\n`);
  } catch {
    process.stderr.write("swarml Brandfetch secret unavailable\n");
    process.exit(1);
  }
}
