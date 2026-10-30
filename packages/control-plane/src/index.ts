import { Hono } from 'hono';
import { z } from 'zod';
// Reuse aid-core's route contract (don't re-implement — MASTER-PROMPT §8). Relative import so
// esbuild bundles the zero-dep contracts at deploy time; no workspace link needed.
import { ROUTES, chooseRoute, validateBlueprint, exportMarkdown, importMarkdown, blueprintDigest, aidProviderConfig, APP_URL, type Blueprint } from '../../aid-core/src/core';
import { Env, providerConfigured } from './env';
import { reserveBudget, DEFAULT_CEILING_MICROS } from './budget';
// Better Auth — O-series sign-in (GitHub + Google), fire #102. See ./auth.ts.
import { auth } from './auth';
import { isAllowedAdminEmail } from './admin-allowlist';
import { redactSecrets } from './redact';
import { getMigrations } from 'better-auth/db/migration';
// App Store catalog — generated from software.yml by the canonical validated parser
// (scripts/gen-catalog.mjs → the cnf index builder; D01/D02/D13). Read-only, bundled at deploy;
// regenerate + redeploy when software.yml changes. No runtime YAML at the edge.
import catalogData from './catalog.json';
type CatalogEntry = { name: string; bin: string; providers: string[]; pkgs: Record<string, string>; platforms: string[]; short?: string; github?: string; home?: string; docs?: string; installMode?: 'app' | 'service' | 'cli'; preload?: boolean; deprecated?: string; deps?: string[]; configured?: boolean; postInstall?: string };
const CATALOG = catalogData as CatalogEntry[];
// Name → entry. One package can legitimately provide SEVERAL bins (xz → lzma/xz/unlzma/unxz), one entry per
// bin, all sharing the package `name`. Prefer the CANONICAL entry whose bin IS the name (so /api/catalog/xz
// returns the `xz` bin, not an arbitrary sibling), else keep the FIRST seen (deterministic) — fire #133,
// D02/D12. A naive `new Map(CATALOG.map(...))` kept the LAST sibling (xz → unxz), the bug this fixes.
const CATALOG_BY_NAME = new Map<string, CatalogEntry>();
for (const e of CATALOG) {
  const existing = CATALOG_BY_NAME.get(e.name);
  if (!existing || (e.bin === e.name && existing.bin !== existing.name)) CATALOG_BY_NAME.set(e.name, e);
}
// D06/C12 — tally a plan's packages (defaults + every machine's own) by install mode, so the plan-review
// summary shows the eager-vs-lazy breakdown: how many GUI desktop apps install at setup vs CLIs installed
// lazily on first command use (the core product promise). Packages the catalog doesn't know → "unknown".
function tallyInstallModes(bp: { defaults?: { packages?: string[] }; machines?: { packages?: string[] }[] }): { app: number; service: number; cli: number; cliPreload: number; unknown: number } {
  const names = new Set<string>();
  for (const p of bp.defaults?.packages ?? []) names.add(p);
  for (const m of bp.machines ?? []) for (const p of m.packages ?? []) names.add(p);
  const t = { app: 0, service: 0, cli: 0, cliPreload: 0, unknown: 0 };
  for (const name of names) {
    const e = CATALOG_BY_NAME.get(name);
    if (!e) {
      t.unknown++;
      continue;
    }
    const mode = e.installMode || 'cli';
    // #154 eager-vs-lazy accuracy — a _preload:true CLI is EAGER-installed at provisioning (installx), so it
    // belongs in cliPreload ("installed at setup"), NOT the lazy cli ("on first use") bucket — the aggregate
    // sibling of the per-tool #153 badge fix, so the plan review doesn't over-claim "on first use".
    if (mode === 'cli' && e.preload) t.cliPreload++;
    else t[mode]++;
  }
  return t;
}
// D14/D15 safety — flag the plan's packages the maintainer marked `_deprecated` (#112), so plan review WARNS
// before a host applies a plan that includes an abandoned/discouraged tool, with the reason (often the replacement).
function collectDeprecated(bp: { defaults?: { packages?: string[] }; machines?: { packages?: string[] }[] }): { name: string; reason: string }[] {
  const names = new Set<string>();
  for (const p of bp.defaults?.packages ?? []) names.add(p);
  for (const m of bp.machines ?? []) for (const p of m.packages ?? []) names.add(p);
  const out: { name: string; reason: string }[] = [];
  for (const name of names) {
    const e = CATALOG_BY_NAME.get(name);
    if (e?.deprecated) out.push({ name, reason: e.deprecated });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// A10 — model partial-platform availability EXPLICITLY. For each OS, list the plan's catalog packages NOT
// installable on it (their declared `platforms` exclude that OS), so plan review SEES where applying the plan
// is only a PARTIAL success across a mixed fleet (a macOS-only app won't land on the Linux/Windows hosts)
// instead of the package being silently applicable. Unknown (non-catalog) packages are skipped — platforms
// unknown, never guessed. Shape mirrors collectDeprecated/tallyInstallModes (one scan of defaults+machines).
const AID_PLATFORMS = ['macos', 'linux', 'windows'] as const;
function collectPlatformGaps(bp: { defaults?: { packages?: string[] }; machines?: { packages?: string[] }[] }): Record<string, string[]> {
  const names = new Set<string>();
  for (const p of bp.defaults?.packages ?? []) names.add(p);
  for (const m of bp.machines ?? []) for (const p of m.packages ?? []) names.add(p);
  const gaps: Record<string, string[]> = { macos: [], linux: [], windows: [] };
  for (const name of names) {
    const e = CATALOG_BY_NAME.get(name);
    if (!e) continue;
    const plats = new Set(e.platforms ?? []);
    for (const os of AID_PLATFORMS) if (!plats.has(os)) gaps[os].push(name);
  }
  for (const os of AID_PLATFORMS) gaps[os].sort((a, b) => a.localeCompare(b));
  return gaps;
}
// A10 (#155) — plan packages the catalog does NOT know (no recipe): NAMED (not merely counted in
// installModes.unknown) so plan review surfaces WHICH package is uncovered — mirrors collectDeprecated /
// collectPlatformGaps. e.g. _default's runner carries `alloy` (Grafana Alloy, intended but not yet in
// software.yml) -> the review shows "alloy not in the catalog" instead of a mystery "1 other".
function collectUnknownPackages(bp: { defaults?: { packages?: string[] }; machines?: { packages?: string[] }[] }): string[] {
  const names = new Set<string>();
  for (const p of bp.defaults?.packages ?? []) names.add(p);
  for (const m of bp.machines ?? []) for (const p of m.packages ?? []) names.add(p);
  const out: string[] = [];
  for (const name of names) if (!CATALOG_BY_NAME.get(name)) out.push(name);
  return out.sort((a, b) => a.localeCompare(b));
}
// F15/C12 (#161) — CONFIGURATION coverage of the plan (step-5 "review a concrete plan showing ... configuration"):
// of the plan's CATALOG-KNOWN packages, how many AUTO-CONFIGURE on install via a post-installx first-run hook
// (catalog `configured` #136). Surfaces BEFORE applying what setup Install Doctor runs automatically vs what stays
// manual. `of` = catalog-known packages (uncatalogued ones are surfaced separately as unknownPackages).
function collectConfigured(bp: { defaults?: { packages?: string[] }; machines?: { packages?: string[] }[] }): { count: number; of: number; packages: string[] } {
  const names = new Set<string>();
  for (const p of bp.defaults?.packages ?? []) names.add(p);
  for (const m of bp.machines ?? []) for (const p of m.packages ?? []) names.add(p);
  const packages: string[] = [];
  let of = 0;
  for (const name of names) {
    const e = CATALOG_BY_NAME.get(name);
    if (!e) continue;
    of++;
    if (e.configured) packages.push(name);
  }
  return { count: packages.length, of, packages: packages.sort((a, b) => a.localeCompare(b)) };
}
// Install-command templates per provider — MIRROR the cnf hook's __cnf_do_install (D04: ONE
// provider→command contract shared with the deterministic executor). Drives the App Store install
// detail (R13 — App Store details from recipe contracts). Keep in sync with not-found-hook.sh.
const INSTALL_CMD: Record<string, (pkg: string) => string> = {
  brew: (p) => `brew install ${p}`,
  apt: (p) => `sudo apt-get install -y ${p}`,
  dnf: (p) => `sudo dnf install -y ${p}`,
  pacman: (p) => `sudo pacman -S --noconfirm ${p}`,
  cask: (p) => `brew install --cask ${p}`,
  choco: (p) => `choco install -y ${p}`,
  scoop: (p) => `scoop install ${p}`,
  go: (p) => `go install ${p}`,
  cargo: (p) => `cargo install ${p}`,
  npm: (p) => `npm install -g ${p}`,
  pipx: (p) => `pipx install ${p}`,
  pip: (p) => `pip install --user ${p}`,
  gem: (p) => `gem install ${p}`,
};

// D11 (#147) update-channel — the per-provider UPDATE command (how to keep a tool CURRENT; intended-experience
// promise #8). Mirrors INSTALL_CMD but with each manager's UPGRADE form, which genuinely differs from install
// for most providers (brew upgrade; apt --only-upgrade; cargo install --force; npm update -g; scoop/pipx/gem …).
const UPDATE_CMD: Record<string, (pkg: string) => string> = {
  brew: (p) => `brew upgrade ${p}`,
  apt: (p) => `sudo apt-get install -y --only-upgrade ${p}`,
  dnf: (p) => `sudo dnf upgrade -y ${p}`,
  pacman: (p) => `sudo pacman -S --noconfirm ${p}`,
  cask: (p) => `brew upgrade --cask ${p}`,
  choco: (p) => `choco upgrade -y ${p}`,
  scoop: (p) => `scoop update ${p}`,
  go: (p) => `go install ${p}@latest`,
  cargo: (p) => `cargo install --force ${p}`,
  npm: (p) => `npm update -g ${p}`,
  pipx: (p) => `pipx upgrade ${p}`,
  pip: (p) => `pip install --user --upgrade ${p}`,
  gem: (p) => `gem update ${p}`,
};

// R02/B14 (#152) uninstall — the per-provider UNINSTALL/REMOVE command (how to cleanly REMOVE a tool;
// maintenance-lifecycle completion alongside install #R13 + update #147). Mirrors UPDATE_CMD. `go` is OMITTED
// on purpose: `go install` has no `go uninstall` verb (removal = rm the GOPATH/bin binary, whose name isn't the
// package path), so we show NOTHING for a go-only tool rather than a possibly-wrong hand-rolled rm — honest;
// the handler's `UNINSTALL_CMD[p] && pkgs[p]` filter skips any provider not listed here.
const UNINSTALL_CMD: Record<string, (pkg: string) => string> = {
  brew: (p) => `brew uninstall ${p}`,
  apt: (p) => `sudo apt-get remove -y ${p}`,
  dnf: (p) => `sudo dnf remove -y ${p}`,
  pacman: (p) => `sudo pacman -Rns --noconfirm ${p}`,
  cask: (p) => `brew uninstall --cask ${p}`,
  choco: (p) => `choco uninstall -y ${p}`,
  scoop: (p) => `scoop uninstall ${p}`,
  cargo: (p) => `cargo uninstall ${p}`,
  npm: (p) => `npm uninstall -g ${p}`,
  pipx: (p) => `pipx uninstall ${p}`,
  pip: (p) => `pip uninstall -y ${p}`,
  gem: (p) => `gem uninstall ${p}`,
};

// C12 (#162) — providers whose install command REQUIRES ELEVATION (sudo), DERIVED from the INSTALL_CMD templates
// so the set can't drift (a system package manager: apt/dnf/pacman). User-space managers (brew/cargo/npm/pipx/
// pip/gem/go/scoop/cask/choco) install without root.
const SUDO_PROVIDERS = new Set(Object.entries(INSTALL_CMD).filter(([, fn]) => fn('x').startsWith('sudo ')).map(([k]) => k));
// PRIVILEGES coverage of the plan (step-5 "review a concrete plan showing ... privileges"): plan packages that
// REQUIRE ELEVATION (sudo) to install — a service (installs + enables a system unit) OR a package whose only
// INSTALLABLE providers all need sudo (a system-PM-only tool). The service set overlaps installModes.service, but
// the system-PM-only CLIs/apps (chromium, docker, distrobox) are NOT captured there — genuinely new "needs root" info.
function collectPrivileges(bp: { defaults?: { packages?: string[] }; machines?: { packages?: string[] }[] }): { count: number; packages: string[] } {
  const names = new Set<string>();
  for (const p of bp.defaults?.packages ?? []) names.add(p);
  for (const m of bp.machines ?? []) for (const p of m.packages ?? []) names.add(p);
  const packages: string[] = [];
  for (const name of names) {
    const e = CATALOG_BY_NAME.get(name);
    if (!e) continue;
    const installable = (e.providers ?? []).filter((p) => INSTALL_CMD[p]);
    const elevated = e.installMode === 'service' || (installable.length > 0 && installable.every((p) => SUDO_PROVIDERS.has(p)));
    if (elevated) packages.push(name);
  }
  return { count: packages.length, packages: packages.sort((a, b) => a.localeCompare(b)) };
}

// Inference request body (Zod boundary) — estimated cost drives the budget reservation.
const InferRequest = z.object({ estimateMicros: z.number().int().nonnegative().default(0) }).passthrough();

const app = new Hono();

// Security headers (O14 / web-security baseline; fire #106). CF-zone Managed Transforms already set HSTS /
// X-Frame-Options / nosniff / Referrer-Policy; the Worker adds the two it doesn't: a Content-Security-Policy
// and a Permissions-Policy, on EVERY response. The dashboard renders inline <script>/<style>, so script/style
// are 'unsafe-inline' (honest — no per-request nonces here), but frame-ancestors/base-uri/object-src/form-action
// are locked (anti-clickjacking / base-tag / object / form-hijack). No external assets (system fonts only), so
// default-src/connect-src/img-src stay 'self'. The OAuth sign-in redirect is a top-level navigation (not a
// connect/form), so it's unaffected. Set on c.res.headers AFTER next() so it covers every route's response.
// #107 completes the cross-origin header baseline: Cross-Origin-Opener-Policy (same-origin-allow-popups —
// isolates this browsing context so a cross-origin opener can't reach window.opener, while keeping any
// future OAuth *popup* flow working; the current social flow is a top-level redirect, unaffected) +
// Cross-Origin-Resource-Policy (same-origin — this worker's bytes can't be hot-linked as a no-cors
// subresource cross-origin; a CORS fetch + the server-to-server aid CLI are NOT affected by CORP).
// Cross-Origin-Embedder-Policy (require-corp) is DELIBERATELY omitted: there are zero cross-origin
// subresources today (no cross-origin-isolation benefit — no SharedArrayBuffer), and it would break
// legitimate future embeds (Google Maps panels, R2 images) that lack CORP/CORS headers.
// CSP STEP 2 (#122) — script-src drops 'unsafe-inline' for a per-request NONCE: the dashboard's inline
// <script> blocks run ONLY if they carry the matching nonce, which an injected/reflected <script> cannot
// guess — so a stored/reflected-XSS payload won't execute (real defense-in-depth on an app that holds the
// admin token). style-src keeps 'unsafe-inline' (inline style= attrs + <style> are a separate, harder slice).
// TRUSTED TYPES (#130, arc #124-130 COMPLETE) — all 7 dashboard pages were refactored to TT-safe DOM
// (createElement/textContent/replaceChildren; zero first-party innerHTML sinks), so `require-trusted-types-for
// 'script'` is now ENFORCED: a FUTURE unescaped DOM-sink assignment throws at runtime instead of executing a
// DOM-XSS payload. NOT adding `trusted-types <policy>` — CF's edge-injected challenge/beacon script defines its
// OWN default policy, and pinning a policy allowlist here would break it; the sink-blocking directive alone
// satisfies the gate and leaves third-party policy creation unrestricted.
function cspFor(nonce: string): string {
  return (
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; ` +
    "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; " +
    "object-src 'none'; form-action 'self'; require-trusted-types-for 'script'"
  );
}
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
const COOP = 'same-origin-allow-popups';
const CORP = 'same-origin';
app.use('*', async (c, next) => {
  // One cryptographically-random nonce per request (hex, 16 bytes). Generated BEFORE next() so it is stable
  // for this response; used both to decorate every inline <script> AND in the script-src directive.
  const rb = crypto.getRandomValues(new Uint8Array(16));
  let nonce = '';
  for (const b of rb) nonce += b.toString(16).padStart(2, '0');
  await next();
  try {
    // Inject nonce="<n>" into EVERY inline <script> of HTML responses (dashboard pages + the shared chrome).
    // Done here, in ONE place, so any new page/script is covered automatically — a missed script would break
    // under the strict policy. The lookahead matches `<script` + whitespace-or-`>` (handles a future
    // `<script type=…>` too) and never matches `</script>`. Non-HTML (JSON APIs, redirects) is left untouched.
    const ct = c.res.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      const html = await c.res.text();
      const h = new Headers(c.res.headers);
      h.delete('content-length'); // the injected attrs lengthen the body; let the runtime recompute
      c.res = new Response(html.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`), {
        status: c.res.status,
        headers: h,
      });
    }
    c.res.headers.set('content-security-policy', cspFor(nonce));
    c.res.headers.set('permissions-policy', PERMISSIONS_POLICY);
    c.res.headers.set('cross-origin-opener-policy', COOP);
    c.res.headers.set('cross-origin-resource-policy', CORP);
    // Cache-Control: no-store DEFAULT (#109) — this is an admin control plane; its tenant-scoped responses
    // (devices · history · recommendations · environment) + the dashboard pages carry sensitive data that
    // must NOT sit in a shared proxy or browser disk cache. Set no-store ONLY when the handler hasn't
    // already chosen a policy, so a route can still opt INTO caching (e.g. a future public catalog cache
    // via `public, max-age=…`) and Better Auth keeps its own session Cache-Control.
    if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
  } catch {
    /* immutable response (e.g. redirects) — skip; CF-zone headers still apply */
  }
});

// Boundary schema (Zod everywhere) — mirrors aid-core chooseRoute's accepted enums.
const ResolveRequest = z
  .object({
    sensitivity: z.enum(['normal', 'restricted']).default('normal'),
    kind: z.enum(['routine', 'code', 'research', 'architecture']).default('routine'),
    verificationFailed: z.boolean().default(false),
    allowPremium: z.boolean().default(false),
  })
  .strict();

app.get('/health', (c) =>
  c.json({ status: 'ok', service: 'aid-control-plane', phase: 'A-skeleton', routes: ROUTES.length }),
);

