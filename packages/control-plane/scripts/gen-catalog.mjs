#!/usr/bin/env node
// Generate packages/control-plane/src/catalog.json from software.yml — the App Store data source.
// REUSES the canonical, validated cnf index builder (home/dot_local/bin/executable_cnf-build-index)
// as the single source of truth (D01/D02/D13): one parser, no second catalog. The Worker bundles the
// emitted JSON (read-only; regenerate + redeploy when software.yml changes). No runtime YAML in the edge.
// Each entry: { name (software.yml key), bin (executable), providers[] (package managers), platforms[] }.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
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
  // installMode default = lazy CLI (installed on first command use via the cnf hook). Overridden below to
  // 'app' (a GUI desktop app, software.yml `_app`) or 'service' (a required service, `_service`) — D06.
  items.push({ name, bin, providers, pkgs, platforms: [...platforms].sort(), installMode: 'cli', preload: false });
}

// Merge the human-facing metadata from software.yml (the cnf index carries only bin+providers): _short
// (one-line description) + _github (provenance) + _home (homepage) + _docs (documentation) + the install
// MODE (_app → GUI desktop app installed eagerly at provisioning; _service → a required service; neither →
// a lazy CLI installed on first command use — D06). yq extracts a {key -> {…}} map; match by catalog name.
// Fail-soft: if yq is missing/errors, proceed without the enrichment (the catalog still works; mode stays cli).
try {
  const meta = JSON.parse(
    execFileSync(
      'yq',
      [
        '-o',
        'json',
        '.softwarePackages | to_entries | map({"key":.key,"short":.value._short,"github":.value._github,"home":.value._home,"docs":.value._docs,"app":(.value._app != null),"service":(.value._service != null),"preload":(.value._preload != null),"deprecated":.value._deprecated,"deps":.value._deps})',
        SOFTWARE,
      ],
      { encoding: 'utf8' },
    ),
  );
  const byKey = new Map(meta.filter((m) => m && m.key).map((m) => [m.key, m]));
  let enriched = 0;
  let linked = 0;
  const modes = { app: 0, service: 0, cli: 0 };
  for (const it of items) {
    const m = byKey.get(it.name);
    if (!m) {
      modes.cli++;
      continue;
    }
    if (typeof m.short === 'string' && m.short.trim()) {
      it.short = m.short.trim();
      enriched++;
    }
    if (typeof m.github === 'string' && m.github.trim()) it.github = m.github.trim();
    if (typeof m.home === 'string' && m.home.trim()) it.home = m.home.trim();
    if (typeof m.docs === 'string' && m.docs.trim()) it.docs = m.docs.trim();
    if (it.home || it.docs) linked++;
    // D14/D15 — surface the maintainer's `_deprecated` reason (often naming a replacement) so the App Store
    // can WARN before a user installs an abandoned/discouraged tool. Honest declared data; absent = not flagged.
    if (typeof m.deprecated === 'string' && m.deprecated.trim()) it.deprecated = m.deprecated.trim();
    // D07 — runtime dependencies (software.yml `_deps`). Keep only valid package-name identifiers so a YAML
    // merge-key artifact (e.g. "_envchain:deps") never leaks; the App Store links each dep to its catalog entry.
    if (Array.isArray(m.deps)) {
      const d = m.deps.filter((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(x));
      if (d.length) it.deps = d;
    }
    // D06 install mode — _app (GUI app) wins over _service; neither → lazy cli. Grounded in the EXPLICIT
    // declared fields only. NOTE: `cask` presence is deliberately NOT treated as "app" — measured 2026-10:
    // of 40 cask-no-_app entries, most are CLIs shipped as casks (java/gcloud/flutter/fly/mitmproxy/…), so
    // cask→app would mislabel MORE than it fixes. A few real GUI casks lacking _app (adobe-creative-cloud,
    // lm-studio) fall to cli — an accepted edge, far better than mislabeling the CLI-casks.
    it.installMode = m.app ? 'app' : m.service ? 'service' : 'cli';
    modes[it.installMode]++;
    // #153 eager-vs-lazy ACCURACY — software.yml `_preload:true` means installx EAGER-installs it at provisioning
    // (executable_installx --lazy installs casks/flatpaks/_app/_serviceEnabled/_preload), so a `_preload:true`
    // CLI is NOT "on first use" — the App Store must say "installed at setup". Carry the boolean so the badge is honest.
    it.preload = !!m.preload;
    if (it.installMode === 'cli' && it.preload) modes.preloadCli = (modes.preloadCli || 0) + 1;
  }
  console.error(`gen-catalog: enriched ${enriched} with _short; ${linked} with _home/_docs links; modes app=${modes.app} service=${modes.service} cli=${modes.cli} (preloadCli=${modes.preloadCli || 0} eager, not on-first-use)`);
} catch (e) {
  console.error('gen-catalog: WARNING — could not merge _short/_github/_home/_docs/installMode (' + (e && e.message) + '); proceeding without enrichment');
}

// R14/F15/F06 — flag which tools get an AUTOMATED first-run CONFIGURATION step. A post-installx hook
// (home/dot_local/bin/post-installx/executable_post-<tool>.sh) runs after installx installs <tool>, so the
// App Store can tell the user "configured on install" (vs a bare install) + name the hook as the concrete
// action (R14 "config completeness + repair actions" / F15 "report config coverage per app"). Match by
// catalog name OR bin (a hook is named for either). Fail-soft: if the dir is unreadable, skip (no flag).
try {
  const hookDir = join(ROOT, 'home', 'dot_local', 'bin', 'post-installx');
  const hooks = new Map(); // tool -> hook filename (chezmoi `executable_` prefix stripped)
  for (const f of readdirSync(hookDir)) {
    const base = f.startsWith('executable_') ? f.slice('executable_'.length) : f;
    const mt = base.match(/^post-(.+)\.sh$/);
    if (mt) hooks.set(mt[1], 'post-' + mt[1] + '.sh');
  }
  let configured = 0;
  for (const it of items) {
    const h = hooks.get(it.name) || hooks.get(it.bin);
    if (h) {
      it.configured = true;
      it.postInstall = h;
      configured++;
    }
  }
  console.error(`gen-catalog: ${configured} entries flagged configured-on-install (post-installx hooks of ${hooks.size})`);
} catch (e) {
  console.error('gen-catalog: WARNING — could not scan post-installx hooks (' + (e && e.message) + ')');
}

items.sort((a, b) => a.name.localeCompare(b.name));

const json = JSON.stringify(items);
writeFileSync(OUT, json + '\n');
console.error(`gen-catalog: ${items.length} entries → ${OUT} (${(json.length / 1024).toFixed(1)} KiB)`);
