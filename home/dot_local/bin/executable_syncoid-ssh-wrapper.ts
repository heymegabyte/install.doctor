#!/usr/bin/env -S node --experimental-strip-types
/**
 * Restricted Forced-Command Adapter for Read-Only Syncoid Source Access.
 *
 * Parses SSH_ORIGINAL_COMMAND using POSIX shell quoting rules, rejects shell
 * expansion, redirections, paths, and write subcommands, and executes allowlisted
 * read-only `zfs`/`zpool` pipelines directly without invoking `/bin/sh`.
 */

import { spawn } from "node:child_process";

const READ_ONLY_ZFS = new Set(["get", "holds", "list", "send"]);
const READ_ONLY_ZPOOL = new Set(["get", "list", "status"]);
const ALLOWLISTED_FILTERS = new Set(["lzop", "mbuffer", "pv", "zstd"]);
const FORBIDDEN_TOKENS = new Set([";", "&&", "||", ">", ">>", "<", "<<", "&"]);

function rejectCommand(reason: string): never {
  process.stderr.write(`ERROR: ${reason}\n`);
  process.exit(1);
}

function splitPosixQuotes(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let quoteMode: "none" | "single" | "double" = "none";

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? "";
    if (quoteMode === "single") {
      if (ch === "'") {
        quoteMode = "none";
      } else {
        current += ch;
      }
      continue;
    }
    if (quoteMode === "double") {
      if (ch === '"') {
        quoteMode = "none";
      } else if (ch === "\\") {
        const next = raw[i + 1];
        if (next === undefined) {
          rejectCommand("invalid shell quoting");
        }
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          current += next;
          i += 1;
        } else {
          current += ch;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'") {
      quoteMode = "single";
      inToken = true;
    } else if (ch === '"') {
      quoteMode = "double";
      inToken = true;
    } else if (ch === "\\") {
      const next = raw[i + 1];
      if (next === undefined) {
        rejectCommand("invalid shell quoting");
      }
      current += next;
      inToken = true;
      i += 1;
    } else if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
    } else {
      current += ch;
      inToken = true;
    }
  }

  if (quoteMode !== "none") {
    rejectCommand("invalid shell quoting");
  }
  if (inToken) {
    tokens.push(current);
  }
  return tokens;
}

function validateSegment(args: readonly string[], position: number, total: number): void {
  if (args.length === 0) {
    rejectCommand("empty pipeline segment");
  }
  const executable = args[0] ?? "";
  if (executable.includes("/")) {
    rejectCommand("executable paths are not allowed");
  }
  if (executable === "zfs") {
    const subcommand = args[1] ?? "";
    if (position !== 0 || args.length < 2 || !READ_ONLY_ZFS.has(subcommand)) {
      rejectCommand("unauthorized zfs operation");
    }
    if (
      subcommand === "send" &&
      args.slice(2).some((arg) => arg.startsWith("--output") || arg === "-o" || arg === "--raw")
    ) {
      rejectCommand("output and raw-file options are not allowed");
    }
    return;
  }
  if (executable === "zpool") {
    const subcommand = args[1] ?? "";
    if (total !== 1 || args.length < 2 || !READ_ONLY_ZPOOL.has(subcommand)) {
      rejectCommand("unauthorized zpool operation");
    }
    return;
  }
  if (ALLOWLISTED_FILTERS.has(executable)) {
    if (position === 0) {
      rejectCommand("filters require an allowlisted producer");
    }
    return;
  }
  if (executable === "command" && total === 1 && args.length === 3 && args[1] === "-v") {
    const target = args[2] ?? "";
    if (!ALLOWLISTED_FILTERS.has(target) && target !== "zfs" && target !== "zpool") {
      rejectCommand("command lookup is outside the allowlist");
    }
    return;
  }
  rejectCommand("executable is outside the allowlist");
}

function parseForcedCommand(command: string): string[][] {
  if (
    !command ||
    command.length > 16_384 ||
    command.includes("\n") ||
    command.includes("\r") ||
    command.includes("\0")
  ) {
    rejectCommand("missing or malformed forced command");
  }
  const tokens = splitPosixQuotes(command);
  if (
    tokens.some(
      (tok) =>
        FORBIDDEN_TOKENS.has(tok) ||
        tok.includes(";") ||
        tok.includes("&&") ||
        tok.includes("||") ||
        tok.includes(">") ||
        tok.includes("<") ||
        tok.includes("$") ||
        tok.includes("`"),
    )
  ) {
    rejectCommand("shell expansion and redirection are not allowed");
  }

  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (token === "|") {
      segments.push([]);
    } else {
      segments[segments.length - 1]?.push(token);
    }
  }
  for (let i = 0; i < segments.length; i += 1) {
    validateSegment(segments[i] ?? [], i, segments.length);
  }
  return segments;
}

async function executePipeline(segments: readonly (readonly string[])[]): Promise<number> {
  const env = {
    PATH: process.env.PATH ?? "/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "C",
  };
  const procs = segments.map((seg, idx) =>
    spawn(seg[0] ?? "", seg.slice(1), {
      env,
      stdio: [
        idx === 0 ? "inherit" : "pipe",
        idx === segments.length - 1 ? "inherit" : "pipe",
        "inherit",
      ],
    }),
  );

  for (let i = 0; i < procs.length - 1; i += 1) {
    const current = procs[i];
    const next = procs[i + 1];
    if (current?.stdout && next?.stdin) {
      current.stdout.pipe(next.stdin);
    }
  }

  const exitCodes = await Promise.all(
    procs.map(
      (proc) =>
        new Promise<number>((resolve) => {
          proc.on("close", (code) => resolve(code ?? 1));
          proc.on("error", () => resolve(1));
        }),
    ),
  );
  return exitCodes.find((code) => code !== 0) ?? 0;
}

const segments = parseForcedCommand(process.env.SSH_ORIGINAL_COMMAND ?? "");
const exitCode = await executePipeline(segments);
process.exit(exitCode);