// Minimal browser surface at app.install.doctor (MASTER-PROMPT §2). The full cinematic 5-section app is
// the §16 build; this is an HONEST landing + a working pairing-approval page so the domain is live and
// the `aid-pair` verifyUrl resolves end-to-end. Server-rendered HTML, no framework.
const PAGE_CSS =
  '*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#060610;color:#e6e8ef}' +
  '.wrap{max-width:680px;margin:0 auto;padding:48px 24px}a{color:#00E5FF}h1{font-size:2rem;margin:.2em 0}.mono{font-family:ui-monospace,Menlo,monospace}' +
  '.card{background:#0d0f1a;border:1px solid #1b2030;border-radius:12px;padding:20px;margin:18px 0}' +
  '.code{font-family:ui-monospace,monospace;font-size:1.6rem;letter-spacing:.15em;color:#00E5FF;background:#0a0c16;border:1px solid #1b2030;border-radius:8px;padding:12px 16px;display:inline-block}' +
  'input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #2a3147;background:#0a0c16;color:#e6e8ef}' +
  'button{background:#00E5FF;color:#060610;font-weight:700;border:0;cursor:pointer}.muted{color:#8b93a7;font-size:.9rem}' +
  'table{width:100%;border-collapse:collapse;font-size:.9rem;margin-top:12px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #1b2030;vertical-align:top}th{color:#8b93a7;font-weight:600}nav a{margin-right:16px}' +
  '.tag{display:inline-block;font-size:.72rem;padding:1px 7px;margin:1px;border-radius:999px;background:#0a0c16;border:1px solid #2a3147;color:#9fb4c8}' +
  '.lnk{background:none;border:0;color:#00E5FF;cursor:pointer;padding:0;font:inherit;font-weight:700;text-align:left}.lnk:hover{text-decoration:underline}' +
  '.cmd{font-family:ui-monospace,monospace;font-size:.82rem;background:#0a0c16;border:1px solid #1b2030;border-radius:6px;padding:6px 10px;margin:4px 0;color:#9fb4c8;user-select:all;display:block}.cmd b{color:#8b93a7;font-weight:600;margin-right:8px;user-select:none}' +
  '.cta{display:inline-block;background:#00E5FF;color:#060610;font-weight:700;padding:10px 16px;border-radius:8px;text-decoration:none;margin:4px 8px 4px 0}.cta:hover{filter:brightness(1.1)}' +
  '.cta2{display:inline-block;background:transparent;color:#00E5FF;border:1px solid #2a3147;padding:10px 16px;border-radius:8px;text-decoration:none;margin:4px 0}.cta2:hover{border-color:#00E5FF}' +
  'ol{padding-left:20px}ol li{margin:4px 0}' +
  '.rec{border-left:3px solid #2a3147}.rec-warning{border-left-color:#f0a020}.rec-info{border-left-color:#00E5FF}.rec-ok{border-left-color:#3fbf6f}';
// Shared across EVERY dashboard page: persist the admin token in sessionStorage (per-tab, cleared on
// close) so the operator enters it ONCE — prefill the #tok input on load, auto-save on change, and
// inject a "forget token" control. No-ops on pages without a #tok (landing, /pair, /environment).
const TOKEN_PERSIST_JS = `<script>
function aidSaveToken(t){try{if(t)sessionStorage.setItem('aidAdminToken',t)}catch(e){}}
function aidForgetToken(){try{sessionStorage.removeItem('aidAdminToken')}catch(e){}var el=document.getElementById('tok');if(el)el.value='';}
// Admin auth for dashboard fetches (#132, wires the #131 server gate into the UI): send the AID_ADMIN_TOKEN
// bearer ONLY when the operator pasted one, else send no auth header and let the same-origin Better Auth
// SESSION cookie authorize (fetch includes it by default for same-origin) — so a signed-in allowlisted admin
// needs no token. requireAdmin accepts either. Returns a headers object (optionally merged with extras).
function aidAdminHeaders(extra){var h=extra||{};var el=document.getElementById('tok');var t=el?el.value.trim():'';if(t)h['authorization']='Bearer '+t;return h;}
// A 401/403 is no longer just "paste a token" — a session authorizes too. Append a session-aware hint.
function aidAuthHint(status){return (status===401||status===403)?' — sign in (top-right) or paste your admin token above':'';}
addEventListener('DOMContentLoaded',function(){try{var el=document.getElementById('tok');if(!el)return;var t=sessionStorage.getItem('aidAdminToken');if(t)el.value=t;el.addEventListener('change',function(){aidSaveToken(el.value.trim())});var b=document.createElement('button');b.type='button';b.className='lnk';b.textContent='forget token';b.style.marginLeft='8px';b.onclick=aidForgetToken;el.insertAdjacentElement('afterend',b);var hint=document.createElement('div');hint.className='muted';hint.style.cssText='font-size:.78rem;margin-top:4px';hint.textContent='Optional if you are signed in — your session authorizes admin access when your email is allowlisted.';var box=el.parentNode;if(box&&box.insertAdjacentElement){box.insertAdjacentElement('afterend',hint)}else if(box){box.appendChild(hint)}}catch(e){}});
</script>`;
// Session-aware "who am I" status in the shared chrome (O13; fire #104). On every page: call Better Auth's
// GET /api/auth/get-session (credentials:include). Signed in → show the user + a Sign out button (POST
// /api/auth/sign-out); not signed in → a "Sign in" link to /login. get-session returns null when there's no
// session (honest). No backticks inside (TS template literal, #91); the IIFE scopes its own esc().
const AUTH_STATUS_JS = `<div id=aidAuthStatus style="position:fixed;top:8px;right:12px;font-size:.8rem;z-index:50"></div><script>
(function(){
  var el=document.getElementById('aidAuthStatus'); if(!el)return;
  // #124 Trusted-Types arc — build the status with createElement + textContent (NO innerHTML), toward
  // require-trusted-types-for 'script'. textContent auto-escapes, so the old esc() helper is gone. The shared
  // chrome is on EVERY page, so the landing / is now the first page with zero first-party innerHTML sinks.
  function signedOut(){el.replaceChildren();var a=document.createElement('a');a.href='/login';a.textContent='Sign in';el.appendChild(a);}
  fetch('/api/auth/get-session',{credentials:'include',headers:{'accept':'application/json'}})
    .then(function(r){return r.ok?r.json():null})
    .then(function(j){
      if(j&&j.user){
        el.replaceChildren();
        var span=document.createElement('span');span.className='muted';span.textContent=j.user.name||j.user.email||'account';
        var btn=document.createElement('button');btn.type='button';btn.className='lnk';btn.id='aidSignOut';btn.textContent='Sign out';
        btn.addEventListener('click',function(){fetch('/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},credentials:'include'}).then(function(){location.reload()}).catch(function(){location.reload()})});
        el.append(span,document.createTextNode(' · '),btn);
      } else { signedOut(); }
    })
    .catch(signedOut);
})();
</script>`;
function htmlPage(title: string, body: string): string {
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><style>${PAGE_CSS}</style></head><body><div class=wrap>${body}</div>${TOKEN_PERSIST_JS}${AUTH_STATUS_JS}</body></html>`;
}
app.get('/', (c) =>
  c.html(
    htmlPage(
      'aid · install.doctor',
      `<h1>aid <span class=muted>· install.doctor</span></h1>
<p>Set up and maintain any computer from one place — desktop, laptop, server, or headless box. Describe the environment once; make each authorized machine a verified, cooperating part of it.</p>
<p><a class=cta href="#setup">Set up a computer ↓</a><a class=cta2 href="/login">Sign in</a><a class=cta2 href="/pair">Approve a pairing</a></p>

<div class=card><h3>How it works</h3>
<ol>
<li><b>Bootstrap</b> — run one line on the machine (below).</li>
<li><b>Pair</b> — approve the machine in your browser. Nothing installs without your explicit OK.</li>
<li><b>Describe &amp; apply</b> — choose desktop / server / developer / runner capabilities, review the concrete plan, apply.</li>
</ol></div>

<div class=card id=setup><h3>Bootstrap a machine</h3>
<p class=muted>macOS &amp; Linux — run on the machine:</p>
<p class=mono>bash &lt;(curl -sSL https://install.doctor/start)</p>
<p class=muted>then pair it:</p>
<p class=mono>aid-pair</p>
<p class=muted>Native Windows PowerShell entrypoint — coming.</p></div>

<div class=card><h3>Desktop or headless — both work</h3>
<p><b>Desktop (with a browser):</b> <span class=mono>aid-pair</span> opens the approval page here automatically.</p>
<p><b>Headless / server:</b> <span class=mono>aid-pair</span> prints a short code + a URL you approve from any other browser. No GUI required — and the emergency CLI works without one.</p></div>

<div class=card><h3>Apps now, CLIs on demand</h3>
<p>Selected desktop applications and the few dependencies needed to bootstrap and recover install now. Optional command-line tools install automatically the <b>first time you run them</b> — no bloat, nothing before you need it.</p>
<p class=muted>Browse everything installable in the <a href="/apps">App Store</a> — 1000+ tools, each with the exact install command per platform.</p></div>

<div class=card><h3>Configured, recoverable, current</h3>
<p>Each host keeps its configuration and recovery metadata in version control, and its state stays reconciled to what you described. User files and databases go to encrypted backup storage — kept separate from configuration.</p></div>

<p class=muted>Live dashboard: <a href="/machines">Machines</a> · <a href="/apps">App Store</a> · <a href="/environment">Environment</a> · <a href="/recommendations">Recommendations</a> · <a href="/history">History</a> · API health <a href="/health">/health</a>. Automations in progress.</p>`,
    ),
  ),
);

// /login (O-series step 3; M06) — sign in with GitHub or Google via Better Auth. The buttons POST to the
// live /api/auth/sign-in/social and redirect to the real provider authorize URL (fire #102). Completing the
// round-trip needs the callback URL registered on the OAuth apps (a one-time human step) — the button itself
// genuinely initiates OAuth either way. No backticks in the inline script (TS template literal, #91).
app.get('/login', (c) =>
  c.html(
    htmlPage(
      'Sign in · install.doctor',
      `<h1>Sign in <span class=muted>· install.doctor</span></h1>
<p class=muted>Sign in to describe your environment, review the plan, and manage your machines.</p>
<div class=card>
<p><button id=gh class=cta>Continue with GitHub</button></p>
<p><button id=goog class=cta2>Continue with Google</button></p>
<p id=err class=muted></p>
<p class=muted>Email magic-link sign-in is coming soon. New here? Signing in creates your account.</p>
</div>
<p class=muted>Setting up a headless machine? <a href="/pair">Approve a pairing</a> instead.</p>
<script>
function signIn(p, btn){
  var err=document.getElementById('err'); err.textContent='';
  if(btn){btn.disabled=true;}
  fetch('/api/auth/sign-in/social',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:p,callbackURL:'/'})})
    .then(function(r){return r.json()})
    .then(function(j){
      if(j&&j.url){location.href=j.url;return}
      err.textContent='Sign-in unavailable: '+((j&&j.error)||'unknown');
      if(btn){btn.disabled=false;}
    })
    .catch(function(e){err.textContent='✗ '+e; if(btn){btn.disabled=false;}});
}
// CSP STEP-1 (#117) — wire via addEventListener, no inline on*= handlers (so script-src can later drop
// unsafe-inline; inline handlers are blocked even with a nonce). The listener-function this is the button.
document.getElementById('gh').addEventListener('click',function(){signIn('github',this)});
document.getElementById('goog').addEventListener('click',function(){signIn('google',this)});
</script>`,
    ),
  ),
);
// History nav section (S15) — the operator's fleet activity across devices. Minimal: paste the admin
// token, fetch /api/history, render the events. The full cinematic §16 dashboard is ahead; this is the
// first real, reachable nav section. All rendered values are HTML-escaped client-side (no XSS).
app.get('/history', (c) =>
  c.html(
    htmlPage(
      'History · aid',
      `<nav class=muted><a href="/">aid</a><a href="/machines">Machines</a><a href="/apps">App Store</a><a href="/environment">Environment</a><a href="/recommendations">Recommendations</a><a href="/history">History</a></nav>
<h1>History <span class=muted>· fleet activity</span></h1>
<div class=card>
<p class=muted>Paste your admin token to load the fleet's reported events (apply / plan / report runs across devices).</p>
<p class=muted><strong>Recording fidelity:</strong> History captures structured events only — <strong>no terminal output</strong> is captured yet (U02; a future recorder will add redacted output).</p>
<p><input id=tenant placeholder="tenant (default _default)" style="width:46%"> <input id=tok type=password placeholder="AID_ADMIN_TOKEN" style="width:46%"></p>
<p><button id=loadBtn>Load history</button></p></div>
<div id=out class=muted>No events loaded.</div>
<script>
// fire #91 — U03 fleet UI: a "run" column shows each event's correlationId; clicking it re-loads the history
// filtered to that run (the built-but-UI-only ?correlation= filter), so an operator can isolate one aid-up
// run's events across the fleet. load(corr) optionally scopes to a correlationId; a banner clears the filter.
async function load(corr,quiet){
  CUR_CORR=corr||null; // #141 remember the active run-filter so the poller preserves it across refreshes
  var out=document.getElementById('out'),tok=document.getElementById('tok').value.trim(),t=document.getElementById('tenant').value.trim()||'_default';
  if(!quiet)out.textContent='Loading…'; // #141 quiet background poll ticks never flash Loading…
  try{
    var url='/api/history?tenant='+encodeURIComponent(t)+'&limit=50'+(corr?('&correlation='+encodeURIComponent(corr)):'');
    var r=await fetch(url,{headers:aidAdminHeaders()});
    var j=await r.json();
    if(!r.ok){out.textContent='✗ '+(j.error||r.status)+aidAuthHint(r.status);stopPoll();return} // #141 stop polling on auth failure
    startPoll(); // #141 authorized response → keep the surface live (covers empty + populated)
    // #126 Trusted-Types-safe render (no innerHTML, toward require-trusted-types-for 'script') — build the banner
    // + events table with createElement/textContent/.append (auto-escaped). data-act/data-corr are preserved so
    // the #120 delegated listener (closest('[data-act]')) still drives the run-filter + clear-filter buttons.
    function clearBtn(){var b=document.createElement('button');b.className='lnk';b.setAttribute('data-act','clear');b.textContent='✕ clear filter';return b;}
    if(!j.items||!j.items.length){
      if(corr){var pe=document.createElement('p');pe.className='muted';pe.append('No events for run ');var me=document.createElement('span');me.className='mono';me.textContent=corr;pe.append(me,'. ',clearBtn());out.replaceChildren(pe);}
      else{out.textContent='No events for '+t+'.';}
      return;
    }
    var frag=document.createDocumentFragment();
    var banner=document.createElement('p');banner.className='muted';
    if(corr){var mb=document.createElement('span');mb.className='mono';mb.textContent=corr;banner.append('Showing run ',mb,' · '+j.count+' event(s) · ',clearBtn());}
    else{banner.append(j.count+' events · tenant '+t+' · recording: '+(j.recordingMode||'events-only')+' (no terminal capture yet) · click a run to isolate its correlated events');}
    var live=document.createElement('span');live.setAttribute('style','color:#00e5ff;margin-left:6px');live.title='auto-refreshing every 30s — pauses when the tab is hidden';live.textContent='↻ live';banner.append(' ',live); // #141
    frag.append(banner);
    var table=document.createElement('table');
    var thead=document.createElement('thead'),htr=document.createElement('tr');
    ['time','device','kind','status','run','summary'].forEach(function(h){var th=document.createElement('th');th.textContent=h;htr.append(th);});
    thead.append(htr);table.append(thead);
    var tbody=document.createElement('tbody');
    j.items.forEach(function(e){
      var tr=document.createElement('tr');
      function td(){var c=document.createElement('td');tr.append(c);return c;}
      td().textContent=e.createdAt||'';
      var a=document.createElement('a');a.className='mono';a.href='/machines?device='+encodeURIComponent(e.deviceId);a.title='View this machine';a.textContent=e.deviceId||'';td().append(a);
      td().textContent=e.kind||'';
      td().textContent=e.status||'';
      var rc=td();
      if(e.correlationId){var rb=document.createElement('button');rb.className='lnk';rb.title='filter to run '+e.correlationId+(e.parentRunId?(' · child of '+e.parentRunId):'');rb.setAttribute('data-act','filter');rb.setAttribute('data-corr',e.correlationId);rb.textContent=(e.parentRunId?'↳ ':'')+String(e.correlationId).slice(-6);rc.append(rb);}
      else{var sp=document.createElement('span');sp.className='muted';sp.textContent='—';rc.append(sp);}
      td().textContent=e.summary||'';
      tbody.append(tr);
    });
    table.append(tbody);frag.append(table);
    out.replaceChildren(frag);
  }catch(e){out.textContent='✗ '+e}
}
// #120 CSP STEP 1 — wire the static Load button + delegate the DYNAMIC per-row run-filter / clear-filter
// buttons (built inside #out's innerHTML) via ONE listener reading data-act/data-corr. No inline on*=,
// toward dropping script-src 'unsafe-inline'. load() takes an optional corr, so the static button calls
// load() with NO arg (passing it the click Event directly would be treated as a truthy correlationId).
document.getElementById('loadBtn').addEventListener('click',function(){load()});
document.getElementById('out').addEventListener('click',function(ev){
  var b=ev.target.closest('[data-act]');if(!b)return;
  if(b.getAttribute('data-act')==='filter'){load(b.getAttribute('data-corr'))}else{load()}
});
// #141 U15/real-time — /history self-refreshes on a visibility-aware poll (same pattern as /machines #140),
// PRESERVING the active run-filter (CUR_CORR). Pause on a hidden tab, refetch on foreground, never stack timers.
var POLL=null,CUR_CORR=null;
function stopPoll(){if(POLL){clearInterval(POLL);POLL=null;}}
function startPoll(){stopPoll();POLL=setInterval(function(){if(!document.hidden)load(CUR_CORR,true);},30000);}
document.addEventListener('visibilitychange',function(){if(!document.hidden&&POLL)load(CUR_CORR,true);});
</script>`,
    ),
  ),
);
// Environment nav section (C02/M "review the plan") — a READ-ONLY view of a tenant's authoritative
// desired-state ENVIRONMENT.md + its revision/digest, read from the EXISTING public GET
// /api/environment/current (the one revisioned write path; this only READS). Auto-loads _default on
// open. Thin honest page — the full §16 redesign is Figma-gated.
app.get('/environment', (c) =>
  c.html(
    htmlPage(
      'Environment · aid',
      `<nav class=muted><a href="/">aid</a><a href="/machines">Machines</a><a href="/apps">App Store</a><a href="/environment">Environment</a><a href="/recommendations">Recommendations</a><a href="/history">History</a></nav>
