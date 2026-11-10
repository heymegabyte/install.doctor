#!/usr/bin/env -S node --experimental-strip-types
/**
 * Reject active OpenSpec architecture changes lacking an assigned Frontier Architect.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHANGES_DIR = join(ROOT, "openspec", "changes");
const ALLOWED_ARCHITECTS = new Set(["claude", "codex", "antigravity"]);
const ARCHITECT_PATTERN = /^> \*\*Architect:\*\*\s+([a-z0-9_-]+)\s*$/m;
const ROLE_PATTERN = /^> \*\*Architect Role:\*\*\s+assigned\s*$/m;
const trackedArtifacts = new Set(
  spawnSync("git", ["ls-files", "openspec/changes/*/proposal.md", "openspec/changes/*/design.md"], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout.split("\n").filter(Boolean),
);

function validateOpenSpecArchitects(): number {
  if (!existsSync(CHANGES_DIR)) {
    return 0;
  }
  const errors: string[] = [];
  const entries = readdirSync(CHANGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive")
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const changeDir = join(CHANGES_DIR, entry.name);
    for (const fileName of ["proposal.md", "design.md"]) {
      const artifactPath = join(changeDir, fileName);
      const rel = relative(ROOT, artifactPath);
      if (!existsSync(artifactPath) || !trackedArtifacts.has(rel)) {
        continue;
      }
      const content = readFileSync(artifactPath, "utf8");
      const match = ARCHITECT_PATTERN.exec(content);
      if (!match || !ALLOWED_ARCHITECTS.has(match[1] ?? "")) {
        errors.push(`${rel}: missing or invalid frontier Architect`);
      }
      if (!ROLE_PATTERN.test(content)) {
        errors.push(`${rel}: Architect Role must be assigned`);
      }
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    return 1;
  }
  return 0;
}

process.exit(validateOpenSpecArchitects());
