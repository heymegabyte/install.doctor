#!/usr/bin/env -S node --experimental-strip-types
/**
 * PostToolUse Oversized-Output Guard (TypeScript) — Prevents Context Window Thrashing.
 */

import { readFileSync } from "node:fs";

interface PostToolPayload {
  readonly tool_name?: string;
  readonly tool_response?: unknown;
}

const MAX_BYTES = Number.parseInt(process.env.OUTPUT_GUARD_MAX_BYTES ?? "30000", 10) || 30_000;
const MAX_LINES = Number.parseInt(process.env.OUTPUT_GUARD_MAX_LINES ?? "500", 10) || 500;
const QUIET_TOOLS = new Set(["TodoWrite", "Task", "Read"]);

function measureResponse(response: unknown): { readonly byteLength: number; readonly lineCount: number } {
  if (response === null || response === undefined) {
    return { byteLength: 0, lineCount: 0 };
  }
  const text =
    typeof response === "string"
      ? response
      : (() => {
          try {
            return JSON.stringify(response);
          } catch {
            return String(response);
          }
        })();
  const byteLength = Buffer.byteLength(text, "utf8");
  let lineCount = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      lineCount += 1;
    }
  }
  return { byteLength, lineCount };
}

function main(): number {
  let payload: PostToolPayload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8")) as PostToolPayload;
  } catch {
    return 0;
  }

  const toolName = payload.tool_name ?? "";
  if (QUIET_TOOLS.has(toolName)) {
    return 0;
  }

  const { byteLength, lineCount } = measureResponse(payload.tool_response);
  if (byteLength > MAX_BYTES || lineCount > MAX_LINES) {
    const kb = Math.round(byteLength / 1024);
    process.stderr.write(
      `⚠ CONTEXT-THRASH GUARD: ${toolName} returned ${kb} KB / ${lineCount} lines.\n\n` +
        "Oversized tool outputs are the #1 autocompact-thrash cause (context refills\n" +
        "within 3 turns). This result is already in context — do NOT re-request it.\n" +
        "Next time, shrink BEFORE the bytes land:\n\n" +
        "  - Bash: pipe through head/tail/node filters, e.g.\n" +
        "       grep -n '<anchor>' file | head -20\n" +
        "       head -c 1500 file\n" +
        "  - Files >200 KB (index.html, styles.css, app.js): NEVER read wholesale —\n" +
        "       targeted grep/sed or node extraction with capped output.\n" +
        "  - MCP snapshots: prefer browser_evaluate() with a small JSON return over\n" +
        "       take_snapshot/browser_navigate results.\n" +
        "  - Trackers/ledgers: delegate to a fresh Explore agent, <=150-line cap.\n",
    );
  }
  return 0;
}

process.exit(main());