<h1>Environment <span class=muted>· desired state</span></h1>
<div class=card>
<p class=muted>The authoritative <strong>ENVIRONMENT.md</strong> for a tenant — the one revisioned desired-state contract a machine pulls + reconciles against. Read-only here; edits go through the one validated write path.</p>
<p><input id=tenant placeholder="tenant (default _default)" style="width:70%"> <button id=loadBtn>Load</button></p></div>
<div id=meta class=muted></div>
<div id=summary></div>
<pre id=out class=mono style="white-space:pre-wrap;overflow-x:auto;max-height:70vh">No environment loaded.</pre>
<div class=card>
<p class=muted>Preview a change before applying — paste a PROPOSED ENVIRONMENT.md and see the SEMANTIC diff vs the loaded current desired state (added <span style="color:#4ade80">+</span> · removed <span style="color:#f87171">−</span> · changed <span style="color:#fbbf24">~</span>). No write — this only compares.</p>
<textarea id=proposed placeholder="Paste a proposed ENVIRONMENT.md to compare against current…" style="width:100%;height:160px;font-family:monospace"></textarea>
<p><button id=diffBtn>Diff vs current</button></p></div>
<div id=diffout class=muted></div>
<script>
var CURMD='';
// #129 Trusted-Types arc — /environment renders the plan summary, meta, and diff entirely with createElement/
// textContent (auto-escaped). No innerHTML, no esc(). Package + deprecation links stay as real <a href=/apps?q=>.
// fire #93 — C12 "review the plan" (intended-experience step 5): a structured at-a-glance breakdown of the
// desired blueprint (packages/machines/services/routing/privacy), so an operator can review the shape of an
// environment without reading the full markdown. Derived by importing the current markdown to a blueprint.
function renderSummary(bp){
  var sum=document.getElementById('summary');if(!sum)return;
  var pkgs=(bp.defaults&&bp.defaults.packages)||[],machines=bp.machines||[],services=bp.services||[];
  var roles={};machines.forEach(function(m){var k=m.role||'?';roles[k]=(roles[k]||0)+1});
  var roleStr=Object.keys(roles).map(function(k){return k+'×'+roles[k]}).join(', ')||'—';
  var kinds=services.map(function(s){return s.kind||s.id});
  var rt=bp.routing||{},pv=bp.privacy||{};
  function mk(tag,cls){var e=document.createElement(tag);if(cls)e.className=cls;return e;}
  function muted(text){var s=mk('span','muted');s.textContent=text;return s;}
  function appendTagList(parent,a){if(a&&a.length){a.forEach(function(x,i){if(i)parent.append(' ');var s=mk('span','tag');s.textContent=x;parent.append(s);});}else parent.append(muted('—'));}
  // Each planned package links to its App Store detail (review-the-plan step 5 + interconnectedness).
  function appendPkgLinks(parent,a){if(a&&a.length){a.forEach(function(x,i){if(i)parent.append(' ');var link=mk('a','tag');link.href='/apps?q='+encodeURIComponent(x);link.title='View '+x+' in the App Store';link.textContent=x;parent.append(link);});}else parent.append(muted('—'));}
  function labeledP(label){var p=document.createElement('p');var st=document.createElement('strong');st.textContent=label;p.append(st,' ');return p;}
  var card=mk('div','card');
  var intro=mk('p','muted');var introS=document.createElement('strong');introS.textContent='Plan at a glance';intro.append(introS,' — what this environment describes (review before applying). Derived from the desired blueprint.');card.append(intro);
  // C12/D14 safety — if the plan includes maintainer-flagged deprecated packages (#112), WARN with reason + App Store link.
  var dep=bp.deprecatedPackages||[];
  if(dep.length){
    var db=mk('div');db.setAttribute('style','border-left:3px solid #f0a020;padding:6px 10px;margin:0 0 10px;background:#1a1407;border-radius:4px');
    var dbh=document.createElement('b');dbh.setAttribute('style','color:#f0a020');dbh.textContent=dep.length+' deprecated package'+(dep.length>1?'s':'')+' in this plan';
    db.append(dbh,' ',muted('— review before applying'));
    var dbItems=mk('div');dbItems.setAttribute('style','margin-top:4px');
    dep.forEach(function(x,i){if(i)dbItems.append(document.createElement('br'));var a=mk('a','tag');a.href='/apps?q='+encodeURIComponent(x.name);a.setAttribute('style','border-color:#f0a020;color:#f0a020');a.title=x.reason;a.textContent=x.name;dbItems.append(a,' ',muted(x.reason));});
    db.append(dbItems);card.append(db);
  }
  // A10 (#135) — partial-platform availability: summary.platformGaps lists, per OS, the plan packages that
  // will NOT install there (a macOS-only app on the Linux/Windows hosts), so plan review sees partial success.
  var pg=bp.platformGaps;
  if(pg){
    var pgOrder=['macos','linux','windows'],pgLabel={macos:'macOS',linux:'Linux',windows:'Windows'};
    var pgHas=pgOrder.some(function(os){return (pg[os]||[]).length});
    if(pgHas){
      var gb=mk('div');gb.setAttribute('style','border-left:3px solid #f0a020;padding:6px 10px;margin:0 0 10px;background:#1a1407;border-radius:4px');
      var gbh=document.createElement('b');gbh.setAttribute('style','color:#f0a020');gbh.textContent='Partial platform coverage';
      gb.append(gbh,' ',muted('— some packages will not install on every platform'));
      pgOrder.forEach(function(os){var miss=pg[os]||[];if(!miss.length)return;var row=mk('div');row.setAttribute('style','margin-top:4px');row.append(muted('Unavailable on '+pgLabel[os]+': '));miss.forEach(function(n,i){if(i)row.append(' ');var a=mk('a','tag');a.href='/apps?q='+encodeURIComponent(n);a.setAttribute('style','border-color:#f0a020;color:#f0a020');a.textContent=n;row.append(a);});gb.append(row);});
      card.append(gb);
    } else {
      var pPlat=labeledP('Platforms');pPlat.append(muted('✓ all packages install on macOS, Linux + Windows'));card.append(pPlat);
    }
  }
  // A10 (#155) — packages in the plan the catalog does NOT know (no Install Doctor recipe yet): NAME them
  // (like deprecatedPackages/platformGaps) so the reviewer sees WHICH package is uncovered, not a mystery 'other'.
  var unk=bp.unknownPackages||[];
  if(unk.length){
    var ub=mk('div');ub.setAttribute('style','border-left:3px solid #50607a;padding:6px 10px;margin:0 0 10px;background:#0d1117;border-radius:4px');
    var ubh=document.createElement('b');ubh.setAttribute('style','color:#8aa0c0');ubh.textContent=unk.length+' package'+(unk.length>1?'s':'')+' not in the catalog';
    ub.append(ubh,' ',muted('— no Install Doctor recipe yet; install mode + commands unavailable'));
    var ubItems=mk('div');ubItems.setAttribute('style','margin-top:4px');
    unk.forEach(function(n,i){if(i)ubItems.append(' ');var t=mk('span','tag');t.setAttribute('style','border-color:#50607a;color:#8aa0c0');t.textContent=n;ubItems.append(t);});
    ub.append(ubItems);card.append(ub);
  }
  var pPk=labeledP('Packages ('+pkgs.length+')');appendPkgLinks(pPk,pkgs);card.append(pPk);
  // C12/D06 — eager-vs-lazy install breakdown (server-computed summary.installModes, interconnects #110).
  var im=bp.installModes||{app:0,service:0,cli:0,cliPreload:0,unknown:0};
  var imParts=[];if(im.app)imParts.push([im.app,' desktop app'+(im.app>1?'s':'')+' at setup']);if(im.service)imParts.push([im.service,' service'+(im.service>1?'s':'')]);if(im.cliPreload)imParts.push([im.cliPreload,' preloaded CLI'+(im.cliPreload>1?'s':'')+' at setup']);if(im.cli)imParts.push([im.cli,' CLI'+(im.cli>1?'s':'')+' on first use']);if(im.unknown)imParts.push([im.unknown,' other']);
  var pIn=labeledP('Installs');var imSpan=mk('span','muted');
  if(imParts.length){imParts.forEach(function(pt,i){if(i)imSpan.append(' · ');var b=document.createElement('b');b.textContent=pt[0];imSpan.append(b,pt[1]);});}else imSpan.append('—');
  pIn.append(imSpan);card.append(pIn);
  // F15/C12 (#161) — CONFIGURATION coverage: how many catalog-known plan packages auto-configure on install (a
  // post-installx first-run hook) vs stay manual (step-5 'configuration'); name the auto-configured ones as chips.
  var cfg=bp.configured||{count:0,of:0,packages:[]};
  var pCf=labeledP('Configuration');var cfSpan=mk('span','muted');
  if(cfg.of){var cb=document.createElement('b');cb.textContent=cfg.count;cfSpan.append(cb,' of '+cfg.of+' package'+(cfg.of>1?'s':'')+' auto-configure on install (first-run setup)'+(cfg.count<cfg.of?' · the rest need manual setup':''));}else cfSpan.append('—');
  pCf.append(cfSpan);
  if(cfg.packages&&cfg.packages.length){var cfItems=mk('div');cfItems.setAttribute('style','margin-top:4px');cfg.packages.forEach(function(n,i){if(i)cfItems.append(' ');var a=mk('a','tag');a.href='/apps?q='+encodeURIComponent(n);a.setAttribute('style','border-color:#00e5ff;color:#00e5ff');a.textContent=n;cfItems.append(a);});pCf.append(cfItems);}
  card.append(pCf);
  // C12 (#162) — PRIVILEGES: plan packages that need elevation (sudo) to install (services + system-PM-only
  // tools), so the reviewer sees "will applying this need root?" (step-5 privileges); name them as amber chips.
  var prv=bp.privileges||{count:0,packages:[]};
  var pPr=labeledP('Privileges');var prSpan=mk('span','muted');
  if(prv.count){var prb=document.createElement('b');prb.textContent=prv.count;prSpan.append(prb,' package'+(prv.count>1?'s':'')+' require elevation (sudo) to install — a service or a system-package install');}else prSpan.append('✓ none require elevation (all install without sudo)');
  pPr.append(prSpan);
  if(prv.packages&&prv.packages.length){var prItems=mk('div');prItems.setAttribute('style','margin-top:4px');prv.packages.forEach(function(n,i){if(i)prItems.append(' ');var a=mk('a','tag');a.href='/apps?q='+encodeURIComponent(n);a.setAttribute('style','border-color:#f0a020;color:#f0a020');a.textContent=n;prItems.append(a);});pPr.append(prItems);}
  card.append(pPr);
  var pMa=labeledP('Machines ('+machines.length+')');pMa.append(muted(roleStr));card.append(pMa);
  var pSv=labeledP('Services ('+services.length+')');appendTagList(pSv,kinds);card.append(pSv);
  var pRt=labeledP('Routing');pRt.append(muted('engine '+(rt.engine||'—')+' · provider '+(rt.preferredProvider||'—')+' · premium '+(rt.allowPremium?'on':'off')));card.append(pRt);
  var pPv=labeledP('Privacy');pPv.append(muted('shell-analysis '+(pv.shellAnalysis||'—')+' · screenshots '+(pv.screenshots||'—')+' · terminal-input '+(pv.terminalInput?'on':'off')+' · product-learning '+(pv.productLearning?'on':'off')));card.append(pPv);
  sum.replaceChildren(card);
}
async function load(opts){
  opts=opts||{};
  var out=document.getElementById('out'),meta=document.getElementById('meta'),sum=document.getElementById('summary'),t=document.getElementById('tenant').value.trim()||'_default';
  if(!opts.quiet){out.textContent='Loading…';meta.textContent='';CURMD='';if(sum)sum.replaceChildren();} // #142 quiet poll ticks don't clear the view
  try{
    var r=await fetch('/api/environment/current?tenant='+encodeURIComponent(t));
    var j=await r.json();
    if(!r.ok){out.textContent='✗ '+(j.error||r.status)+(j.error==='not_found'?' — no desired state set for '+t+' yet':'');stopPoll();return} // #142 stop polling when there's no plan to watch
    startPoll(); // #142 (re)arm the visibility-aware poller — the plan is live, keep it current
    var ts=document.createElement('strong');ts.textContent=j.tenant||t;
    var rs=document.createElement('strong');rs.textContent=j.revision;
    var dgs=document.createElement('span');dgs.className='mono';dgs.textContent=String(j.digest||'').slice(0,12);
    meta.replaceChildren('tenant ',ts,' · revision ',rs,' · digest ',dgs,' · updated '+(j.updatedAt||''));
    var live=document.createElement('span');live.setAttribute('style','color:#00e5ff;margin-left:6px');live.title='auto-refreshing every 30s — pauses when the tab is hidden';live.textContent='↻ live';meta.append(' ',live); // #142
    out.textContent=j.markdown||'(empty)';CURMD=j.markdown||'';
    if(j.summary)renderSummary(j.summary);
  }catch(e){out.textContent='✗ '+e}
}
// fire #86 — C09 semantic diff: import the CURRENT + a PROPOSED ENVIRONMENT.md to blueprints, then diff them,
// so an operator can REVIEW a change before it goes through the one write path. Pure compare — no persistence.
async function diffProposed(){
  var dout=document.getElementById('diffout'),proposed=document.getElementById('proposed').value;
  if(!CURMD){dout.textContent='Load the current environment for a tenant first.';return}
  if(!proposed.trim()){dout.textContent='Paste a proposed ENVIRONMENT.md to compare.';return}
  dout.textContent='Diffing…';
  try{
    var fr=await fetch('/api/environment/import',{method:'POST',headers:{'content-type':'text/markdown'},body:CURMD});
    var fj=await fr.json();
    if(!fr.ok){dout.textContent='✗ current is not valid: '+(fj.error||String(fr.status));return}
    var tr=await fetch('/api/environment/import',{method:'POST',headers:{'content-type':'text/markdown'},body:proposed});
    var tj=await tr.json();
    if(!tr.ok){dout.textContent='✗ proposed ENVIRONMENT.md is invalid: '+(tj.error||String(tr.status));return}
    var dr=await fetch('/api/environment/diff',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from:fj.blueprint,to:tj.blueprint})});
    var dj=await dr.json();
    if(!dr.ok){dout.textContent='✗ diff failed: '+(dj.error||String(dr.status));return}
    if(!dj.changed){var np=document.createElement('p');np.className='muted';np.textContent='No changes — the proposed environment is identical to current.';dout.replaceChildren(np);return}
    // #129 TT-safe diff render — a card with a summary line + the changes table, all createElement.
    var card=document.createElement('div');card.className='card';
    var p=document.createElement('p');p.className='muted';p.append(dj.changes.length+' change(s) · proposed digest ');var dg=document.createElement('span');dg.className='mono';dg.textContent=String(dj.toDigest||'').slice(0,12);p.append(dg);card.append(p);
    var table=document.createElement('table');var thead=document.createElement('thead'),htr=document.createElement('tr');['section','change'].forEach(function(h){var th=document.createElement('th');th.textContent=h;htr.append(th);});thead.append(htr);table.append(thead);
    var tbody=document.createElement('tbody');
    (dj.changes||[]).forEach(function(ch){var d=String(ch.detail||'');var col=d.charAt(0)==='+'?'#4ade80':(d.charAt(0)==='-'?'#f87171':'#fbbf24');var tr2=document.createElement('tr');var td1=document.createElement('td');td1.className='mono';td1.textContent=ch.section;var td2=document.createElement('td');td2.className='mono';td2.setAttribute('style','color:'+col);td2.textContent=d;tr2.append(td1,td2);tbody.append(tr2);});
    table.append(tbody);card.append(table);dout.replaceChildren(card);
  }catch(e){dout.textContent='✗ '+String(e)}
}
// #119 CSP STEP 1 — wire the static Load + Diff buttons via addEventListener (no inline on*=), toward
// dropping script-src 'unsafe-inline'. (This page has no dynamic per-row handlers — both buttons are fixed.)
document.getElementById('loadBtn').addEventListener('click',function(){load()}); // #142 wrap so the click Event isn't passed as opts
document.getElementById('diffBtn').addEventListener('click',diffProposed); // diffProposed is a separate manual review action — NOT polled
// Honor ?tenant= from the URL (deep-link a specific tenant's plan — e.g. from Machines/Recommendations, and
// so the plan review + its deprecation warning are directly linkable). Mirrors the App Store's ?q= handling.
try{var ptn=new URLSearchParams(location.search).get('tenant');if(ptn){document.getElementById('tenant').value=ptn;}}catch(e){}
load();
// #142 U15/real-time — /environment self-refreshes on a visibility-aware poll (same pattern as /machines #140 +
// /history+/recs #141), COMPLETING the real-time set across all 5 admin surfaces. Polls the plan load() ONLY
// (diffProposed stays manual). Pause on a hidden tab, refetch on foreground, never stack timers, no manual reload.
var POLL=null;
function stopPoll(){if(POLL){clearInterval(POLL);POLL=null;}}
function startPoll(){stopPoll();POLL=setInterval(function(){if(!document.hidden)load({quiet:true});},30000);}
document.addEventListener('visibilitychange',function(){if(!document.hidden&&POLL)load({quiet:true});});
</script>`,
    ),
  ),
);
// Machines nav section (N03/N07/S04/S05) — the operator's device inventory. Paste the admin token,
// fetch /api/devices, render enrolled machines + their status. The SECOND live dashboard nav section
// (after History). All rendered values HTML-escaped client-side (no XSS); full §16 polish is ahead.
app.get('/machines', (c) =>
  c.html(
    htmlPage(
      'Machines · aid',
      `<nav class=muted><a href="/">aid</a><a href="/machines">Machines</a><a href="/apps">App Store</a><a href="/environment">Environment</a><a href="/recommendations">Recommendations</a><a href="/history">History</a></nav>
