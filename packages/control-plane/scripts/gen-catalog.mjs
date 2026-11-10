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
import { validateArtifactDeclarations } from '../../../scripts/validate-catalog-artifacts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..'); // repo root (packages/control-plane/scripts → repo)
const SOFTWARE = process.argv[2] || join(ROOT, 'software.yml');
const OUT = process.argv[3] || join(HERE, '..', 'src', 'catalog.json');
const BUILDER = join(ROOT, 'home', 'dot_local', 'bin', 'executable_cnf-build-index');

async function loadArtifactsByPackage() {
  const declared = JSON.parse(execFileSync(
    'yq',
    [
      '-o',
      'json',
      '[.softwarePackages | to_entries[] | select(.value | has("_artifacts")) | {"key": .key, "bin": .value._bin, "artifacts": .value._artifacts}]',
      SOFTWARE,
    ],
    { encoding: 'utf8' },
  ));
  return { declared, validated: await validateArtifactDeclarations(declared) };
}

function loadServiceDeclarationsByPackage() {
  const declared = JSON.parse(execFileSync(
    'yq',
    [
      '-o',
      'json',
      '[.softwarePackages | to_entries[] | select(.value._service != null) | {"key": .key, "services": .value._service}]',
      SOFTWARE,
    ],
    { encoding: 'utf8' },
  ));
  const byPackage = new Map();
  for (const entry of declared) {
    if (!entry || typeof entry.key !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(entry.key)) {
      throw new Error('service declaration has an invalid catalog key');
    }
    if (!Array.isArray(entry.services) || entry.services.length === 0 || entry.services.length > 32) {
      throw new Error(`service declaration for ${entry.key} must be a non-empty bounded array`);
    }
    const normalized = entry.services.map((raw, index) => {
      const value = typeof raw === 'string' ? { name: raw } : raw;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`service declaration ${entry.key}[${index}] must be a string or object`);
      }
      const allowed = new Set(['name', 'sudo', 'pkg', 'manager']);
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`service declaration ${entry.key}[${index}] has unknown field ${key}`);
      }
      if (typeof value.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9@._:+\/-]{0,127}$/.test(value.name)) {
        throw new Error(`service declaration ${entry.key}[${index}] has an invalid name`);
      }
      if (value.sudo !== undefined && typeof value.sudo !== 'boolean') {
        throw new Error(`service declaration ${entry.key}[${index}] sudo must be boolean`);
      }
      if (value.pkg !== undefined && (typeof value.pkg !== 'string' || !/^[a-z0-9][a-z0-9._+-]{0,127}$/.test(value.pkg))) {
        throw new Error(`service declaration ${entry.key}[${index}] has an invalid package provider selector`);
      }
      if (value.manager !== undefined && value.manager !== 'systemd') {
        throw new Error(`service declaration ${entry.key}[${index}] has an unsupported manager`);
      }
      if (value.manager === 'systemd' && !/^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.service$/.test(value.name)) {
        throw new Error(`service declaration ${entry.key}[${index}] has an invalid systemd unit`);
      }
      return {
        name: value.name,
        privilege: value.sudo === true ? 'admin' : 'user',
        ...(value.pkg === undefined ? {} : { packageProvider: value.pkg }),
        ...(value.manager === undefined ? {} : { manager: value.manager }),
      };
    });
    byPackage.set(entry.key, normalized);
  }
  return byPackage;
}

// Artifact metadata is executable authority. Unlike optional human-facing
// enrichment below, it is always parsed through the shared strict runtime
// contract and any malformed declaration aborts generation.
const { declared: artifactDeclarations, validated: artifactsByPackage } = await loadArtifactsByPackage();
// Service declarations are desired-state data, not executable manager authority.
// Preserve their exact identity/privilege/provider selectors in the generated
// catalog, while requiring a later manager-specific admission before mutation.
const serviceDeclarationsByPackage = loadServiceDeclarationsByPackage();

