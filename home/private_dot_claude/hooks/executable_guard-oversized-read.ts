#!/usr/bin/env -S node --experimental-strip-types
/**
 * PreToolUse Read Guard (TypeScript) — Blocks Unwindowed Oversized Reads & Task Output Dumps.
 */

import { readFileSync, statSync } from "node:fs";

interface PreToolReadPayload {
  readonly tool_name?: string;
  readonly tool_input?: {
    readonly file_path?: string;
    readonly notebook_path?: string;
    readonly limit?: unknown;
  };
}

const MAX_BYTES = Number.parseInt(process.env.READ_GUARD_MAX_BYTES ?? "65536", 10) || 65_536;
const TASK_OUT_BYTES = Number.parseInt(process.env.READ_GUARD_TASK_OUT_BYTES ?? "8192", 10) || 8_192;
const MIN_WINDOW = Number.parseInt(process.env.READ_GUARD_MIN_WINDOW ?? "2000", 10) || 2_000;

function isNarrowWindow(limit: unknown): boolean {
  return typeof limit === "number" && Number.isInteger(limit) && limit > 0 && limit < MIN_WINDOW;
}

function main(): number {
  let payload: PreToolReadPayload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8")) as PreToolReadPayload;
  } catch {
    return 0;
  }

  if (payload.tool_name !== "Read") {
    return 0;
  }

  const targetPath = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path ?? "";
  if (!targetPath) {
    return 0;
  }

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(targetPath).size;
  } catch {
    return 0;
  }

  if (targetPath.includes("/tasks/") && targetPath.endsWith(".output") && sizeBytes > TASK_OUT_BYTES) {
    const kb = (sizeBytes / 1024).toFixed(1);
    process.stderr.write(
      `BLOCKED: \`${targetPath}\` is a task output file (${kb} KB).\n\n` +
        "`tasks/*.output` for a local_agent is a symlink to the FULL subagent conversation\n" +
        "transcript (JSONL). Reading it overflows the context window.\n\n" +
        "Use instead:\n" +
        "  - The Agent tool result (returned inline) or the task-notification <result> block.\n" +
        "  - Resume the agent: SendMessage asking for a <=200-word summary.\n" +
        `  - Bash-task output only: tail -c 4000 ${targetPath} | sed -n '1,120p'\n`,
    );
    return 2;
  }

  if (sizeBytes > MAX_BYTES && !isNarrowWindow(payload.tool_input?.limit)) {
    const kb = (sizeBytes / 1024).toFixed(1);
    const limitKb = Math.round(MAX_BYTES / 1024);
    process.stderr.write(
      `BLOCKED: \`${targetPath}\` is ${kb} KB (guard limit ${limitKb} KB).\n\n` +
        "Use instead:\n" +
        `  - Windowed read: Read(file_path=..., offset=N, limit=200) — under ${MIN_WINDOW} lines.\n` +
        `  - Targeted extract: grep -n '<anchor>' ${targetPath} | head -40\n` +
        "  - Delegate to a fresh-context Explore agent with a <=150-line output cap.\n",
    );
    return 2;
  }

  return 0;
}

process.exit(main());