<h1>Machines <span class=muted>· device inventory</span></h1>
<div class=card>
<p class=muted>Paste your admin token to list the enrolled machines for a tenant (label · device id · enrolled · status).</p>
<p><input id=tenant placeholder="tenant (default _default)" style="width:46%"> <input id=tok type=password placeholder="AID_ADMIN_TOKEN" style="width:46%"></p>
<p><button id=loadBtn>Load machines</button></p></div>
<div id=out class=muted>No machines loaded.</div>
<div id=detail></div>
<script>
// #130 Trusted-Types arc (the LAST page) — the cell helpers now APPEND DOM NODES to a parent (createElement/
// textContent, auto-escaped) instead of returning HTML strings, so load()/detail()/bundle() use no innerHTML.
function tag(t){var s=document.createElement('span');s.className='tag';s.textContent=t;return s;}
function muted(t){var s=document.createElement('span');s.className='muted';s.textContent=t;return s;}
function fmtAgo(iso){var t=Date.parse(iso);if(!iso||isNaN(t))return '';var s=Math.max(0,(Date.now()-t)/1000);if(s<60)return Math.floor(s)+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}
// #139 U15 — a glanceable freshness DOT: observed connectivity as a colour (ok cyan / stale amber / never grey),
// so freshness reads at a glance, not just from the text. Driven by health.connectivity the rollup already computes.
function freshDot(d){var c=(d.health&&d.health.connectivity)||'';var color=c==='ok'?'#00e5ff':(c==='stale'?'#f0a020':'#888');var s=document.createElement('span');s.setAttribute('style','color:'+color+';margin-right:5px;font-size:11px;line-height:1');s.title='freshness: '+(c||'unknown');s.textContent='●';return s;}
function appendLastActive(parent,d){parent.append(freshDot(d));if(!d.lastSeen){parent.append(muted('never reported'));return;}var stale=(Date.now()-Date.parse(d.lastSeen))>86400000;parent.append((d.lastKind||'event')+' · '+fmtAgo(d.lastSeen));if(stale)parent.append(' ',tag('stale'));}
function appendDriftCell(parent,d,cur){if(d.drift==='drifted'){parent.append(tag('drifted'),' '+(d.lastRevision||'')+'→'+(cur||'?'));return;}if(d.drift==='current'){parent.append(muted('up to date ('+(cur||'')+')'));return;}parent.append(muted('—'));}
function appendScopeCell(parent,d){var g=d.grantedPermissions||[];if(!g.length){parent.append(muted('—'));return;}g.forEach(function(p,i){if(i)parent.append(' ');parent.append(tag(p));});}
function appendHealthCell(parent,d){var h=d.health||{};function dot(k,v){var warn=(v==='stale'||v==='drifted'||v==='never');var s=document.createElement('span');s.className=warn?'tag':'muted';s.title=k+': '+(v||'?');s.textContent=k+':'+(v==='not_configured'?'none':(v||'?'));return s;}parent.append(dot('conn',h.connectivity),' ',dot('sw',h.software),' ',dot('bkp',h.backup));}
async function load(opts){
  opts=opts||{};
  var out=document.getElementById('out'),tok=document.getElementById('tok').value.trim(),t=document.getElementById('tenant').value.trim()||'_default';
  if(!opts.quiet)out.textContent='Loading…'; // #140 quiet background poll ticks never flash Loading…
  try{
    var r=await fetch('/api/devices?tenant='+encodeURIComponent(t)+'&limit=200',{headers:aidAdminHeaders()});
    var j=await r.json();
    if(!r.ok){out.textContent='✗ '+(j.error||r.status)+aidAuthHint(r.status);stopPoll();return} // #140 stop polling on auth failure
    if(!j.items||!j.items.length){out.textContent='No machines enrolled for '+t+'.';stopPoll();return}
    LAST={};j.items.forEach(function(d){LAST[d.deviceId]=d});CUR=j.currentRevision;
    var frag=document.createDocumentFragment();
    var p=document.createElement('p');p.className='muted';p.textContent=j.count+' machines · tenant '+t+' · desired revision '+(j.currentRevision||'—')+' · drift = last-applied vs desired · health = connectivity·software·backup · scope = granted permissions · click a device for its timeline';
    // #140 U15/real-time — a subtle "live" affordance so the operator knows the surface auto-refreshes (no manual reload).
    var live=document.createElement('span');live.setAttribute('style','color:#00e5ff;margin-left:6px');live.title='auto-refreshing every 30s — pauses when the tab is hidden';live.textContent='↻ live · auto-refresh 30s';p.append(live);
    frag.append(p);
    // N08/U15 (#138) — an at-a-glance FLEET-HEALTH rollup from summary (observed, not optimistic): if nothing
    // is wrong show one "all healthy" line; else surface the problem counts as colour-cued badges so an
    // operator sees fleet health without scanning every row. TT-safe (createElement/textContent).
    if(j.summary){var sm=j.summary;var hb=document.createElement('p');hb.setAttribute('style','margin:0 0 8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center');
      var issues=(sm.stale||0)+(sm.neverReported||0)+(sm.drifted||0)+(sm.revoked||0);
      if(!issues){var oks=document.createElement('span');oks.className='muted';oks.textContent='✓ all '+sm.total+' machines reporting + at the desired revision';hb.append(oks);}
      else{function hbTag(n,label,color){if(!n)return;var s=document.createElement('span');s.className='tag';s.setAttribute('style','border-color:'+color+';color:'+color);s.textContent=n+' '+label;hb.append(s);}
        if(sm.revoked){var actx=document.createElement('span');actx.className='muted';actx.textContent=sm.active+' active of '+sm.total+' · ';hb.append(actx);}
        hbTag(sm.ok,'reporting','#00e5ff');hbTag(sm.stale,'stale','#f0a020');hbTag(sm.neverReported,'never reported','#888');hbTag(sm.drifted,'drifted','#f0a020');hbTag(sm.revoked,'revoked (decommissioned)','#e05555');}
      frag.append(hb);}
    var table=document.createElement('table');var thead=document.createElement('thead'),htr=document.createElement('tr');
    ['label','device','tenant','enrolled','last active','drift','health','scope','status'].forEach(function(h){var th=document.createElement('th');th.textContent=h;htr.append(th);});
    thead.append(htr);table.append(thead);
    var tbody=document.createElement('tbody');
    j.items.forEach(function(d){
      var tr=document.createElement('tr');function td(){var c=document.createElement('td');tr.append(c);return c;}
      td().textContent=d.label||'—';
      var btn=document.createElement('button');btn.className='lnk';btn.setAttribute('data-act','detail');btn.setAttribute('data-id',d.deviceId);btn.textContent=d.deviceId; // #121 delegation
      td().append(btn);
      td().textContent=d.tenant||'';td().textContent=d.enrolledAt||'';
      appendLastActive(td(),d);appendDriftCell(td(),d,j.currentRevision);appendHealthCell(td(),d);appendScopeCell(td(),d);
      var stTd=td();if(d.revoked)stTd.append(tag('revoked'));else stTd.textContent='active';
      tbody.append(tr);
    });
    table.append(tbody);frag.append(table);out.replaceChildren(frag);
    startPoll(); // #140 (re)arm the visibility-aware poller after a successful load
  }catch(e){out.textContent='✗ '+e}
}
var LAST={},CUR=null;
// #140 U15/real-time — the inventory SELF-REFRESHES: a visibility-aware poll keeps freshness/drift/health current
// with NO manual "Load machines" click (per real-time-data-no-manual-refresh). Pause when the tab is hidden (no
// wasted fetches), refetch immediately on return to foreground, never stack timers (startPoll clears first).
var POLL=null;
function stopPoll(){if(POLL){clearInterval(POLL);POLL=null;}}
function startPoll(){stopPoll();POLL=setInterval(function(){if(!document.hidden)load({quiet:true});},30000);}
document.addEventListener('visibilitychange',function(){if(!document.hidden&&POLL)load({quiet:true});});
// N09 device detail — click a device row to load its identity + health + scope + drift + unified
// change timeline (GET /api/history?device=, reusing the admin token already entered on this page).
async function detail(id){
  var dp=document.getElementById('detail'),tok=document.getElementById('tok').value.trim(),t=document.getElementById('tenant').value.trim()||'_default',m=LAST[id]||{};
  dp.textContent='Loading timeline for '+id+'…';
  try{
    var r=await fetch('/api/history?tenant='+encodeURIComponent(t)+'&device='+encodeURIComponent(id)+'&limit=50',{headers:aidAdminHeaders()});
    var j=await r.json();
    if(!r.ok){dp.textContent='✗ '+(j.error||String(r.status))+aidAuthHint(r.status);return}
    var g=(m.grantedPermissions||[]).join(', ')||'—';
    var card=document.createElement('div');card.className='card';
    var hp=document.createElement('p');var st=document.createElement('strong');st.textContent=m.label||id;var idSpan=document.createElement('span');idSpan.className='mono muted';idSpan.textContent=id;hp.append(st,' ',idSpan);
    if(m.revoked)hp.append(' ',tag('revoked'));
    var bbtn=document.createElement('button');bbtn.className='lnk';bbtn.setAttribute('data-act','bundle');bbtn.setAttribute('data-id',id);bbtn.textContent='⬇ Support bundle';hp.append(' ',bbtn);card.append(hp);
    var hp2=document.createElement('p');hp2.className='muted';hp2.append('health ');appendHealthCell(hp2,m);hp2.append(' · drift ');appendDriftCell(hp2,m,CUR);hp2.append(' · scope '+g+' · last active ');appendLastActive(hp2,m);card.append(hp2);
    var hp3=document.createElement('p');hp3.className='muted';hp3.textContent=j.count+' event(s) · unified change timeline · recording: '+(j.recordingMode||'events-only')+' (no terminal capture yet)';card.append(hp3);
    var sbDiv=document.createElement('div');sbDiv.id='sb';card.append(sbDiv);
    var table=document.createElement('table');var thead=document.createElement('thead'),htr=document.createElement('tr');['time','kind','status','run','revision','summary'].forEach(function(h){var th=document.createElement('th');th.textContent=h;htr.append(th);});thead.append(htr);table.append(thead);
    var tbody=document.createElement('tbody');var items=j.items||[];
    if(items.length){items.forEach(function(e){var tr2=document.createElement('tr');function td(){var c=document.createElement('td');tr2.append(c);return c;}td().textContent=e.createdAt||'';td().textContent=e.kind||'';td().textContent=e.status||'';var rc=td();if(e.correlationId){var rs=tag((e.parentRunId?'↳ ':'')+String(e.correlationId).slice(-6));rs.title='run '+e.correlationId+(e.parentRunId?(' · child of '+e.parentRunId):'');rc.append(rs);}else rc.append(muted('—'));td().textContent=e.revision||'';td().textContent=e.summary||'';tbody.append(tr2);});}
    else{var etr=document.createElement('tr');var etd=document.createElement('td');etd.colSpan=6;etd.className='muted';etd.textContent='No events reported yet.';etr.append(etd);tbody.append(etr);}
    table.append(tbody);card.append(table);dp.replaceChildren(card);
    dp.scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(e){dp.textContent='✗ '+String(e)}
}
// fire #83 — surface the U12 support bundle from the device detail (interconnectedness): fetch the
// admin-scoped diagnostic, render its SANITIZED contents/excluded manifest (so the operator SEES what is
// and is NOT included), and offer a one-click JSON download to attach to a support request. Reuses the
// admin token already entered on this page; the endpoint sanitizes by construction (no token/secret/detail).
var LASTSB=null;
async function bundle(id){
  var sb=document.getElementById('sb'),tok=document.getElementById('tok').value.trim(),t=document.getElementById('tenant').value.trim()||'_default';
  if(!sb)return;
  sb.replaceChildren(muted('Building support bundle…'));
  try{
    var r=await fetch('/api/devices/'+encodeURIComponent(id)+'/support-bundle?tenant='+encodeURIComponent(t),{headers:aidAdminHeaders()});
    var j=await r.json();
    if(!r.ok){sb.textContent='✗ '+(j.error||String(r.status))+aidAuthHint(r.status);return}
    LASTSB=j;
    function ul(items,mark){var u=document.createElement('ul');u.className='muted';items.forEach(function(x){var li=document.createElement('li');li.textContent=mark+' '+x;u.append(li);});return u;}
    var card=document.createElement('div');card.className='card';card.style.marginTop='8px';
    var p1=document.createElement('p');var st=document.createElement('strong');st.textContent='Support bundle';p1.append(st,' ',tag('v'+(j.bundleVersion||'')),' ',muted('generated '+(j.generatedAt||'')+' · recording '+(j.recordingMode||'')),' ');
    var db=document.createElement('button');db.className='lnk';db.setAttribute('data-act','dlbundle');db.textContent='⬇ Download JSON';p1.append(db);card.append(p1);
    var p2=document.createElement('p');p2.className='muted';p2.textContent='A sanitized, one-artifact diagnostic to attach to a support request — included, and what is deliberately left out:';card.append(p2);
    var row=document.createElement('div');row.style.display='flex';row.style.gap='28px';row.style.flexWrap='wrap';
    var colI=document.createElement('div');var pi=document.createElement('p');pi.className='muted';var si=document.createElement('strong');si.textContent='Included';pi.append(si);colI.append(pi,ul(j.contents||[],'✓'));
    var colX=document.createElement('div');var px=document.createElement('p');px.className='muted';var sx=document.createElement('strong');sx.textContent='Excluded (sanitized)';px.append(sx);colX.append(px,ul(j.excluded||[],'✗'));
    row.append(colI,colX);card.append(row);sb.replaceChildren(card);
  }catch(e){sb.textContent='✗ '+String(e)}
}
function dlbundle(){
  if(!LASTSB)return;
  var name='support-bundle-'+((LASTSB.device&&LASTSB.device.deviceId)||'device')+'.json';
  var blob=new Blob([JSON.stringify(LASTSB,null,2)],{type:'application/json'});
  var url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url)},1000);
}
// #121 CSP STEP 1 (COMPLETES the 7-page conversion) — wire the static Load button + delegate the DYNAMIC
// per-row buttons via data-act, toward dropping script-src 'unsafe-inline'. detail() lives in #out (device
// table); bundle()/dlbundle() live in #detail (bundle() writes #sb INSIDE #detail, so a #detail listener
// catches it by bubbling). load() now takes an opts arg (#140 quiet poll), so WRAP to avoid passing the click Event as opts.
document.getElementById('loadBtn').addEventListener('click',function(){load()});
document.getElementById('out').addEventListener('click',function(ev){
  var b=ev.target.closest('[data-act]');if(!b)return;
  if(b.getAttribute('data-act')==='detail')detail(b.getAttribute('data-id'));
});
document.getElementById('detail').addEventListener('click',function(ev){
  var b=ev.target.closest('[data-act]');if(!b)return;
  var a=b.getAttribute('data-act');
  if(a==='bundle')bundle(b.getAttribute('data-id'));
  else if(a==='dlbundle')dlbundle();
});
// Deep-link target (fire #67): /machines?device=<id> — if the admin token is already remembered
// (sessionStorage, #66), auto-load the inventory then open that device's detail. Lands a Recommendations
// "flagged device" click directly on its unified timeline. No token → the normal Load flow still applies.
addEventListener('DOMContentLoaded',function(){try{var dev=new URLSearchParams(location.search).get('device');if(!dev)return;var tok=sessionStorage.getItem('aidAdminToken');if(!tok)return;var el=document.getElementById('tok');if(el)el.value=tok;Promise.resolve(load()).then(function(){detail(dev)})}catch(e){}});
</script>`,
    ),
  ),
);
// App Store nav section (N03/N07/R13) — PUBLIC catalog browse. Loads the first page on open; the search
// box filters /api/catalog live (debounced). No token (public software info). Values HTML-escaped client-side.
app.get('/apps', (c) =>
  c.html(
    htmlPage(
      'App Store · aid',
      `<nav class=muted><a href="/">aid</a><a href="/machines">Machines</a><a href="/apps">App Store</a><a href="/environment">Environment</a><a href="/recommendations">Recommendations</a><a href="/history">History</a></nav>