// index columns (per not-found-hook.sh): 1 bin 2 key 3 brew 4 apt 5 dnf 6 pacman 7 cask 8 choco
// 9 scoop 10 go 11 cargo 12 npm 13 pipx 14 pip 15 gem 16 apk
const COLS = ['brew', 'apt', 'dnf', 'pacman', 'cask', 'choco', 'scoop', 'go', 'cargo', 'npm', 'pipx', 'pip', 'gem', 'apk'];
const PLAT = {
  brew: ['macos', 'linux'], cask: ['macos'],
  apt: ['linux'], dnf: ['linux'], pacman: ['linux'], apk: ['linux'],
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
  const artifacts = artifactsByPackage.get(name);
  if (artifacts) {
    for (const artifact of artifacts) {
      platforms.add({ linux: 'linux', darwin: 'macos', win32: 'windows' }[artifact.platform.os]);
    }
  }
  items.push({
    name,
    bin,
    providers,
    pkgs,
    platforms: [...platforms].sort(),
    installMode: 'cli',
    preload: false,
    loadPolicy: 'lazy',
    loadRationale: 'default-lazy',
    ...(artifacts ? { artifacts } : {}),
    ...(serviceDeclarationsByPackage.has(name) ? { serviceDeclarations: serviceDeclarationsByPackage.get(name) } : {}),
  });
}

