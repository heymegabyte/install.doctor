import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const doctor = fileURLToPath(new URL(
  "../home/dot_local/bin/executable_workstation-doctor.ts", import.meta.url,
));
const selectedBytes = "selected proxy\n";
const installedBytes = "installed proxy\n";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function reportFor(t, { selected, installed = selectedBytes, running } = {}) {
  const home = mkdtempSync(join(tmpdir(), "workstation-proxy-identity-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const selectedPath = join(home, "source tree", "dot_local", "bin", "executable_megabyte-local-proxy.ts");
  const installedPath = join(home, ".local", "bin", "megabyte-local-proxy.ts");
  mkdirSync(dirname(selectedPath), { recursive: true });
  mkdirSync(dirname(installedPath), { recursive: true });
  if (selected !== undefined) writeFileSync(selectedPath, selected);
  if (installed !== null) writeFileSync(installedPath, installed);
  writeFileSync(join(home, "chezmoi"), '#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = source-path ] || exit 1\nprintf "%s\\n" "$HOME/source tree"\n', { mode: 0o700 });
  const preload = join(home, "mock-health.mjs");
  writeFileSync(preload, `globalThis.fetch = async (url) => Response.json(
    url === "http://127.0.0.1:4880/healthz"
      ? { runtime: "node-typescript", source_sha256: ${JSON.stringify(running)} }
      : {},
  );\n`);
  const child = spawnSync(process.execPath, ["--import", preload, "--experimental-strip-types", doctor, "--json"], {
    env: { HOME: home, PATH: home },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(child.error);
  const { findings } = JSON.parse(child.stdout);
  assert.equal(findings.find(({ id }) => id === "local-artifact-proxy").passed, true);
  return findings.find(({ id }) => id === "local-artifact-proxy-identity");
}

test("healthy proxy exposes installed checksum drift with missing running identity", (t) => {
  const report = reportFor(t, { selected: selectedBytes, installed: installedBytes });
  assert.equal(report.passed, false);
  assert.match(report.detail, /state=installed-source-drift/);
  assert.ok(report.detail.includes(`selected=${digest(selectedBytes)}`));
  assert.ok(report.detail.includes(`installed=${digest(installedBytes)}`));
  assert.match(report.detail, /running=unverified/);
});

test("healthy proxy cannot establish identity without a selected canonical source", (t) => {
  const report = reportFor(t, { running: digest(selectedBytes) });
  assert.equal(report.passed, false);
  assert.match(report.detail, /state=selected-source-unavailable/);
});

test("healthy proxy with matching files needs a verifiable running identity", (t) => {
  for (const running of [undefined, "invalid"]) {
    const report = reportFor(t, { selected: selectedBytes, running });
    assert.equal(report.passed, false);
    assert.match(report.detail, /state=running-identity-unverified/);
  }
});

test("running identity differs from matching selected and installed files", (t) => {
  const report = reportFor(t, { selected: selectedBytes, running: digest(installedBytes) });
  assert.equal(report.passed, false);
  assert.match(report.detail, /state=restart-needed/);
});

test("proxy identity passes when all digests match", (t) => {
  const report = reportFor(t, { selected: selectedBytes, running: digest(selectedBytes) });
  assert.equal(report.passed, true);
  assert.match(report.detail, /state=verified/);
});
