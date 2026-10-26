#!/usr/bin/env node
// Generate packages/control-plane/src/catalog.json from software.yml — the App Store data source.
// REUSES the canonical, validated cnf index builder (home/dot_local/bin/executable_cnf-build-index)
// as the single source of truth (D01/D02/D13): one parser, no second catalog. The Worker bundles the
// emitted JSON (read-only; regenerate + redeploy when software.yml changes). No runtime YAML in the edge.
// Each entry: { name (software.yml key), bin (executable), providers[] (package managers), platforms[] }.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..'); // repo root (packages/control-plane/scripts → repo)
const SOFTWARE = process.argv[2] || join(ROOT, 'software.yml');
const OUT = process.argv[3] || join(HERE, '..', 'src', 'catalog.json');
const BUILDER = join(ROOT, 'home', 'dot_local', 'bin', 'executable_cnf-build-index');

// index columns (per not-found-hook.sh): 1 bin 2 key 3 brew 4 apt 5 dnf 6 pacman 7 cask 8 choco
// 9 scoop 10 go 11 cargo 12 npm 13 pipx 14 pip 15 gem
const COLS = ['brew', 'apt', 'dnf', 'pacman', 'cask', 'choco', 'scoop', 'go', 'cargo', 'npm', 'pipx', 'pip', 'gem'];
const PLAT = {
  brew: ['macos', 'linux'], cask: ['macos'],
  apt: ['linux'], dnf: ['linux'], pacman: ['linux'],
  choco: ['windows'], scoop: ['windows'],
  go: ['macos', 'linux', 'windows'], cargo: ['macos', 'linux', 'windows'], npm: ['macos', 'linux', 'windows'],
  pipx: ['macos', 'linux', 'windows'], pip: ['macos', 'linux', 'windows'], gem: ['macos', 'linux', 'windows'],
};

const tmp = join(mkdtempSync(join(tmpdir(), 'aid-catalog-')), 'index.tsv');
execFileSync('bash', [BUILDER, SOFTWARE, tmp], { stdio: ['ignore', 'ignore', 'inherit'] });

const rows = readFileSync(tmp, 'utf8').split('\n').filter(Boolean);
const items = [];
for (const line of rows) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  const bin = f[0];
  const name = f[1];
  if (!name) continue;
  const providers = [];
  const pkgs = {}; // provider -> the real package id (may differ from name, e.g. angular-cli → npm @angular/cli)
  const platforms = new Set();
  for (let i = 0; i < COLS.length; i++) {
    const val = f[2 + i];
    if (val && val.trim()) {
      providers.push(COLS[i]);
      pkgs[COLS[i]] = val.trim();
      for (const p of PLAT[COLS[i]]) platforms.add(p);
    }
  }
  if (!providers.length) continue; // an entry with no installable provider is not browseable
  items.push({ name, bin, providers, pkgs, platforms: [...platforms].sort() });
}
items.sort((a, b) => a.name.localeCompare(b.name));

const json = JSON.stringify(items);
writeFileSync(OUT, json + '\n');
console.error(`gen-catalog: ${items.length} entries → ${OUT} (${(json.length / 1024).toFixed(1)} KiB)`);