// The command-not-found index intentionally contains package-manager rows
// only. Preserve artifact-only packages in the generated catalog so replacing
// a legacy script provider does not make the package disappear.
for (const declaration of artifactDeclarations) {
  if (items.some((item) => item.name === declaration.key)) continue;
  const bins = typeof declaration.bin === 'string' ? [declaration.bin] : declaration.bin;
  if (!Array.isArray(bins) || bins.length < 1 || bins.some((bin) => typeof bin !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(bin))) {
    throw new Error(`artifact-only catalog entry ${declaration.key} requires a valid _bin string or array`);
  }
  const artifacts = artifactsByPackage.get(declaration.key);
  const platforms = [...new Set(artifacts.map((artifact) => ({ linux: 'linux', darwin: 'macos', win32: 'windows' })[artifact.platform.os]))].sort();
  for (const bin of bins) {
    items.push({
      name: declaration.key,
      bin,
      providers: [],
      pkgs: {},
      platforms,
      installMode: 'cli',
      preload: false,
      loadPolicy: 'lazy',
      loadRationale: 'default-lazy',
      artifacts,
      ...(serviceDeclarationsByPackage.has(declaration.key) ? { serviceDeclarations: serviceDeclarationsByPackage.get(declaration.key) } : {}),
    });
  }
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
        '.softwarePackages | to_entries | map({"key":.key,"short":.value._short,"github":.value._github,"home":.value._home,"docs":.value._docs,"app":(.value._app != null),"appBundle":.value._app,"launcherBin":.value._bin,"cask":(.value.cask != null),"flatpak":.value.flatpak,"service":(.value._service != null),"serviceEnabled":(.value._serviceEnabled == true),"preload":(.value._preload == true),"preloadReason":.value._preloadReason,"postInstallPrivilege":.value._postInstallPrivilege,"deprecated":.value._deprecated,"replacement":.value._replacement,"deps":.value._deps,"systemIdentityReconciliation":(((.value._groups // []) | length) > 0 or ((.value._folders // []) | length) > 0)})',
        SOFTWARE,
      ],
      { encoding: 'utf8' },
    ),
  );
  const byKey = new Map(meta.filter((m) => m && m.key).map((m) => [m.key, m]));
  const safeFlatpak = value => typeof value === 'string'
    && /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*){2,}$/.test(value);
  for (const m of meta) {
    if (!safeFlatpak(m?.flatpak) || items.some(item => item.name === m.key)) continue;
    const bins = typeof m.launcherBin === 'string' ? [m.launcherBin] : m.launcherBin;
    if (!Array.isArray(bins) || bins.length < 1) continue;
    for (const bin of bins.filter(value => typeof value === 'string' && /^[a-z0-9][a-z0-9._+-]*$/.test(value))) {
      items.push({ name: m.key, bin, providers: ['flatpak'], pkgs: { flatpak: m.flatpak }, platforms: ['linux'],
        installMode: 'cli', preload: false, loadPolicy: 'lazy', loadRationale: 'default-lazy' });
    }
  }
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
    // A replacement is a catalog key, not prose. Keeping it structured lets
    // clients offer a deterministic migration instead of parsing deprecation text.
    if (typeof m.replacement === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(m.replacement)) {
      it.replacement = m.replacement;
    }
    // D07 — runtime dependencies (software.yml `_deps`). Keep only valid package-name identifiers so a YAML
    // merge-key artifact (e.g. "_envchain:deps") never leaks; the App Store links each dep to its catalog entry.
    if (Array.isArray(m.deps)) {
      const d = m.deps.filter((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(x));
      if (d.length) it.deps = d;
    }
    if (m.systemIdentityReconciliation === true) it.systemIdentityReconciliation = true;
    if (m.postInstallPrivilege != null) it.postInstallPrivilege = m.postInstallPrivilege;
    // D06 install mode — _app (GUI app) wins over _service; neither → lazy cli. Grounded in the EXPLICIT
    // declared fields only. NOTE: `cask` presence is deliberately NOT treated as "app" — measured 2026-10:
    // of 40 cask-no-_app entries, most are CLIs shipped as casks (java/gcloud/flutter/fly/mitmproxy/…), so
    // cask→app would mislabel MORE than it fixes. A few real GUI casks lacking _app (adobe-creative-cloud,
    // lm-studio) fall to cli — an accepted edge, far better than mislabeling the CLI-casks.
    it.installMode = m.app ? 'app' : m.service ? 'service' : 'cli';
    if (m.app && m.cask && typeof m.appBundle === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._+()-]*\.app$/.test(m.appBundle)
      && typeof m.launcherBin === 'string' && /^[a-z0-9][a-z0-9._+-]*$/.test(m.launcherBin)) {
      it.caskLauncher = { appBundle: m.appBundle, bin: m.launcherBin };
    }
    const flatpakAppId = m.flatpak;
    if (typeof flatpakAppId === 'string' && /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*){2,}$/.test(flatpakAppId)) {
      if (!it.providers.includes('flatpak')) it.providers.push('flatpak');
      it.providers.sort();
      it.pkgs.flatpak = flatpakAppId;
      if (!it.platforms.includes('linux')) it.platforms.push('linux');
      it.platforms.sort();
      if (typeof m.launcherBin === 'string' && m.launcherBin === it.bin
        && /^[a-z0-9][a-z0-9._+-]*$/.test(m.launcherBin)) {
        it.flatpakLauncher = { appId: flatpakAppId, bin: m.launcherBin };
      }
    }
    // Delivery is derived from the actual installx selection contract, not from
    // package shape. Merely being a GUI app or having service metadata does not
    // authorize eager installation/startup.
    it.deliveryMode = m.preload || m.serviceEnabled ? 'eager' : 'lazy';
    modes[it.installMode]++;
    // #153 eager-vs-lazy ACCURACY — software.yml `_preload:true` means installx EAGER-installs it at provisioning
    // (executable_installx --lazy installs casks/flatpaks/_app/_serviceEnabled/_preload), so a `_preload:true`
    // CLI is NOT "on first use" — the App Store must say "installed at setup". Carry the boolean so the badge is honest.
    it.preload = !!m.preload;
    if (it.preload && typeof m.preloadReason === 'string') it.preloadReason = m.preloadReason;
    if (m.serviceEnabled) {
      it.loadPolicy = 'eager-service';
      it.loadRationale = 'desired-state:_serviceEnabled';
    } else if (it.preload) {
      const loadClass = {
        'bootstrap-critical': ['eager-bootstrap', 'bootstrap:scripts/provision.sh'],
        'lazy-installer-substrate': ['eager-bootstrap', 'lazy-resolver:home/dot_config/shell/not-found-hook.sh'],
        'security-recovery-prerequisite': ['eager-security-recovery', 'security-recovery:pre-lazy-offline'],
        'desired-state-service': ['eager-service', 'desired-state:_serviceEnabled'],
        'shell-profile-core': ['eager-supported-path', 'supported-path:shell-profile-core'],
        'web-dev-core': ['eager-supported-path', 'supported-path:web-dev-core'],
        'media-management-core': ['eager-supported-path', 'supported-path:media-management-core'],
        'lsp-core': ['eager-supported-path', 'supported-path:lsp-core'],
      }[m.preloadReason];
      if (!loadClass) throw new Error(`unknown eager reason for ${it.name}: ${m.preloadReason}`);
      [it.loadPolicy, it.loadRationale] = loadClass;
    }
    if (it.installMode === 'cli' && it.preload) modes.preloadCli = (modes.preloadCli || 0) + 1;
  }
  console.error(`gen-catalog: enriched ${enriched} with _short; ${linked} with _home/_docs links; modes app=${modes.app} service=${modes.service} cli=${modes.cli} (preloadCli=${modes.preloadCli || 0} eager, not on-first-use)`);
} catch (e) {
  console.error('gen-catalog: WARNING — could not merge _short/_github/_home/_docs/installMode (' + (e && e.message) + '); proceeding without enrichment');
}