<h1>App Store <span class=muted>· installable catalog</span></h1>
<div class=card>
<p class=muted>Everything Install Doctor can install, from the software.yml catalog. Search by name, command, or what it does; each shows its package managers + platforms.</p>
<p><input id=q placeholder="Search by name, command, or what it does (e.g. ripgrep, fuzzy finder, container)…" style="width:100%"></p>
<p class=muted>Platform: <select id=plat style="background:#0b0f14;color:inherit;border:1px solid #223;border-radius:4px;padding:2px 6px"><option value="">All platforms</option><option value="macos">macOS</option><option value="linux">Linux</option><option value="windows">Windows</option></select> <span class=muted>— show only tools installable on your OS</span></p></div>
<div id=out class=muted>Loading catalog…</div>
<script>
// #128 Trusted-Types arc — the App Store helpers now return DOM NODES (not HTML strings), so detail()/load()
// build everything with createElement/textContent (auto-escaped) + replaceChildren. No innerHTML, no esc().
function tagEl(text,title,style){var s=document.createElement('span');s.className='tag';s.textContent=text;if(title)s.title=title;if(style)s.setAttribute('style',style);return s;}
function appendTags(parent,arr){(arr||[]).forEach(function(x,i){if(i)parent.append(' ');parent.append(tagEl(x));});}
// D06 install mode — a user browsing the App Store sees whether a tool is a desktop app installed during
// setup, a required service, or a CLI installed lazily on first command use (the core eager-vs-lazy promise).
// #153 eager-vs-lazy ACCURACY — a CLI with software.yml _preload:true is EAGER-installed at provisioning by
// installx (NOT lazy), so preloaded CLIs read "installed at setup", lazy CLIs "on first use". app/service are
// always eager. The preload flag flows from the catalog (gen-catalog derives it from the _preload field).
function modeLabel(m,preload){if(m==='app')return 'desktop app';if(m==='service')return 'service';return preload?'CLI · installed at setup':'CLI · on first use'}
function modeBadgeEl(m,preload){var cli=preload?'A command-line tool — preloaded at provisioning (installed up front, then ready immediately)':'A command-line tool — installed automatically the first time you run it (lazy)';var T={app:'A GUI desktop application — installed during desktop provisioning (eager)',service:'A background service — installed + configured to run'};return tagEl(modeLabel(m,preload),T[m]||cli);}
function modeDesc(m,bin,preload){if(m==='app')return 'Desktop app — installed during desktop provisioning (the GUI app is set up up front).';if(m==='service')return 'Service — installed and configured to run as a background service.';return preload?'CLI — preloaded during provisioning (installed up front so '+(bin||'it')+' is ready immediately), not lazy.':'CLI — installed automatically the first time you run '+(bin||'it')+' (lazy, on first use).'}
// D14/D15 — the maintainer flagged this tool deprecated/not-recommended (software.yml _deprecated, 147 entries).
// WARN before a user installs it + show the reason (often naming a replacement). Absent = not flagged.
function depBadgeEl(d){return d?tagEl('deprecated','Deprecated: '+d,'border-color:#f0a020;color:#f0a020'):null;}
function depWarnEl(d){if(!d)return null;var div=document.createElement('div');div.setAttribute('style','border-left:3px solid #f0a020;padding:6px 10px;margin:2px 0 8px;background:#1a1407;border-radius:4px');var b=document.createElement('b');b.setAttribute('style','color:#f0a020');b.textContent='Deprecated';var s=document.createElement('span');s.className='muted';s.textContent=d;div.append(b,' ',s);return div;}
// D07 — runtime dependencies (software.yml _deps). Each dep links to its own App Store entry (interconnected,
// like the Environment plan's package links); a dep that isn't a browseable package just searches empty, honestly.
function appendDepsLinks(parent,a){(a||[]).forEach(function(x,i){if(i)parent.append(' ');var link=document.createElement('a');link.className='tag';link.href='/apps?q='+encodeURIComponent(x);link.title='View '+x+' in the App Store';link.textContent=x;parent.append(link);});}
async function detail(tr,name){
  var ex=tr.nextElementSibling;
  if(ex&&ex.className==='detail'){ex.remove();return}            // toggle closed
  var dr=document.createElement('tr');dr.className='detail';
  var dtd=document.createElement('td');dtd.colSpan=4;dtd.className='muted';dtd.textContent='Loading install commands…';dr.append(dtd);
  tr.parentNode.insertBefore(dr,tr.nextSibling);
  try{
    var r=await fetch('/api/catalog/'+encodeURIComponent(name));var j=await r.json();
    if(!r.ok||!j.commands||!j.commands.length){dtd.textContent='No install commands.';return}
    var frag=document.createDocumentFragment();
    var dw=depWarnEl(j.deprecated);if(dw)frag.append(dw);
    var modeLine=document.createElement('div');modeLine.setAttribute('style','margin:2px 0 6px');var md=document.createElement('span');md.className='muted';md.textContent=modeDesc(j.installMode,j.bin,j.preload);modeLine.append(modeBadgeEl(j.installMode,j.preload),' ',md);frag.append(modeLine);
    var installLine=document.createElement('div');installLine.className='muted';installLine.setAttribute('style','margin:2px 0 6px');installLine.append('Install ');var nb=document.createElement('b');nb.textContent=j.name;installLine.append(nb,' (command: '+(j.bin||'')+') on ');appendTags(installLine,j.platforms);installLine.append(':');frag.append(installLine);
    // A10 (#137) — state what the tool is NOT installable on (complement of platforms), so availability is
    // explicit, not inferred from the absence of a tag. Muted so it reads as a limitation, not an action.
    if(j.unavailablePlatforms&&j.unavailablePlatforms.length){var unLine=document.createElement('div');unLine.className='muted';unLine.setAttribute('style','margin:2px 0 6px');unLine.append('Not available on: ');var plLbl={macos:'macOS',linux:'Linux',windows:'Windows'};j.unavailablePlatforms.forEach(function(p,i){if(i)unLine.append(' ');unLine.append(tagEl(plLbl[p]||p,'',''+'border-color:#555;color:#999'));});frag.append(unLine);}
    if(j.deps&&j.deps.length){var depsLine=document.createElement('div');depsLine.className='muted';depsLine.setAttribute('style','margin:2px 0 6px');depsLine.append('Depends on: ');appendDepsLinks(depsLine,j.deps);frag.append(depsLine);}
    // R14/F15 (#136) — config coverage: a tool with a post-installx hook gets an AUTOMATED first-run setup
    // step. Name the concrete action (the hook); absent → nothing (honest, no false "configured" claim).
    if(j.configured){var cfgLine=document.createElement('div');cfgLine.className='muted';cfgLine.setAttribute('style','margin:2px 0 6px');var ck=document.createElement('b');ck.setAttribute('style','color:#00e5ff');ck.textContent='✓ Configured on install';cfgLine.append(ck,' — Install Doctor runs a first-run setup step automatically after install ('+(j.postInstall||'post-'+j.name+'.sh')+').');frag.append(cfgLine);}
    // #146 D11 — "Maintained by <owner>" (the github org/user, derived server-side from the provenance URL): a
    // trust/ownership signal. Links to the owner's GitHub. Absent owner → nothing (honest). TT-safe DOM.
    if(j.owner){var mby=document.createElement('div');mby.className='muted';mby.setAttribute('style','margin:2px 0 6px');mby.append('Maintained by: ');var ownA=document.createElement('a');ownA.href='https://github.com/'+encodeURIComponent(j.owner);ownA.target='_blank';ownA.rel='noopener';ownA.textContent=j.owner;mby.append(ownA);frag.append(mby);}
    var parts=[['Source',j.github],['Homepage',j.home],['Docs',j.docs]].filter(function(p){return p[1]});
    if(parts.length){var srcLine=document.createElement('div');srcLine.className='muted';srcLine.setAttribute('style','margin:2px 0 6px');srcLine.append('Learn more: ');parts.forEach(function(p,i){if(i)srcLine.append(' · ');var la=document.createElement('a');la.href=p[1];la.target='_blank';la.rel='noopener';la.textContent=p[0];srcLine.append(la);});frag.append(srcLine);}
    if(j.detectCommand){var dcLbl=document.createElement('div');dcLbl.className='muted';dcLbl.setAttribute('style','margin:2px 0 2px');dcLbl.textContent='Check if already installed (adopt, not reinstall):';frag.append(dcLbl);var dcc=document.createElement('span');dcc.className='cmd';dcc.textContent=j.detectCommand;frag.append(dcc);}
    j.commands.forEach(function(k){var sc=document.createElement('span');sc.className='cmd';var pb=document.createElement('b');pb.textContent=k.provider;sc.append(pb,k.command);frag.append(sc);});
    // #147 D11 update-channel — how to keep the tool CURRENT (promise #8): the per-provider UPDATE command, which
    // differs from install for most managers (brew upgrade, cargo install --force, npm update -g, …). TT-safe DOM.
    if(j.updateCommands&&j.updateCommands.length){var upLbl=document.createElement('div');upLbl.className='muted';upLbl.setAttribute('style','margin:8px 0 2px');upLbl.textContent='Update (keep current):';frag.append(upLbl);j.updateCommands.forEach(function(k){var uc=document.createElement('span');uc.className='cmd';var ub=document.createElement('b');ub.textContent=k.provider;uc.append(ub,k.command);frag.append(uc);});}
    if(j.uninstallCommands&&j.uninstallCommands.length){var unLbl=document.createElement('div');unLbl.className='muted';unLbl.setAttribute('style','margin:8px 0 2px');unLbl.textContent='Uninstall:';frag.append(unLbl);j.uninstallCommands.forEach(function(k){var xc=document.createElement('span');xc.className='cmd';var xb=document.createElement('b');xb.textContent=k.provider;xc.append(xb,k.command);frag.append(xc);});}
    dtd.replaceChildren(frag);
  }catch(e){dtd.textContent='✗ '+e}
}
async function load(){
  var out=document.getElementById('out'),q=document.getElementById('q').value.trim(),plat=document.getElementById('plat').value;
  try{
    var r=await fetch('/api/catalog?limit=60'+(q?('&q='+encodeURIComponent(q)):'')+(plat?('&platform='+encodeURIComponent(plat)):''));
    var j=await r.json();
    if(!r.ok){out.textContent='✗ '+(j.error||r.status);return}
    var platlabel=plat?({macos:'macOS',linux:'Linux',windows:'Windows'}[plat]||plat):'';
    if(!j.items||!j.items.length){out.textContent='No apps match'+(q?(' "'+q+'"'):'')+(platlabel?(' on '+platlabel):'')+'.';return}
    var frag=document.createDocumentFragment();
    var p=document.createElement('p');p.className='muted';p.textContent=j.matched+' of '+j.total+' apps'+(platlabel?(' on '+platlabel):'')+(j.count<j.matched?(' · showing '+j.count):'')+' · click a name for install commands';frag.append(p);
    var table=document.createElement('table');
    var thead=document.createElement('thead'),htr=document.createElement('tr');
    ['name','command','installers','platforms'].forEach(function(h){var th=document.createElement('th');th.textContent=h;htr.append(th);});
    thead.append(htr);table.append(thead);
    var tbody=document.createElement('tbody');
    j.items.forEach(function(e){
      var tr=document.createElement('tr');
      var nameTd=document.createElement('td');
      var btn=document.createElement('button');btn.className='lnk';btn.setAttribute('data-name',e.name);btn.textContent=e.name; // #118 delegation: #out click → .lnk + data-name
      nameTd.append(btn,' ',modeBadgeEl(e.installMode,e.preload));
      var db=depBadgeEl(e.deprecated);if(db)nameTd.append(db);
      if(e.short){var sd=document.createElement('div');sd.className='muted';sd.setAttribute('style','font-size:.85em;max-width:52ch');sd.textContent=e.short;nameTd.append(sd);}
      tr.append(nameTd);
      var cmdTd=document.createElement('td');cmdTd.className='mono';cmdTd.textContent=e.bin||'';tr.append(cmdTd);
      var provTd=document.createElement('td');appendTags(provTd,e.providers);tr.append(provTd);
      var platTd=document.createElement('td');appendTags(platTd,e.platforms);tr.append(platTd);
      tbody.append(tr);
    });
    table.append(tbody);frag.append(table);
    out.replaceChildren(frag);
  }catch(e){out.textContent='✗ '+e}
}
document.getElementById('out').addEventListener('click',function(ev){
  var b=ev.target.closest('.lnk');if(!b)return;
  detail(b.closest('tr'),b.getAttribute('data-name'));
});
var t;function debounced(){clearTimeout(t);t=setTimeout(load,160)}
// #118 CSP STEP 1 — wire the static search box + platform filter via addEventListener (no inline on*=),
// toward dropping script-src 'unsafe-inline'. (The dynamic result rows already use event delegation above.)
document.getElementById('q').addEventListener('input',debounced);
document.getElementById('plat').addEventListener('change',load);
// Honor ?q= from the URL (e.g. a package link from the Environment plan) — prefill the search + filter on load.
try{var pq=new URLSearchParams(location.search).get('q');if(pq){document.getElementById('q').value=pq;}}catch(e){}
load();
</script>`,
    ),
  ),
);
// Recommendations nav section (N03) — actionable RULE-BASED recs from observed drift/freshness. Paste
// the admin token, fetch /api/recommendations, render severity-coded cards. AI enrichment pending #7.
app.get('/recommendations', (c) =>
  c.html(
    htmlPage(
      'Recommendations · aid',
      `<nav class=muted><a href="/">aid</a><a href="/machines">Machines</a><a href="/apps">App Store</a><a href="/environment">Environment</a><a href="/recommendations">Recommendations</a><a href="/history">History</a></nav>
<h1>Recommendations <span class=muted>· what to do next</span></h1>
<div class=card>
<p class=muted>Paste your admin token for actionable, rule-based recommendations from your fleet's observed state (drift · never-reported · stale). AI enrichment is pending the provider connection.</p>
<p><input id=tenant placeholder="tenant (default _default)" style="width:46%"> <input id=tok type=password placeholder="AID_ADMIN_TOKEN" style="width:46%"></p>
<p><button id=loadRecs>Load recommendations</button></p></div>
<div id=out class=muted>No recommendations loaded.</div>
<script>
async function load(opts){
  opts=opts||{};
  var out=document.getElementById('out'),tok=document.getElementById('tok').value.trim(),t=document.getElementById('tenant').value.trim()||'_default';
  if(!opts.quiet)out.textContent='Loading…'; // #141 quiet background poll ticks never flash Loading…
  try{
    var r=await fetch('/api/recommendations?tenant='+encodeURIComponent(t),{headers:aidAdminHeaders()});
    var j=await r.json();
    if(!r.ok){out.textContent='✗ '+(j.error||r.status)+aidAuthHint(r.status);stopPoll();return} // #141 stop polling on auth failure
    startPoll(); // #141 authorized response → keep the surface live (covers empty + populated)
    // #125 Trusted-Types-safe render (no innerHTML, toward require-trusted-types-for 'script') — build the summary
    // + each rec card with createElement; .append(string) makes an auto-escaped text node, so esc() is gone.
    var frag=document.createDocumentFragment();
    var dd=(j.distinctDeviceCount||0);
    var sum=document.createElement('p');sum.className='muted';
    sum.append((j.count||0)+' recommendation(s) · ');
    if(dd){var st=document.createElement('strong');st.textContent=dd;sum.append(st,' distinct machine(s) need attention · ');}
    else{sum.append('no machines need attention · ');}
    sum.append('tenant '+t+' · ');
    var gtag=document.createElement('span');gtag.className='tag';gtag.textContent=j.generated||'';
    sum.append(gtag,' · desired revision '+(j.currentRevision||'—'));
    var live=document.createElement('span');live.setAttribute('style','color:#00e5ff;margin-left:6px');live.title='auto-refreshing every 30s — pauses when the tab is hidden';live.textContent='↻ live';sum.append(' ',live); // #141
    frag.append(sum);
    (j.recommendations||[]).forEach(function(k){
      var card=document.createElement('div');card.className='card rec rec-'+(k.severity||'');
      var h=document.createElement('h3');h.textContent=k.title||'';
      var d=document.createElement('p');d.className='muted';d.textContent=k.detail||'';
      card.append(h,d);
      if(k.command){var rp=document.createElement('p');rp.className='muted';var code=document.createElement('code');code.textContent=k.command;var note=document.createElement('span');note.className='muted';note.textContent='(runs on the machine — the server never pushes installs)';rp.append('Repair: ',code,' on the host ',note);card.append(rp);}
      var devs=(k.devices||[]);
      if(devs.length){var dp=document.createElement('p');dp.className='mono';devs.forEach(function(id,i){if(i)dp.append(' ');var a=document.createElement('a');a.href='/machines?device='+encodeURIComponent(id);a.textContent=id;dp.append(a);});card.append(dp);}
      frag.append(card);
    });
    out.replaceChildren(frag);
  }catch(e){out.textContent='✗ '+e}
}
document.getElementById('loadRecs').addEventListener('click',function(){load()}); // CSP STEP-1 (#117) — no inline on*=; #141 wrap so the click Event isn't passed as opts
// #141 U15/real-time — /recommendations self-refreshes on a visibility-aware poll (same pattern as /machines #140).
// Pause on a hidden tab, refetch on foreground, never stack timers, no manual reload.
var POLL=null;
function stopPoll(){if(POLL){clearInterval(POLL);POLL=null;}}
function startPoll(){stopPoll();POLL=setInterval(function(){if(!document.hidden)load({quiet:true});},30000);}
document.addEventListener('visibilitychange',function(){if(!document.hidden&&POLL)load({quiet:true});});
</script>`,
    ),
  ),
);
app.get('/pair', (c) => {
  const code = (c.req.query('code') || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 16);
  return c.html(
    htmlPage(
      'Pair device · aid',
      `<nav class=muted><a href="/">aid</a></nav>
