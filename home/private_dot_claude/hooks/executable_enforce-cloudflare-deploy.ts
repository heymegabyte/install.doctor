#!/usr/bin/env -S node --experimental-strip-types
/**
 * PostToolUse Hook — Cloudflare Deploy Enforcement Gate (TypeScript).
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

interface HookPayload {
  readonly tool_name?: string;
  readonly tool_input?: {
    readonly file_path?: string;
    readonly path?: string;
  };
}

const CF_CONFIG_NAMES = new Set([
  "wrangler.toml",
  "wrangler.jsonc",
  "wrangler.json",
  "cloudflare.config.ts",
]);

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);

function main(): number {
  let payload: HookPayload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8")) as HookPayload;
  } catch {
    return 0;
  }

  if (!WRITE_TOOLS.has(payload.tool_name ?? "")) {
    return 0;
  }

  const target = payload.tool_input?.file_path ?? payload.tool_input?.path ?? "";
  const fileName = target ? basename(target) : "";
  if (!fileName || !CF_CONFIG_NAMES.has(fileName)) {
    return 0;
  }

  process.stderr.write(
    `[cloudflare-deploy-gate] ${fileName} written => this repo has a ` +
      "Cloudflare-deployable surface, so deploy is MANDATORY this session " +
      "(rules/verification-loop.md + skill 08; 'No deploy = not shipped').\n" +
      "  1. Resolve creds via `get-secret CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` " +
      "(fall back to CLOUDFLARE_API_KEY/EMAIL, then `wrangler login`). An UNSET ENV VAR IS " +
      "NOT 'no creds' — the broker is the source of truth and holds the CF creds.\n" +
      "  2. Greenfield/first-pass is NOT exempt: provision D1 (`wrangler d1 create`), apply " +
      "migrations --remote, `wrangler deploy` to *.workers.dev, then curl the live /health.\n" +
      "  3. Only after the broker AND `wrangler login` BOTH fail may you write " +
      "BLOCKED_EXTERNAL — and then with the exact failing command as evidence.\n" +
      "This is a warning, not a block.\n",
  );
  return 2;
}

process.exit(main());