// R14/F15/F06 — flag only tools whose automated first-run configuration hook is admitted by the signed
// engine's typed-hook protocol. Hook existence alone is not execution authority: legacy post-installx
// scripts are intentionally rejected before mutation. Keeping the catalog on the same exact marker
// contract prevents the App Store from promising configuration that the planner will refuse to run.
// Match by catalog name OR bin (a hook is named for either). Fail-soft if the directory is unreadable.
try {
  const hookDir = join(ROOT, 'home', 'dot_local', 'bin', 'post-installx');
  const typedHookMarker = '# INSTALL_DOCTOR_TYPED_HOOK_PROTOCOL=1\n';
  const hooks = new Map(); // tool -> hook filename (chezmoi `executable_` prefix stripped)
  let legacyHooks = 0;
  for (const f of readdirSync(hookDir)) {
    const base = f.startsWith('executable_') ? f.slice('executable_'.length) : f;
    const mt = base.match(/^post-(.+)\.sh$/);
    if (!mt) continue;
    const source = readFileSync(join(hookDir, f), 'utf8');
    const markerCount = source.split(typedHookMarker).length - 1;
    if (markerCount === 1) hooks.set(mt[1], 'post-' + mt[1] + '.sh');
    else legacyHooks++;
  }
  let configured = 0;
  for (const it of items) {
    const h = hooks.get(it.name) || hooks.get(it.bin);
    if (h) {
      it.configured = true;
      it.postInstall = h;
      it.postInstallPrivilege ??= 'admin';
      configured++;
    }
  }
  console.error(`gen-catalog: ${configured} entries flagged configured-on-install (${hooks.size} typed hooks; ${legacyHooks} legacy hooks excluded)`);
} catch (e) {
  console.error('gen-catalog: WARNING — could not scan post-installx hooks (' + (e && e.message) + ')');
}

// Post-install privilege is execution authority, not optional display metadata.
// Never let either fail-soft enrichment block silently discard or broaden it.
for (const item of items) {
  if (item.postInstall && !['user', 'admin'].includes(item.postInstallPrivilege)) {
    throw new Error(`configured catalog entry lacks valid post-install privilege authority: ${item.name}`);
  }
  if (!item.postInstall && item.postInstallPrivilege != null) {
    throw new Error(`catalog entry declares post-install privilege without a matched hook: ${item.name}`);
  }
}

items.sort((a, b) => a.name.localeCompare(b.name));

// Runtime dependencies are executable install authority, not optional related
// software. Reject a broken closure while generating the release instead of
// shipping a catalog that every target must reject before mutation.
const catalogNames = new Set(items.map((item) => item.name));
for (const item of items) {
  for (const dependency of item.deps ?? []) {
    if (!catalogNames.has(dependency)) {
      throw new Error(`catalog dependency ${item.name} -> ${dependency} is not an installable catalog entry`);
    }
  }
}

const json = JSON.stringify(items);
writeFileSync(OUT, json + '\n');
console.error(`gen-catalog: ${items.length} entries → ${OUT} (${(json.length / 1024).toFixed(1)} KiB)`);