<h1>Pair this device</h1>
${code ? `<p class=muted>Pairing code:</p><p class=code>${code}</p><div id=info class=card>Loading device details…</div>` : '<p class=muted>No code in the URL. Run <span class=mono>aid-pair</span> on the machine to get one.</p>'}
<div class=card><h3>Approve (administrator)</h3>
<p class=muted>Review the device above, then paste your admin token to approve it. A signed-in owner session replaces this step soon.</p>
<p><input id=tok type=password placeholder="AID_ADMIN_TOKEN" style="width:100%"></p>
<p><button id=approveBtn>Approve pairing</button></p>
<p id=out class=muted></p></div>
<script>
var CODE=${JSON.stringify(code)};
async function loadInfo(){
  if(!CODE)return;var el=document.getElementById('info');if(!el)return;
  // #127 Trusted-Types-safe render (no innerHTML, toward require-trusted-types-for 'script') — build the
  // approval details with createElement/textContent (auto-escaped). esc() removed.
  function errP(msg){var p=document.createElement('p');p.className='muted';p.textContent='✗ '+msg;return p;}
  function labeled(label,valueNode,muted){var p=document.createElement('p');if(muted)p.className='muted';var b=document.createElement('b');b.textContent=label;p.append(b,' ',valueNode);return p;}
  try{
    var r=await fetch('/api/devices/pair/info?code='+encodeURIComponent(CODE));var j=await r.json();
    if(!r.ok){el.replaceChildren(errP((j.error||r.status)+' — no pending pairing for this code.'));return}
    var frag=document.createDocumentFragment();
    var h=document.createElement('h3');h.append('You are approving');
    if(j.status==='expired'||j.status==='claimed'){var wt=document.createElement('span');wt.className='tag';wt.textContent=(j.status==='expired')?'expired':'already claimed';h.append(' ',wt);}
    frag.append(h);
    var hostSpan=document.createElement('span');hostSpan.className='mono';hostSpan.textContent=j.host||'(unnamed machine)';
    frag.append(labeled('Host:',hostSpan,false));
    frag.append(labeled('Tenant:',document.createTextNode(j.tenant||''),false));
    if(j.permissions&&j.permissions.length){
      var pp=document.createElement('p');var pb=document.createElement('b');pb.textContent='Requesting:';pp.append(pb,' ');
      j.permissions.forEach(function(p,i){if(i)pp.append(' ');var t=document.createElement('span');t.className='tag';t.textContent=p;pp.append(t);});
      frag.append(pp);
    }else{
      frag.append(labeled('Requesting:',document.createTextNode('standard device access (no elevated scope declared)'),true));
    }
    var note=document.createElement('p');note.className='muted';note.textContent='Approving enrolls this machine as a device in that tenant and mints a revocable, device-scoped token — never a reusable secret in any URL. Only approve a code you started yourself.';
    frag.append(note);
    el.replaceChildren(frag);
  }catch(e){el.replaceChildren(errP(String(e)))}
}
async function approve(){
  var out=document.getElementById('out'),tok=document.getElementById('tok').value.trim();
  out.textContent='Approving…';
  try{
    var r=await fetch('/api/devices/pair/approve',{method:'POST',headers:aidAdminHeaders({'content-type':'application/json'}),body:JSON.stringify({code:CODE})});
    var j=await r.json();
    out.textContent=r.ok?'✓ approved — the machine will claim its token shortly.':('✗ '+(j.error||r.status)+aidAuthHint(r.status));
  }catch(e){out.textContent='✗ '+e}
}
document.getElementById('approveBtn').addEventListener('click',approve); // CSP STEP-1 (#117) — no inline on*=
loadInfo();
</script>`,
    ),
  );
});

// Routing-policy decision surface (MASTER-PROMPT §8). Reuses aid-core's tested chooseRoute at the
// HTTP boundary: restricted sensitivity fails CLOSED (never escalates to premium), and premium
// requires explicit opt-in. Performs NO inference — no provider call, no keys, no cost — it only
// returns the route it WOULD use. Registered before the :route param handler so it wins.
// OpenCode provider config (aid-core SSOT) — the local `aid` client writes this to ~/.config/opencode
// so OpenCode routes through the control plane's /api/ai/v1. No secrets (apiKey is the {env:…} ref).
app.get('/api/provider-config', (c) => c.json(aidProviderConfig()));

// App Store catalog (D01/D02/R13) — PUBLIC, read-only browse of what Install Doctor can install, from
// software.yml via the validated parser. `?q=` filters by name, binary, OR description (case-insensitive
// substring — search by WHAT A TOOL DOES, not just its name); `?limit=` caps rows (1..200, default 50).
// No secrets, no tenant data — browseable signed-out (M11).
app.get('/api/catalog', (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase();
  // Platform filter: only tools installable on the chosen OS (every entry has real `platforms`). Allowlisted
  // server-side — an unknown value is ignored (→ all platforms), and the response ECHOES the filter actually
  // applied so the client can't be misled (D05 "supported platforms" + what-you-can-install-on-MY-machine).
  const platformRaw = (c.req.query('platform') || '').trim().toLowerCase();
  const platform = ['macos', 'linux', 'windows'].includes(platformRaw) ? platformRaw : '';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  let matched = q
    ? CATALOG.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.bin.toLowerCase().includes(q) ||
          (e.short ? e.short.toLowerCase().includes(q) : false),
      )
    : CATALOG;
  if (platform) matched = matched.filter((e) => (e.platforms || []).includes(platform));
  return c.json({
    total: CATALOG.length,
    matched: matched.length,
    count: Math.min(matched.length, limit),
    q: q || null,
    platform: platform || null,
    items: matched.slice(0, limit),
  });
});

// App Store per-item DETAIL (R13/R01) — the exact per-manager install command for one catalog entry,
// built from the SAME provider→command templates the cnf executor uses (D04). PUBLIC, read-only.
app.get('/api/catalog/:name', (c) => {
  const name = c.req.param('name');
  const e = CATALOG_BY_NAME.get(name);
  if (!e) return c.json({ error: 'not_found' }, 404);
  const pkgs = e.pkgs || {};
  const commands = (e.providers || [])
    .filter((p) => INSTALL_CMD[p] && pkgs[p])
    .map((p) => ({ provider: p, pkg: pkgs[p], command: INSTALL_CMD[p](pkgs[p]) }));
  // D11 (#147) — the matching per-provider UPDATE command (keep-current; promise #8), built the same way.
  const updateCommands = (e.providers || [])
    .filter((p) => UPDATE_CMD[p] && pkgs[p])
    .map((p) => ({ provider: p, pkg: pkgs[p], command: UPDATE_CMD[p](pkgs[p]) }));
  // R02/B14 (#152) — the matching per-provider UNINSTALL command (cleanly remove the tool), built the same way.
  // `go` has no uninstall verb so it's absent from UNINSTALL_CMD → go-only tools get an empty set (honest).
  const uninstallCommands = (e.providers || [])
    .filter((p) => UNINSTALL_CMD[p] && pkgs[p])
    .map((p) => ({ provider: p, pkg: pkgs[p], command: UNINSTALL_CMD[p](pkgs[p]) }));
  // A10 (#137) — state platform availability EXPLICITLY: the OSes this tool is NOT installable on (the
  // complement of its declared `platforms`), so the detail says what it's missing (empty = every platform).
  const unavailablePlatforms = AID_PLATFORMS.filter((p) => !(e.platforms || []).includes(p));
  // D11 (#146) — derive the maintenance OWNER (the github org/user) from the provenance URL so the App Store
  // can show WHO maintains a tool (a trust signal). Derived from EXISTING data (no new software.yml field, no
  // guess); a non-github or absent provenance URL yields no owner (undefined → omitted, honest).
  const owner = typeof e.github === 'string' ? (e.github.match(/github\.com\/([^/]+)\//) || [])[1] : undefined;
  // R01 detect stage — the idempotency/adoption primitive: POSIX `command -v <bin>` checks whether the tool is
  // ALREADY on PATH, so a run can ADOPT an existing install (F04) instead of reinstalling (B10/W02). Derived from
  // the bin field (every entry has one); universal + accurate, no per-tool guessing (unlike a verify `--version`).
  const detectCommand = e.bin ? `command -v ${e.bin}` : undefined;
  return c.json({ name: e.name, bin: e.bin, platforms: e.platforms, unavailablePlatforms, providers: e.providers, short: e.short, github: e.github, owner, home: e.home, docs: e.docs, installMode: e.installMode || 'cli', preload: e.preload === true, deprecated: e.deprecated, deps: e.deps, configured: e.configured, postInstall: e.postInstall, detectCommand, commands, updateCommands, uninstallCommands });
});

app.post('/api/ai/v1/resolve', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ResolveRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  const { sensitivity, kind, verificationFailed, allowPremium } = parsed.data;
  const route = chooseRoute({ sensitivity, kind, verificationFailed }, allowPremium);
  return c.json({
    route,
    model: `dynamic/${route}`,
    provider: 'projectsites→deepseek',
    policy: { restrictedFailsClosed: sensitivity === 'restricted', premiumOptIn: allowPremium },
    wiring: 'policy-only — no inference performed (provider / AI Gateway wiring pending)',
  });
});

// Proposed inference proxy (MASTER-PROMPT §8): aid → this adapter → shared ProjectSites orchestrator
// → one CF AI Gateway → permitted provider. SKELETON ONLY: validates the requested route alias against
// aid-core's ROUTES but performs NO provider call (no keys here — provider keys stay backend-side).
// ENVIRONMENT.md — the one portable configuration authority (MASTER-PROMPT §9, seed S01). Reuses
// aid-core's tested contracts: strict schema validation (unknown fields rejected), a lossless
// single-file Markdown round-trip, and a stable key-order-independent SHA-256 content digest. Pure
// data transforms — no secrets, no persistence (projections/storage are a later slice).
const envErr = (e: unknown) => (e instanceof Error ? e.message : String(e));
app.post('/api/environment/validate', async (c) => {
  try {
    const bp = validateBlueprint(await c.req.json());
    return c.json({ valid: true, revision: bp.revision, digest: await blueprintDigest(bp) });
  } catch (e) {
    return c.json({ valid: false, error: envErr(e) }, 400);
  }
});
app.post('/api/environment/export', async (c) => {
  try {
    return c.text(exportMarkdown(await c.req.json()), 200, { 'content-type': 'text/markdown; charset=utf-8' });
  } catch (e) {
    return c.json({ error: envErr(e) }, 400);
  }
});
app.post('/api/environment/import', async (c) => {
  try {
    const bp = importMarkdown(await c.req.text());
    return c.json({ blueprint: bp, digest: await blueprintDigest(bp) });
  } catch (e) {
    return c.json({ error: envErr(e) }, 400);
  }
});

// Structured blueprint-vs-blueprint diff for the §9 Environment "Diff" action — added/removed/changed
// packages, machines, services, routing, skills, privacy, revision. A pure view over two validated
// blueprints (no persistence yet); `changed` reflects any difference the digests would capture.
function diffMembers(
  label: string,
  from: ReadonlyArray<{ id: string }>,
  to: ReadonlyArray<{ id: string }>,
  out: Array<{ section: string; detail: string }>,
): void {
  const fa = new Map(from.map((x) => [x.id, JSON.stringify(x)]));
  const ta = new Map(to.map((x) => [x.id, JSON.stringify(x)]));
  for (const id of ta.keys()) if (!fa.has(id)) out.push({ section: label, detail: '+' + id });
  for (const id of fa.keys()) if (!ta.has(id)) out.push({ section: label, detail: '-' + id });
  for (const id of ta.keys()) if (fa.has(id) && fa.get(id) !== ta.get(id)) out.push({ section: label, detail: '~' + id });
}
function diffBlueprints(from: Blueprint, to: Blueprint): Array<{ section: string; detail: string }> {
  const out: Array<{ section: string; detail: string }> = [];
  if (from.revision !== to.revision) out.push({ section: 'revision', detail: `${from.revision} → ${to.revision}` });
  const fp = new Set(from.defaults.packages);
  const tp = new Set(to.defaults.packages);
  const added = [...tp].filter((p) => !fp.has(p));
  const removed = [...fp].filter((p) => !tp.has(p));
  if (added.length) out.push({ section: 'defaults.packages', detail: '+' + added.join(', ') });
  if (removed.length) out.push({ section: 'defaults.packages', detail: '-' + removed.join(', ') });
  if (from.defaults.shellHistory !== to.defaults.shellHistory)
    out.push({ section: 'defaults.shellHistory', detail: `${from.defaults.shellHistory} → ${to.defaults.shellHistory}` });
  diffMembers('machines', from.machines, to.machines, out);
  diffMembers('services', from.services, to.services, out);
  for (const k of ['engine', 'preferredProvider', 'allowPremium', 'maxTaskCostMicros'] as const)
    if (from.routing[k] !== to.routing[k]) out.push({ section: 'routing.' + k, detail: `${from.routing[k]} → ${to.routing[k]}` });
  if (from.skills.commit !== to.skills.commit)
    out.push({ section: 'skills.commit', detail: `${from.skills.commit.slice(0, 8)} → ${to.skills.commit.slice(0, 8)}` });
  for (const k of ['shellAnalysis', 'screenshots', 'terminalInput', 'productLearning'] as const)
    if (from.privacy[k] !== to.privacy[k]) out.push({ section: 'privacy.' + k, detail: `${from.privacy[k]} → ${to.privacy[k]}` });
  return out;
}
app.post('/api/environment/diff', async (c) => {
  try {
    const body = (await c.req.json()) as { from?: unknown; to?: unknown };
    const from = validateBlueprint(body.from);
    const to = validateBlueprint(body.to);
    const changes = diffBlueprints(from, to);
    return c.json({ changed: changes.length > 0, fromDigest: await blueprintDigest(from), toDigest: await blueprintDigest(to), changes });
  } catch (e) {
    return c.json({ error: envErr(e) }, 400);
  }
});

// Persistence read path (MASTER-PROMPT §9) — the stored "current" blueprint for a tenant, from D1.
// The Markdown is the authority; revision + digest are DERIVED on read. 404 when none (with the live
// row count as proof the store was queried); 503 if the binding is missing / the query errors.
// Write + revision-check + auth are a later fire.
app.get('/api/environment/current', async (c) => {
  const tenant = c.req.query('tenant') || '_default';
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const row = await db.prepare('SELECT markdown, updated_at FROM blueprints WHERE tenant = ?').bind(tenant).first();
    if (!row) {
      const cnt = await db.prepare('SELECT count(*) AS n FROM blueprints').first();
      return c.json({ error: 'not_found', tenant, stored: cnt?.n ?? 0 }, 404);
    }
    const bp = importMarkdown(row.markdown);
    // C12 "review the plan" (step 5): a compact structured summary so the dashboard can render an at-a-glance
    // breakdown synchronously with the markdown (no 2nd round-trip). Shape mirrors the blueprint subset the UI reads.
    const summary = {
      defaults: { packages: bp.defaults?.packages ?? [] },
      machines: (bp.machines ?? []).map((m) => ({ id: m.id, role: m.role })),
      services: (bp.services ?? []).map((s) => ({ id: s.id, kind: s.kind })),
      routing: { engine: bp.routing?.engine, preferredProvider: bp.routing?.preferredProvider, allowPremium: bp.routing?.allowPremium },
      privacy: bp.privacy,
      // C12/D06 — the plan's eager-vs-lazy install breakdown (desktop apps at setup · services · lazy CLIs).
      installModes: tallyInstallModes(bp),
      // C12/D14 safety — any packages in the plan the maintainer flagged deprecated (warn before applying).
      deprecatedPackages: collectDeprecated(bp),
      // A10 — per-OS list of plan packages NOT installable on that platform (partial-success made explicit).
      platformGaps: collectPlatformGaps(bp),
      // A10 (#155) — plan packages NOT in the catalog (no recipe), NAMED so the review shows which are uncovered.
      unknownPackages: collectUnknownPackages(bp),
      // F15/C12 (#161) — CONFIGURATION coverage: how many catalog-known plan packages auto-configure on install
      // (post-installx first-run hook), so the review shows what setup is automatic vs what stays manual (step-5).
      configured: collectConfigured(bp),
      // C12 (#162) — PRIVILEGES coverage: plan packages that require elevation (sudo) to install (a service or a
      // system-PM-only tool), so the review shows "will applying this need root?" before apply (step-5 privileges).
      privileges: collectPrivileges(bp),
    };
    return c.json({ tenant, revision: bp.revision, digest: await blueprintDigest(bp), updatedAt: row.updated_at, markdown: row.markdown, summary });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Constant-time bearer comparison (avoid timing leaks on the admin token).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Persistence WRITE path (MASTER-PROMPT §9) — store a tenant's "current" blueprint in D1 with
// OPTIMISTIC revision-check. Fail-closed auth: requires a configured AID_ADMIN_TOKEN (Worker secret,
// backend-side) AND a matching Bearer. Changing desired state is gated; a stale expectedRevision
// (concurrent edit) → 409 conflict. The Markdown is stored (the authority); the row is a projection.
app.put('/api/environment/current', async (c) => {
  const env = c.env as Record<string, any>;
  const configured = env.AID_ADMIN_TOKEN as string | undefined;
  if (!configured) return c.json({ error: 'write_auth_not_configured' }, 503);
  const auth = c.req.header('authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!presented || !safeEqual(presented, configured)) return c.json({ error: 'unauthorized' }, 401);
  const db = env.DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const body = (await c.req.json()) as { tenant?: string; blueprint?: unknown; expectedRevision?: string };
    const tenant = body.tenant || '_default';
    const bp = validateBlueprint(body.blueprint);
    const existing = await db.prepare('SELECT markdown FROM blueprints WHERE tenant = ?').bind(tenant).first();
    if (existing) {
      const current = importMarkdown(existing.markdown);
      if (body.expectedRevision !== undefined && body.expectedRevision !== current.revision)
        return c.json({ error: 'revision_conflict', storedRevision: current.revision, expectedRevision: body.expectedRevision }, 409);
    }
    const now = new Date().toISOString();
    await db
      .prepare('INSERT INTO blueprints (tenant, markdown, updated_at) VALUES (?,?,?) ON CONFLICT(tenant) DO UPDATE SET markdown=excluded.markdown, updated_at=excluded.updated_at')
      .bind(tenant, exportMarkdown(bp), now)
      .run();
    return c.json({ tenant, revision: bp.revision, digest: await blueprintDigest(bp), updatedAt: now });
  } catch (e) {
    return c.json({ error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// Bucket a diff (observed → desired) into reconciliation actions + a blast-radius count.
// '+' = desired has it, observed lacks it → install; '-' = observed has it, desired drops it →
// remove; '~' and scalar 'X → Y' changes → reconfigure.
function planSummary(changes: ReadonlyArray<{ section: string; detail: string }>) {
  let install = 0,
    remove = 0,
    reconfigure = 0;
  for (const ch of changes) {
    const c0 = ch.detail[0];
    if (c0 === '+') install++;
    else if (c0 === '-') remove++;
    else reconfigure++;
  }
  return { total: changes.length, install, remove, reconfigure, noop: changes.length === 0 };
}

// Shared apply-PREVIEW computation (observed → desired for a tenant) — one owner for the dry-run plan,
// reused by the tenant-in-body endpoint and the device-scoped one. Returns a {status, body} envelope so
// each caller forwards it with c.json(). Invalid observed → 400, no stored desired → 404.
async function computeApplyPreview(
  db: any,
  tenant: string,
  observedRaw: unknown,
  expectedRevision?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let observed: Blueprint;
  try {
    observed = validateBlueprint(observedRaw);
  } catch (e) {
    return { status: 400, body: { error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) } };
  }
  const row = await db.prepare('SELECT markdown FROM blueprints WHERE tenant = ?').bind(tenant).first();
  if (!row) return { status: 404, body: { error: 'no_desired_state', tenant, detail: 'no stored blueprint for this tenant — PUT /api/environment/current first' } };
  const desired = importMarkdown(row.markdown);
  // §3 invariant: execution must match the plan's expected revision. When the caller declares the
  // revision it planned against, reject a STALE plan (desired has since moved) — P09, reject mistargeted
  // jobs. Omitting expectedRevision preserves the prior unguarded preview behavior (back-compat).
  if (expectedRevision !== undefined && expectedRevision !== '' && expectedRevision !== desired.revision)
    return {
      status: 409,
      body: {
        error: 'revision_mismatch',
        tenant,
        desiredRevision: desired.revision ?? null,
        expectedRevision,
        detail: 'the plan is stale — desired state has moved; re-pull (aid pull / aid up) and retry',
      },
    };
  const changes = diffBlueprints(observed, desired);
  return {
    status: 200,
    body: {
      dryRun: true,
      applied: false,
      tenant,
      desiredRevision: desired.revision,
      desiredDigest: await blueprintDigest(desired),
      observedDigest: await blueprintDigest(observed),
      plan: planSummary(changes),
      changes,
    },
  };
}

// Apply-PREVIEW (dry-run) — MASTER-PROMPT §9, seeds S02 (desired-vs-observed diff) / S03 (restore
// preview) / S12 (impact + blast-radius before mutation). Given a machine's OBSERVED blueprint, compute
// the PLAN to reconcile it to the tenant's STORED desired blueprint (install / remove / reconfigure)
// with a blast-radius summary. NO mutation here: real apply runs on the on-device supervisor (Phase B)
// and fail-closes to 501. Reuses the tested diff engine with from=observed, to=desired.
app.post('/api/environment/apply', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  let body: { tenant?: string; observed?: unknown; dryRun?: boolean; expectedRevision?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_request', detail: 'body must be JSON' }, 400);
  }
  // Mutation cannot run in a Worker — only the device supervisor applies to a real machine. Fail closed.
  if (body.dryRun === false) {
    return c.json(
      { error: 'apply_not_implemented', applied: false, detail: 'real apply runs on the on-device supervisor (Phase B); only dryRun preview is available from the control plane' },
      501,
    );
  }
  const result = await computeApplyPreview(db, body.tenant || '_default', body.observed, body.expectedRevision);
  return c.json(result.body, result.status as any);
});

// --- Device identity (Phase B / S04 enrollment, S27 revocation) — ADR docs/aid/decisions/0002 ---
// Opaque bearer tokens; only the SHA-256 is stored, so a DB read never reveals the secret. Revocation
// is a row update (revoked_at), effective on the next request — no blocklist, no signing key.
function randHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Resolve a device Bearer token to its identity via hash lookup (rejects unknown / revoked). Returns
// null when absent/invalid/revoked so callers reply 401. One owner for device auth — shared by
// /devices/me + the device-scoped environment endpoints.
async function resolveDevice(
  db: any,
  authHeader: string | undefined,
): Promise<{ deviceId: string; tenant: string; label: string | null; createdAt: string; permissions: string[] } | null> {
  const token = (authHeader || '').startsWith('Bearer ') ? (authHeader as string).slice(7) : '';
  if (!token) return null;
  const row = await db
    .prepare('SELECT device_id, tenant, label, permissions, created_at, revoked_at FROM devices WHERE token_sha256 = ?')
    .bind(await sha256hex(token))
    .first();
  if (!row || row.revoked_at) return null;
  let permissions: string[] = [];
  try {
    if (row.permissions) permissions = JSON.parse(row.permissions as string);
  } catch {
    /* tolerate a legacy/unparseable value — read as no recorded scope */
  }
  return { deviceId: row.device_id, tenant: row.tenant, label: row.label, createdAt: row.created_at, permissions };
}
// P05-enforcement (O12 — authorize each host action server-side): gate a device action on the
// device's RECORDED granted scope (persisted at claim, fire #53). Returns a 403 Response to
// short-circuit, or null when allowed. A device with an EMPTY recorded scope is GRANDFATHERED
// (legacy devices enrolled before the scope was persisted) so enforcement never breaks an
// already-paired machine. 403 (not 404) — the device is known; the ACTION isn't granted.
function requireScope(c: any, dev: { permissions: string[] }, permission: string): Response | null {
  if (!dev.permissions || dev.permissions.length === 0) return null; // grandfathered (pre-#53)
  if (dev.permissions.includes(permission)) return null; // granted
  return c.json({ error: 'insufficient_scope', required: permission, granted: dev.permissions }, 403);
}
// Shared admin gate (reused by enroll + revoke + the PUT write path + every admin read). Returns a
// Response to short-circuit on failure, or null when authorized. TWO accepted credentials, checked in
// order (fire #131, O11/O12):
//   1. AID_ADMIN_TOKEN bearer — the fully-verifiable path, checked FIRST when a bearer is presented so the
//      CLI + the test suites keep their exact current behavior (no session lookup, no added latency).
//   2. Better Auth SESSION whose user email is in the AID_ADMIN_EMAILS allowlist — the forward path that
//      lets the browser dashboard authorize off the signed-in user instead of a pasted token. getSession
//      returns null for an unauthenticated request (verified against the Better Auth server API), so a
//      no-session browser request simply falls through. Its live ACCEPTANCE for a signed-in allowlisted
//      user is integration-gated on the OAuth callback registration (O04) — but the allowlist decision is
//      pure + unit-tested (scripts/test-admin-allowlist.sh) and the getSession call is reachable +
//      non-throwing on prod (a no-auth admin request returns 401, not 500).
// Neither method configured → honest 503; configured but unsatisfied → 401.
async function requireAdmin(c: any): Promise<Response | null> {
  const env = c.env as Record<string, any>;
  const configuredToken = env.AID_ADMIN_TOKEN as string | undefined;
  const allowlist = env.AID_ADMIN_EMAILS as string | undefined;
  const hdr = c.req.header('authorization') || '';
  const presented = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  // 1) AID_ADMIN_TOKEN bearer (fast path for CLI + tests — no session lookup when a bearer is presented).
  if (presented && configuredToken && safeEqual(presented, configuredToken)) return null;
  // 2) Better Auth session (allowlisted email) — runs for browser requests (session cookie, no bearer).
  if (allowlist) {
    const session = (await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)) as
      | { user?: { email?: string | null } }
      | null;
    if (isAllowedAdminEmail(session?.user?.email, allowlist)) return null;
  }
  // 3) Neither method configured → honest 503; otherwise unauthorized.
  if (!configuredToken && !allowlist) return c.json({ error: 'write_auth_not_configured' }, 503);
  return c.json({ error: 'unauthorized' }, 401);
}

// Enroll a device (admin-gated). Mints a device id + a one-time opaque token; stores only its hash.
app.post('/api/devices/enroll', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const body = (await c.req.json().catch(() => ({}))) as { tenant?: string; label?: string; permissions?: unknown[] };
    const tenant = (body.tenant || '_default').trim();
    if (!tenant) return c.json({ error: 'invalid_request', detail: 'tenant required' }, 400);
    const deviceId = 'dev_' + Date.now().toString(36) + '_' + randHex(6);
    const token = 'aid_' + randHex(32);
    const now = new Date().toISOString();
    const perms = JSON.stringify(Array.isArray(body.permissions) ? body.permissions.slice(0, 32).map(String) : []); // P05: admin enroll may grant a scope
    await db
      .prepare('INSERT INTO devices (device_id, tenant, token_sha256, label, permissions, created_at) VALUES (?,?,?,?,?,?)')
      .bind(deviceId, tenant, await sha256hex(token), body.label ?? null, perms, now)
      .run();
    return c.json({ deviceId, tenant, token, label: body.label ?? null, createdAt: now, note: 'store the token now — it is not recoverable' }, 201);
  } catch (e) {
    return c.json({ error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// List enrolled devices for a tenant (admin-gated, N03/N07/S04/S05 — the Machines inventory). Reuses
// the devices table; returns id/label/tenant/enrolled + revoked status so the operator sees the fleet
// and which machines are active. Exact path — distinct from /api/devices/me and /api/devices/pair/*.
// Shared devices + drift/freshness read (used by GET /api/devices AND /api/recommendations — ONE query,
// no duplication, A13). Each device carries its latest History event (lastSeen/kind/status), its last
// event that carried a revision, and a `drift` status vs the tenant's current desired revision (parsed
// best-effort from the stored blueprint — a missing/unparseable one leaves drift 'unknown', never errors).
async function listDevicesWithDrift(db: any, tenant: string, limit: number): Promise<{ currentRevision: string | null; items: any[] }> {
  const rs = await db
    .prepare(
      `SELECT d.device_id, d.tenant, d.label, d.permissions, d.created_at, d.revoked_at,
         (SELECT h.created_at FROM history h WHERE h.device_id = d.device_id ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS last_seen,
         (SELECT h.kind       FROM history h WHERE h.device_id = d.device_id ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS last_kind,
         (SELECT h.status     FROM history h WHERE h.device_id = d.device_id ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS last_status,
         (SELECT h.revision   FROM history h WHERE h.device_id = d.device_id AND h.revision IS NOT NULL ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS last_revision
       FROM devices d WHERE d.tenant = ? ORDER BY d.created_at DESC, d.device_id DESC LIMIT ?`,
    )
    .bind(tenant, limit)
    .all();
  let currentRevision: string | null = null;
  try {
    const bprow = await db.prepare('SELECT markdown FROM blueprints WHERE tenant = ?').bind(tenant).first();
    if (bprow && bprow.markdown) currentRevision = importMarkdown(bprow.markdown as string).revision ?? null;
  } catch {
    /* drift is best-effort; leave currentRevision null */
  }
  const items = (rs.results || []).map((r: any) => {
    let grantedPermissions: string[] = [];
    try {
      if (r.permissions) grantedPermissions = JSON.parse(r.permissions as string);
    } catch {
      /* legacy/unparseable scope → report none, never error the list */
    }
    const drift = r.last_revision && currentRevision ? (r.last_revision === currentRevision ? 'current' : 'drifted') : 'unknown';
    return {
      deviceId: r.device_id,
      tenant: r.tenant,
      label: r.label,
      grantedPermissions,
      enrolledAt: r.created_at,
      revoked: !!r.revoked_at,
      revokedAt: r.revoked_at || null,
      lastSeen: r.last_seen || null,
      lastKind: r.last_kind || null,
      lastStatus: r.last_status || null,
      lastRevision: r.last_revision || null,
      drift,
      // U11 — separate health dimensions (observed, not optimistic): connectivity from last-report
      // freshness, software from drift, backup honestly not_configured (J ⬜). Derived from the data
      // already loaded above — no extra query (A13 reuse). The dashboard + recommendations read this.
      health: {
        connectivity: !r.last_seen ? 'never' : Date.now() - Date.parse(r.last_seen as string) > 86400000 ? 'stale' : 'ok',
        software: drift,
        backup: 'not_configured',
      },
    };
  });
  return { currentRevision, items };
}

app.get('/api/devices', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const tenant = c.req.query('tenant') || '_default';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
  try {
    const { currentRevision, items } = await listDevicesWithDrift(db, tenant, limit);
    // N08/U15 (#138) — a fleet-health ROLLUP over the loaded inventory so the dashboard shows at-a-glance
    // health (not just per-row): ok/stale/neverReported PARTITION the total by connectivity freshness;
    // drifted + revoked are overlapping sub-counts. Observed state, computed from the already-loaded items
    // (A13 reuse — no extra query). "of the N loaded" when a large fleet exceeds the limit (honest).
    // #158 — the connectivity + drift partition is ACTIVE-scoped (revoked = decommissioned, EXCLUDED), matching
    // recommendations' `active = items.filter(d => !d.revoked)` so the two fleet surfaces AGREE and "ok" is not
    // inflated by dead devices (U15 observed-not-optimistic). total + revoked stay over all; active + revoked == total.
    const summary = { total: items.length, active: 0, ok: 0, stale: 0, neverReported: 0, drifted: 0, revoked: 0 };
    for (const it of items) {
      if (it.revoked) {
        summary.revoked++;
        continue; // decommissioned — excluded from the active-fleet connectivity/drift partition
      }
      summary.active++;
      const conn = it.health?.connectivity;
      if (conn === 'ok') summary.ok++;
      else if (conn === 'stale') summary.stale++;
      else summary.neverReported++;
      if (it.drift === 'drifted') summary.drifted++;
    }
    return c.json({ tenant, currentRevision, count: items.length, summary, items });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Deterministic Recommendations (N03/N08) — actionable RULE-BASED recs from OBSERVED device state
// (drift / never-reported / stale). No AI: the shared provider call (#7) will ENRICH these later;
// `generated:'rule-based'` labels that honestly. Admin-gated; reuses the devices+drift read.
app.get('/api/recommendations', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const tenant = c.req.query('tenant') || '_default';
  try {
    const { currentRevision, items } = await listDevicesWithDrift(db, tenant, 500);
    const names = (ds: any[]) => ds.map((d) => d.label || d.deviceId).join(', ');
    const active = items.filter((d) => !d.revoked);
    // U13 — DEDUPLICATE alerts: assign each flagged machine to its SINGLE most-severe issue so no machine is
    // alerted twice across cards (a failed apply is usually ALSO drifted; a stale host may ALSO be drifted).
    // Priority: failed > never-reported > drifted > stale. `claim` takes only machines not yet claimed by a
    // higher-severity bucket, so the cards partition the flagged fleet instead of overlapping.
    const seen = new Set<string>();
    const claim = (ds: any[]) =>
      ds.filter((d) => {
        if (seen.has(d.deviceId)) return false;
        seen.add(d.deviceId);
        return true;
      });
    const failed = claim(active.filter((d) => d.lastStatus === 'failed'));
    const never = claim(active.filter((d) => !d.lastSeen));
    const drifted = claim(active.filter((d) => d.drift === 'drifted'));
    const stale = claim(active.filter((d) => d.lastSeen && Date.now() - Date.parse(d.lastSeen) > 86400000));
    const recs: any[] = [];
    // Each rec carries a concrete repair `command` (U13 link-repair-actions) — the exact thing to run ON the
    // host (the server never pushes installs; device apply = 501 by design, so the repair is operator-run).
    if (failed.length)
      recs.push({ id: 'failed_last_run', severity: 'warning', title: `${failed.length} machine(s) whose last run FAILED`, detail: `Investigate the most recent failure, then re-apply on: ${names(failed)}`, action: 'investigate', command: 'aid up', devices: failed.map((d) => d.deviceId) });
    if (drifted.length)
      recs.push({ id: 'drifted', severity: 'warning', title: `${drifted.length} machine(s) behind the desired revision${currentRevision ? ` (${currentRevision})` : ''}`, detail: `Apply desired state on: ${names(drifted)}`, action: 'apply', command: 'aid up', devices: drifted.map((d) => d.deviceId) });
    if (never.length)
      recs.push({ id: 'never_reported', severity: 'warning', title: `${never.length} enrolled machine(s) have never reported`, detail: `Check connectivity, then pull + apply on: ${names(never)}`, action: 'connect', command: 'aid up', devices: never.map((d) => d.deviceId) });
    if (stale.length)
      recs.push({ id: 'stale', severity: 'info', title: `${stale.length} machine(s) haven't reported in over 24h`, detail: `Activity is stale on: ${names(stale)}`, action: 'check', command: 'aid report', devices: stale.map((d) => d.deviceId) });
    // Plan-health (#115) — interconnect the catalog `deprecated` (#112) into Recommendations: if the tenant's
    // DESIRED plan includes packages the maintainer flagged deprecated, surface it as an actionable rec here (the
    // 3rd surface after the App Store badge + the plan-review warning #114) so it shows on the "what needs
    // attention" dashboard. TENANT-scoped (devices:[], it affects every host that applies the plan); the fix is an
    // edit to the desired plan, not a host command. Reuses collectDeprecated on the stored blueprint.
    try {
      const bpRow = await db.prepare('SELECT markdown FROM blueprints WHERE tenant = ?').bind(tenant).first();
      if (bpRow?.markdown) {
        const dep = collectDeprecated(importMarkdown(bpRow.markdown));
        if (dep.length)
          recs.push({ id: 'plan_deprecated', severity: 'warning', title: `${dep.length} deprecated package(s) in the desired plan`, detail: `Replace in the plan — ${dep.map((x) => `${x.name} (${x.reason})`).join('; ')}`, action: 'edit-plan', command: '', devices: [] });
      }
    } catch {
      /* no/unreadable blueprint for this tenant → no plan-health rec (fine) */
    }
    if (!recs.length) {
      // U15 (#160) — empty-state HONESTY: active>0 → all-current; active==0 but the tenant HAS (revoked) machines
      // → say they're DECOMMISSIONED, not "never enrolled" (misleading when machines WERE enrolled then revoked,
      // pairs with #158 active-scoping); only a truly empty tenant (no device rows) is "No machines enrolled yet".
      const title = active.length
        ? 'All machines current and recently active'
        : items.length
          ? `No active machines (${items.length} decommissioned)`
          : 'No machines enrolled yet';
      const detail = active.length
        ? `${active.length} machine(s) at revision ${currentRevision || '—'}, all reporting.`
        : items.length
          ? `All ${items.length} enrolled machine(s) are revoked (decommissioned) — pair a new machine, or review the revoked list on /machines.`
          : 'Pair a machine to get started.';
      recs.push({ id: 'all_good', severity: 'ok', title, detail, action: 'none', command: '', devices: [] });
    }
    // distinctDeviceCount == unique flagged machines across every card (deduped). Lets the UI show the TRUE
    // blast radius instead of a misleading sum of per-category counts.
    const distinctDevices = [...seen];
    return c.json({ tenant, currentRevision, generated: 'rule-based', count: recs.length, distinctDeviceCount: distinctDevices.length, distinctDevices, recommendations: recs });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Device whoami — a device presents its own Bearer token; resolve to its identity (hash lookup,
// rejects unknown/revoked). The primitive later endpoints key per-tenant access on.
app.get('/api/devices/me', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const dev = await resolveDevice(db, c.req.header('authorization'));
    if (!dev) return c.json({ error: 'unauthorized' }, 401);
    return c.json({ deviceId: dev.deviceId, tenant: dev.tenant, label: dev.label, enrolledAt: dev.createdAt, grantedPermissions: dev.permissions });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Revoke a device (admin-gated, S27). Idempotent: already-revoked or unknown id → 404.
app.post('/api/devices/:id/revoke', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const id = c.req.param('id');
    const now = new Date().toISOString();
    const res = await db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL').bind(now, id).run();
    const changed = res.meta?.changes ?? 0;
    if (!changed) return c.json({ error: 'not_found_or_already_revoked', deviceId: id }, 404);
    return c.json({ deviceId: id, revokedAt: now });
  } catch (e) {
    return c.json({ error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// Support bundle (U12) — admin-scoped, SANITIZED, one-artifact diagnostic for a single device with an
// EXPLICIT `contents` + `excluded` manifest (U12 "sanitized support bundles with explicit content lists").
// Reuses the devices+drift read (which already excludes the token) + recent history, but ALLOWLISTS only
// safe fields and OMITS the device-reported `detail` blob (untrusted free-form). It never includes the
// device token (hashed-opaque — never stored in plaintext or returned), secret values/references, or
// terminal output (recordingMode: events-only). For operator support + the U-series diagnostics surface.
app.get('/api/devices/:id/support-bundle', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const tenant = c.req.query('tenant') || '_default';
  const id = c.req.param('id');
  try {
    const { currentRevision, items } = await listDevicesWithDrift(db, tenant, 500);
    const d = items.find((x) => x.deviceId === id);
    if (!d) return c.json({ error: 'not_found', deviceId: id, tenant }, 404);
    // Recent history — allowlist safe columns ONLY; the device-reported `detail` blob is deliberately
    // NOT selected (untrusted free-form that could carry sensitive strings) and no terminal output is
    // captured (events-only), so the bundle is sanitized by construction.
    const rs = await db
      .prepare('SELECT id, kind, status, revision, summary, created_at FROM history WHERE device_id = ? ORDER BY created_at DESC, id DESC LIMIT 20')
      .bind(id)
      .all();
    const recentHistory = (rs.results || []).map((r: any) => ({ id: r.id, kind: r.kind, status: r.status, revision: r.revision ?? null, summary: r.summary ?? null, createdAt: r.created_at }));
    return c.json({
      bundleVersion: 1,
      generatedAt: new Date().toISOString(),
      tenant,
      currentRevision,
      contents: ['device-identity', 'granted-scope', 'health', 'drift', 'recent-history (events-only; no detail blob)'],
      excluded: [
        'device token (hashed-opaque — never stored in plaintext or returned)',
        'secret values / references (Infisical / Bitwarden)',
        'raw device-reported detail blobs',
        'terminal output (recordingMode: events-only)',
      ],
      device: {
        deviceId: d.deviceId,
        tenant: d.tenant,
        label: d.label,
        grantedPermissions: d.grantedPermissions,
        enrolledAt: d.enrolledAt,
        revoked: d.revoked,
        revokedAt: d.revokedAt,
        lastSeen: d.lastSeen,
        lastKind: d.lastKind,
        lastStatus: d.lastStatus,
        lastRevision: d.lastRevision,
        drift: d.drift,
        health: d.health,
      },
      recentHistory,
      recordingMode: 'events-only',
    });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// --- Device-SCOPED environment access (fire #17) — the tenant is resolved FROM the device token, never
// the URL/body. A real machine authenticates with its OWN token to fetch its desired state + preview the
// reconciliation plan: no admin token, no tenant in the request. Completes the E2E loop (authenticate →
// fetch desired → preview) and closes the READ-unauthenticated gap for real tenants. ---
app.get('/api/device/current', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  const scoped = requireScope(c, dev, 'pull-desired-state');
  if (scoped) return scoped;
  try {
    const row = await db.prepare('SELECT markdown, updated_at FROM blueprints WHERE tenant = ?').bind(dev.tenant).first();
    if (!row) return c.json({ error: 'not_found', tenant: dev.tenant, deviceId: dev.deviceId }, 404);
    const bp = importMarkdown(row.markdown);
    return c.json({ tenant: dev.tenant, deviceId: dev.deviceId, revision: bp.revision, digest: await blueprintDigest(bp), updatedAt: row.updated_at, markdown: row.markdown });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
// Device-scoped RAW ENVIRONMENT.md (the §9 Export / Copy-setup surface) — a device fetches its desired
// blueprint as Markdown it writes to disk directly (no JSON decode needed on the machine).
app.get('/api/device/current.md', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  const scoped = requireScope(c, dev, 'pull-desired-state');
  if (scoped) return scoped;
  try {
    const row = await db.prepare('SELECT markdown FROM blueprints WHERE tenant = ?').bind(dev.tenant).first();
    if (!row) return c.json({ error: 'not_found', tenant: dev.tenant }, 404);
    return c.text(row.markdown, 200, { 'content-type': 'text/markdown; charset=utf-8' });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
app.post('/api/device/apply', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  const scoped = requireScope(c, dev, 'pull-desired-state');
  if (scoped) return scoped;
  let body: { observed?: unknown; dryRun?: boolean; expectedRevision?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_request', detail: 'body must be JSON' }, 400);
  }
  if (body.dryRun === false) {
    return c.json({ error: 'apply_not_implemented', applied: false, detail: 'real apply runs on the on-device supervisor (Phase B)' }, 501);
  }
  const result = await computeApplyPreview(db, dev.tenant, body.observed, body.expectedRevision);
  if (result.status === 200) result.body.deviceId = dev.deviceId;
  return c.json(result.body, result.status as any);
});

// --- History (S14 run registration, S15 searchable replay) — a device REPORTS each apply/run/check
// event (the "report result" half of the E2E loop); stored per-device + per-tenant in D1, listed
// newest-first. Device-scoped: a device records + reads its OWN history. Tenant-wide/admin views +
// diff/cost correlation are later slices. ---
const ReportRequest = z
  .object({
    kind: z.enum(['apply', 'run', 'enroll', 'check', 'other']).default('run'),
    status: z.enum(['success', 'failed', 'partial', 'preview']).default('success'),
    revision: z.string().max(200).optional(),
    summary: z.string().max(500).optional(),
    detail: z.unknown().optional(),
    // U03 — parent/child run correlation: one logical run (plan→apply→report, or a parent spawning children)
    // shares a correlationId; a child records its parentRunId. Both optional + bounded.
    correlationId: z.string().max(200).optional(),
    parentRunId: z.string().max(200).optional(),
  })
  .strict();
app.post('/api/device/report', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  const scoped = requireScope(c, dev, 'report-status');
  if (scoped) return scoped;
  // U14 — report payload QUOTA: `detail` is free-form (z.unknown()), so cap it so a single buggy/compromised
  // device can't bloat the history table (D1 10GB) or exhaust the isolate. Reject the whole body early when its
  // Content-Length is oversized (pre-parse, protects memory), then cap the serialized `detail` authoritatively.
  const MAX_BODY_BYTES = 32768;
  const MAX_DETAIL_BYTES = 16384;
  const contentLength = parseInt(c.req.header('content-length') || '0', 10);
  if (contentLength > MAX_BODY_BYTES) return c.json({ error: 'payload_too_large', scope: 'body', limitBytes: MAX_BODY_BYTES, actualBytes: contentLength }, 413);
  const parsed = ReportRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  const detailStr = parsed.data.detail === undefined ? null : JSON.stringify(parsed.data.detail);
  const detailBytes = detailStr === null ? 0 : new TextEncoder().encode(detailStr).length;
  if (detailBytes > MAX_DETAIL_BYTES) return c.json({ error: 'payload_too_large', scope: 'detail', limitBytes: MAX_DETAIL_BYTES, actualBytes: detailBytes }, 413);
  try {
    const id = 'hist_' + Date.now().toString(36) + '_' + randHex(6);
    const now = new Date().toISOString();
    const { kind, status, revision, summary, correlationId, parentRunId } = parsed.data;
    // Q08/U02 — redact known secret shapes from the free-form summary/detail BEFORE persisting to the
    // History table (defense-in-depth boundary backstop; a secret that slips into a reported event —
    // `--token=…`, an error echoing an API key — never lands plaintext in D1 / the admin /history view).
    const safeSummary = summary == null ? null : redactSecrets(summary);
    const safeDetail = detailStr == null ? null : redactSecrets(detailStr);
    await db
      .prepare('INSERT INTO history (id, device_id, tenant, kind, status, revision, summary, detail, created_at, correlation_id, parent_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, dev.deviceId, dev.tenant, kind, status, revision ?? null, safeSummary, safeDetail, now, correlationId ?? null, parentRunId ?? null)
      .run();
    return c.json({ id, deviceId: dev.deviceId, tenant: dev.tenant, kind, status, createdAt: now, correlationId: correlationId ?? null, parentRunId: parentRunId ?? null }, 201);
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
app.get('/api/device/history', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  const scoped = requireScope(c, dev, 'report-status');
  if (scoped) return scoped;
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  try {
    const rs = await db
      .prepare('SELECT id, kind, status, revision, summary, detail, created_at, correlation_id, parent_run_id FROM history WHERE device_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .bind(dev.deviceId, limit)
      .all();
    const items = (rs.results || []).map((r: any) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      revision: r.revision,
      summary: r.summary,
      detail: r.detail ? JSON.parse(r.detail) : null,
      createdAt: r.created_at,
      correlationId: r.correlation_id ?? null,
      parentRunId: r.parent_run_id ?? null,
    }));
    // U02 — honest recording fidelity: History stores STRUCTURED events, not captured terminal output.
    // The constant 'events-only' marks that gap (a future recorder will stamp 'full'/'redacted').
    return c.json({ deviceId: dev.deviceId, tenant: dev.tenant, recordingMode: 'events-only', count: items.length, items });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Tenant/admin HISTORY (S15) — the operator's FLEET replay: ALL devices' events for a tenant, newest
// first. Admin-gated (AID_ADMIN_TOKEN). Complements the device-scoped GET /api/device/history (one
// device's own runs); returns device_id so the operator sees WHICH machine reported.
app.get('/api/history', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const tenant = c.req.query('tenant') || '_default';
  const device = c.req.query('device') || '';
  const correlation = c.req.query('correlation') || '';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  try {
    // N09 unified timeline: optional `device=` scopes to one machine; U03 optional `correlation=` scopes to
    // one logical run's events (its parent/child tree). Both AND'd with tenant → no cross-tenant leak. One
    // parametrized query; the WHERE + binds are built together so they can't drift.
    const where = ['tenant = ?'];
    const binds: any[] = [tenant];
    if (device) {
      where.push('device_id = ?');
      binds.push(device);
    }
    if (correlation) {
      where.push('correlation_id = ?');
      binds.push(correlation);
    }
    const sql = `SELECT id, device_id, kind, status, revision, summary, detail, created_at, correlation_id, parent_run_id FROM history WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`;
    binds.push(limit);
    const rs = await db.prepare(sql).bind(...binds).all();
    const items = (rs.results || []).map((r: any) => ({
      id: r.id,
      deviceId: r.device_id,
      kind: r.kind,
      status: r.status,
      revision: r.revision,
      summary: r.summary,
      detail: r.detail ? JSON.parse(r.detail) : null,
      createdAt: r.created_at,
      correlationId: r.correlation_id ?? null,
      parentRunId: r.parent_run_id ?? null,
    }));
    return c.json({ tenant, device: device || null, correlation: correlation || null, recordingMode: 'events-only', count: items.length, items });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
// U14 RETENTION — admin, tenant-scoped history prune. `olderThanDays` is REQUIRED + explicit (NO silent
// retention policy baked in; the operator / THIS loop decides the window — e.g. a standing maintenance task
// calling olderThanDays=90). Deletes ONLY the named tenant's events older than the cutoff (no cross-tenant
// nuke). Returns the count actually removed (D1 `meta.changes`). `created_at` is an ISO-8601 string → a
// lexicographic `< cutoff` IS a correct time comparison (same toISOString() format everywhere).
app.post('/api/history/prune', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const tenant = c.req.query('tenant') || '_default';
  const raw = c.req.query('olderThanDays');
  if (raw === undefined || raw === '')
    return c.json({ error: 'olderThanDays_required', detail: 'specify an explicit retention window in days (>= 0)' }, 400);
  const olderThanDays = Number(raw);
  if (!Number.isInteger(olderThanDays) || olderThanDays < 0)
    return c.json({ error: 'invalid_olderThanDays', detail: 'must be a non-negative integer' }, 400);
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  try {
    const res = await db.prepare('DELETE FROM history WHERE tenant = ? AND created_at < ?').bind(tenant, cutoff).run();
    return c.json({ tenant, olderThanDays, cutoff, prunedCount: res.meta?.changes ?? 0 });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// --- Browser-first PAIRING (S04 one-link enrollment, MASTER-PROMPT §2) — a headless machine STARTs a
// pairing (no credentials yet: a short human `code` + a private poll-secret), a human APPROVES it in the
// browser (owner-authed), and the machine POLLs with its poll-secret to CLAIM a freshly-minted device
// token exactly once. The reusable device token is minted at claim + returned ONLY in the poll body —
// never in a URL or log; only hashes are stored. ---
const PAIR_TTL_MS = 10 * 60 * 1000;
const PairStartRequest = z
  .object({
    tenant: z.string().max(200).optional(),
    label: z.string().max(200).optional(),
    permissions: z.array(z.string().max(64)).max(32).optional(), // P03: capability scope the device requests
  })
  .strict();
app.post('/api/devices/pair/start', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const parsed = PairStartRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  try {
    const code = randHex(4).toUpperCase(); // 8 hex chars, human-typable
    const pollSecret = 'aidp_' + randHex(32);
    const tenant = (parsed.data.tenant || '_default').trim() || '_default';
    const nowMs = Date.now();
    const createdAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + PAIR_TTL_MS).toISOString();
    const permissions = JSON.stringify(parsed.data.permissions ?? []); // stored as a JSON array (P03)
    await db
      .prepare('INSERT INTO pairings (code, poll_sha256, tenant, label, permissions, status, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(code, await sha256hex(pollSecret), tenant, parsed.data.label ?? null, permissions, 'pending', createdAt, expiresAt)
      .run();
    return c.json(
      { code, pollSecret, tenant, verifyUrl: `${APP_URL}/pair?code=${code}`, expiresAt, note: 'show the code to the operator; keep pollSecret private (never in a URL/log)' },
      201,
    );
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
// Public pairing INFO (P03 — the approver MUST see WHAT they're approving before granting). Returns the
// machine's self-reported identity (label = its hostname) + tenant + status + expiry for a code. NO
// secrets (never the poll hash or any token). Visiting this does NOT approve — approval is the explicit
// admin-authed POST below ("visiting a URL doesn't approve it").
app.get('/api/devices/pair/info', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const code = (c.req.query('code') || '').trim().toUpperCase();
  if (!code) return c.json({ error: 'invalid_request', detail: 'code required' }, 400);
  const row = await db
    .prepare('SELECT code, tenant, label, permissions, status, created_at, expires_at FROM pairings WHERE code = ?')
    .bind(code)
    .first();
  if (!row) return c.json({ error: 'not_found', code }, 404);
  const expired = new Date(row.expires_at).getTime() < Date.now();
  let permissions: string[] = [];
  try {
    if (row.permissions) permissions = JSON.parse(row.permissions as string);
  } catch {
    /* tolerate a legacy/unparseable value — read as no declared scope */
  }
  return c.json({
    code: row.code,
    tenant: row.tenant,
    host: row.label || null,
    permissions,
    status: expired && row.status !== 'claimed' ? 'expired' : row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });
});
// Owner approves a pending pairing (the browser leg). Admin-gated — stands in for the owner session
// until Better Auth lands. Mints NO token (claim does), so no plaintext token is ever stored.
app.post('/api/devices/pair/approve', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const code = (body.code || '').trim().toUpperCase();
    if (!code) return c.json({ error: 'invalid_request', detail: 'code required' }, 400);
    const row = await db.prepare('SELECT status, expires_at FROM pairings WHERE code = ?').bind(code).first();
    if (!row) return c.json({ error: 'not_found', code }, 404);
    if (row.status === 'claimed') return c.json({ error: 'already_claimed', code }, 409);
    if (new Date(row.expires_at).getTime() < Date.now()) return c.json({ error: 'expired', code }, 410);
    await db.prepare("UPDATE pairings SET status='approved', approved_at=? WHERE code=? AND status='pending'").bind(new Date().toISOString(), code).run();
    return c.json({ code, status: 'approved' });
  } catch (e) {
    return c.json({ error: 'invalid_request', detail: e instanceof Error ? e.message : String(e) }, 400);
  }
});
// Machine polls with its poll-secret. pending → {status:pending}; approved → atomically CLAIM (mint a
// device + token, deliver once, mark claimed); already-claimed/expired → 410.
app.get('/api/devices/pair/poll', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const auth = c.req.header('authorization') || '';
  const pollSecret = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!pollSecret) return c.json({ error: 'unauthorized' }, 401);
  try {
    const pollHash = await sha256hex(pollSecret);
    const row = await db.prepare('SELECT code, tenant, label, permissions, status, expires_at FROM pairings WHERE poll_sha256 = ?').bind(pollHash).first();
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (row.status === 'claimed') return c.json({ error: 'already_claimed' }, 410);
    if (new Date(row.expires_at).getTime() < Date.now()) return c.json({ status: 'expired' }, 410);
    if (row.status !== 'approved') return c.json({ status: 'pending' });
    // approved → claim the slot atomically; only the winner mints + delivers the token
    const deviceId = 'dev_' + Date.now().toString(36) + '_' + randHex(6);
    const now = new Date().toISOString();
    const claim = await db
      .prepare("UPDATE pairings SET status='claimed', claimed_at=?, device_id=? WHERE poll_sha256=? AND status='approved'")
      .bind(now, deviceId, pollHash)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) return c.json({ error: 'already_claimed' }, 410);
    const token = 'aid_' + randHex(32);
    // P05: the device inherits the GRANTED scope from the pairing it was approved against.
    await db.prepare('INSERT INTO devices (device_id, tenant, token_sha256, label, permissions, created_at) VALUES (?,?,?,?,?,?)').bind(deviceId, row.tenant, await sha256hex(token), row.label ?? null, (row.permissions as string) || '[]', now).run();
    return c.json({ status: 'claimed', deviceId, tenant: row.tenant, token, note: 'store the token now — it is not recoverable' });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Inference attempt (POST). Fail-closed pre-flight gates (MASTER-PROMPT §8, §15), in order:
//   unknown alias → 404 · restricted → 451 (approved private/local route only, never the public
//   gateway) · provider not configured → 503 (keys stay backend-side) · all gates pass → 501
//   (provider call-path still pending — the next slice).
app.post('/api/ai/v1/:route', async (c) => {
  const route = c.req.param('route');
  if (!(ROUTES as readonly string[]).includes(route)) {
    return c.json({ error: 'unknown_route_alias', known: ROUTES }, 404);
  }
  if (route === 'restricted') {
    return c.json(
      { error: 'restricted_route', detail: 'restricted data must use an approved private/local route — never the public gateway', route },
      451,
    );
  }
  const env = Env.safeParse(c.env).data ?? {};
  const parsed = InferRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  // atomic cost reservation BEFORE any provider work (fail closed on over-ceiling / unknown pricing)
  const ceilingMicros = env.MAX_TASK_COST_MICROS ?? DEFAULT_CEILING_MICROS;
  const reservation = reserveBudget(parsed.data.estimateMicros, ceilingMicros);
  if (!reservation.ok) {
    return c.json({ error: 'budget', reason: reservation.reason, ceilingMicros, estimateMicros: parsed.data.estimateMicros, route }, 402);
  }
  if (!providerConfigured(env)) {
    return c.json(
      { error: 'provider_not_configured', detail: 'AID_INFERENCE_TOKEN + AI_GATEWAY_* + DEEPSEEK_API_KEY not set (keys stay backend-side)', route },
      503,
    );
  }
  return c.json(
    { error: 'not_implemented', detail: 'provider call-path pending — DeepSeek via one CF AI Gateway through ProjectSites', route },
    501,
  );
});

// Non-POST on a route alias → 405 (inference uses POST); unknown alias → 404.
app.all('/api/ai/v1/:route', (c) => {
  const route = c.req.param('route');
  if (!(ROUTES as readonly string[]).includes(route)) {
    return c.json({ error: 'unknown_route_alias', known: ROUTES }, 404);
  }
  return c.json({ error: 'method_not_allowed', detail: 'inference uses POST', route }, 405);
});

// --- Better Auth (O-series sign-in: GitHub + Google) — fire #102 ----------------------------------------
// Forward every /api/auth/* request to the Better Auth handler (its basePath defaults to /api/auth).
// This exposes sign-in/social, the OAuth callback, session, sign-out, etc. Authorize-INITIATION is live +
// verifiable now; sign-in COMPLETION still needs the callback URL registered on the OAuth apps (human step).
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

// Admin-guarded D1 schema migration for Better Auth (the CLI can't reach D1 — run programmatically).
// Creates the user/session/account/verification tables; idempotent (reports "no migrations needed" after).
app.post('/api/auth-migrate', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  try {
    const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
    if (toBeCreated.length === 0 && toBeAdded.length === 0) {
      return c.json({ message: 'no migrations needed', created: [], added: [] });
    }
    await runMigrations();
    return c.json({
      message: 'migrations completed',
      created: toBeCreated.map((t: any) => t.table),
      added: toBeAdded.map((t: any) => t.table),
    });
  } catch (e) {
    return c.json({ error: 'migration_failed', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
