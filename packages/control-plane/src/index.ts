import { Hono } from 'hono';
import { z } from 'zod';
// Reuse aid-core's route contract (don't re-implement — MASTER-PROMPT §8). Relative import so
// esbuild bundles the zero-dep contracts at deploy time; no workspace link needed.
import { ROUTES, chooseRoute, validateBlueprint, exportMarkdown, importMarkdown, blueprintDigest, aidProviderConfig, APP_URL, type Blueprint } from '../../aid-core/src/core';
import { Env, providerConfigured } from './env';
import { reserveBudget, DEFAULT_CEILING_MICROS } from './budget';
// App Store catalog — generated from software.yml by the canonical validated parser
// (scripts/gen-catalog.mjs → the cnf index builder; D01/D02/D13). Read-only, bundled at deploy;
// regenerate + redeploy when software.yml changes. No runtime YAML at the edge.
import catalogData from './catalog.json';
type CatalogEntry = { name: string; bin: string; providers: string[]; pkgs: Record<string, string>; platforms: string[] };
const CATALOG = catalogData as CatalogEntry[];
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

// Inference request body (Zod boundary) — estimated cost drives the budget reservation.
const InferRequest = z.object({ estimateMicros: z.number().int().nonnegative().default(0) }).passthrough();

const app = new Hono();

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
  '.cta2{display:inline-block;color:#00E5FF;border:1px solid #2a3147;padding:10px 16px;border-radius:8px;text-decoration:none;margin:4px 0}.cta2:hover{border-color:#00E5FF}' +
  'ol{padding-left:20px}ol li{margin:4px 0}' +
  '.rec{border-left:3px solid #2a3147}.rec-warning{border-left-color:#f0a020}.rec-info{border-left-color:#00E5FF}.rec-ok{border-left-color:#3fbf6f}';
function htmlPage(title: string, body: string): string {
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title><style>${PAGE_CSS}</style></head><body><div class=wrap>${body}</div></body></html>`;
}
app.get('/', (c) =>
  c.html(
    htmlPage(
      'aid · install.doctor',
      `<h1>aid <span class=muted>· install.doctor</span></h1>
<p>Set up and maintain any computer from one place — desktop, laptop, server, or headless box. Describe the environment once; make each authorized machine a verified, cooperating part of it.</p>
<p><a class=cta href="#setup">Set up a computer ↓</a><a class=cta2 href="/pair">Approve a pairing</a></p>

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

<p class=muted>Live dashboard: <a href="/machines">Machines</a> · <a href="/apps">App Store</a> · <a href="/recommendations">Recommendations</a> · <a href="/history">History</a> · API health <a href="/health">/health</a>. Automations in progress.</p>`,
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
      `<nav class=muted><a href="/">aid</a><a href="/machines">Machines</a><a href="/apps">App Store</a><a href="/recommendations">Recommendations</a><a href="/history">History</a></nav>
<h1>History <span class=muted>· fleet activity</span></h1>
<div class=card>
<p class=muted>Paste your admin token to load the fleet's reported events (apply / plan / report runs across devices).</p>
<p><input id=tenant placeholder="tenant (default _default)" style="width:46%"> <input id=tok type=password placeholder="AID_ADMIN_TOKEN" style="width:46%"></p>
<p><button onclick="load()">Load history</button></p></div>
<div id=out class=muted>No events loaded.</div>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
async function load(){
  var out=document.getElementById('out'),tok=document.getElementById('tok').value.trim(),t=document.getElementById('tenant').value.trim()||'_default';
  if(!tok){out.textContent='Enter the admin token.';return}
  out.textContent='Loading…';
  try{
    var r=await fetch('/api/history?tenant='+encodeURIComponent(t)+'&limit=50',{headers:{'authorization':'Bearer '+tok}});
    var j=await r.json();
    if(!r.ok){out.textContent='✗ '+(j.error||r.status);return}
    if(!j.items||!j.items.length){out.textContent='No events for '+esc(t)+'.';return}
    var rows=j.items.map(function(e){return '<tr><td>'+esc(e.createdAt)+'</td><td class=mono>'+esc(e.deviceId)+'</td><td>'+esc(e.kind)+'</td><td>'+esc(e.status)+'</td><td>'+esc(e.summary||'')+'</td></tr>'}).join('');
    out.innerHTML='<p class=muted>'+j.count+' events · tenant '+esc(t)+'</p><table><thead><tr><th>time</th><th>device</th><th>kind</th><th>status</th><th>summary</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }catch(e){out.textContent='✗ '+e}
}
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
      `<nav class=muted><a href="/">aid</a><a href="/machines">Machines</a><a href="/apps">App Store</a><a href="/recommendations">Recommendations</a><a href="/history">History</a></nav>
<h1>Machines <span class=muted>· device inventory</span></h1>
<div class=card>
<p class=muted>Paste your admin token to list the enrolled machines for a tenant (label · device id · enrolled · status).</p>
<p><input id=tenant placeholder="tenant (default _default)" style="width:46%"> <input id=tok type=password placeholder="AID_ADMIN_TOKEN" style="width:46%"></p>
<p><button onclick="load()">Load machines</button></p></div>
<div id=out class=muted>No machines loaded.</div>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function fmtAgo(iso){var t=Date.parse(iso);if(!iso||isNaN(t))return '';var s=Math.max(0,(Date.now()-t)/1000);if(s<60)return Math.floor(s)+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}
function lastActive(d){if(!d.lastSeen)return '<span class=muted>never reported</span>';var stale=(Date.now()-Date.parse(d.lastSeen))>86400000;return esc(d.lastKind||'event')+' · '+fmtAgo(d.lastSeen)+(stale?' <span class=tag>stale</span>':'');}
function driftCell(d,cur){if(d.drift==='drifted')return '<span class=tag>drifted</span> '+esc(d.lastRevision)+'→'+esc(cur||'?');if(d.drift==='current')return '<span class=muted>up to date ('+esc(cur)+')</span>';return '<span class=muted>—</span>';}
async function load(){
  var out=document.getElementById('out'),tok=document.getElementById('tok').value.trim(),t=document.getElementById('tenant').value.trim()||'_default';
  if(!tok){out.textContent='Enter the admin token.';return}
  out.textContent='Loading…';
  try{
    var r=await fetch('/api/devices?tenant='+encodeURIComponent(t)+'&limit=200',{headers:{'authorization':'Bearer '+tok}});
    var j=await r.json();
    if(!r.ok){out.textContent='✗ '+(j.error||r.status);return}
    if(!j.items||!j.items.length){out.textContent='No machines enrolled for '+esc(t)+'.';return}
    var rows=j.items.map(function(d){return '<tr><td>'+esc(d.label||'—')+'</td><td class=mono>'+esc(d.deviceId)+'</td><td>'+esc(d.tenant)+'</td><td>'+esc(d.enrolledAt)+'</td><td>'+lastActive(d)+'</td><td>'+driftCell(d,j.currentRevision)+'</td><td>'+(d.revoked?'<span class=tag>revoked</span>':'active')+'</td></tr>'}).join('');
    out.innerHTML='<p class=muted>'+j.count+' machines · tenant '+esc(t)+' · desired revision '+esc(j.currentRevision||'—')+' · drift = last-applied vs desired</p><table><thead><tr><th>label</th><th>device</th><th>tenant</th><th>enrolled</th><th>last active</th><th>drift</th><th>status</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }catch(e){out.textContent='✗ '+e}
}
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
      `<nav class=muted><a href="/">aid</a><a href="/machines">Machines</a><a href="/apps">App Store</a><a href="/recommendations">Recommendations</a><a href="/history">History</a></nav>
<h1>App Store <span class=muted>· installable catalog</span></h1>
<div class=card>
<p class=muted>Everything Install Doctor can install, from the software.yml catalog. Search by name or command; each shows its package managers + platforms.</p>
<p><input id=q placeholder="Search apps + CLIs (e.g. ripgrep, docker, node)…" style="width:100%" oninput="debounced()"></p></div>
<div id=out class=muted>Loading catalog…</div>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function pill(a){return (a||[]).map(function(x){return '<span class=tag>'+esc(x)+'</span>'}).join(' ')}
async function detail(tr,name){
  var ex=tr.nextElementSibling;
  if(ex&&ex.className==='detail'){ex.remove();return}            // toggle closed
  var dr=document.createElement('tr');dr.className='detail';
  dr.innerHTML='<td colspan=4 class=muted>Loading install commands…</td>';
  tr.parentNode.insertBefore(dr,tr.nextSibling);
  try{
    var r=await fetch('/api/catalog/'+encodeURIComponent(name));var j=await r.json();
    if(!r.ok||!j.commands||!j.commands.length){dr.firstChild.textContent='No install commands.';return}
    var cmds=j.commands.map(function(k){return '<span class=cmd><b>'+esc(k.provider)+'</b>'+esc(k.command)+'</span>'}).join('');
    dr.firstChild.innerHTML='<div class=muted style="margin:2px 0 6px">Install <b>'+esc(j.name)+'</b> (command: '+esc(j.bin)+') on '+pill(j.platforms)+':</div>'+cmds;
  }catch(e){dr.firstChild.textContent='✗ '+e}
}
async function load(){
  var out=document.getElementById('out'),q=document.getElementById('q').value.trim();
  try{
    var r=await fetch('/api/catalog?limit=60'+(q?('&q='+encodeURIComponent(q)):''));
    var j=await r.json();
    if(!r.ok){out.textContent='✗ '+(j.error||r.status);return}
    if(!j.items||!j.items.length){out.textContent='No apps match "'+esc(q)+'".';return}
    var rows=j.items.map(function(e){return '<tr><td><button class=lnk data-name="'+esc(e.name)+'">'+esc(e.name)+'</button></td><td class=mono>'+esc(e.bin)+'</td><td>'+pill(e.providers)+'</td><td>'+pill(e.platforms)+'</td></tr>'}).join('');
    out.innerHTML='<p class=muted>'+j.matched+' of '+j.total+' apps'+(j.count<j.matched?(' · showing '+j.count):'')+' · click a name for install commands</p><table><thead><tr><th>name</th><th>command</th><th>installers</th><th>platforms</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }catch(e){out.textContent='✗ '+e}
}
document.getElementById('out').addEventListener('click',function(ev){
  var b=ev.target.closest('.lnk');if(!b)return;
  detail(b.closest('tr'),b.getAttribute('data-name'));
});
var t;function debounced(){clearTimeout(t);t=setTimeout(load,160)}
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
      `<nav class=muted><a href="/">aid</a><a href="/machines">Machines</a><a href="/apps">App Store</a><a href="/recommendations">Recommendations</a><a href="/history">History</a></nav>
<h1>Recommendations <span class=muted>· what to do next</span></h1>
<div class=card>
<p class=muted>Paste your admin token for actionable, rule-based recommendations from your fleet's observed state (drift · never-reported · stale). AI enrichment is pending the provider connection.</p>
<p><input id=tenant placeholder="tenant (default _default)" style="width:46%"> <input id=tok type=password placeholder="AID_ADMIN_TOKEN" style="width:46%"></p>
<p><button onclick="load()">Load recommendations</button></p></div>
<div id=out class=muted>No recommendations loaded.</div>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
async function load(){
  var out=document.getElementById('out'),tok=document.getElementById('tok').value.trim(),t=document.getElementById('tenant').value.trim()||'_default';
  if(!tok){out.textContent='Enter the admin token.';return}
  out.textContent='Loading…';
  try{
    var r=await fetch('/api/recommendations?tenant='+encodeURIComponent(t),{headers:{'authorization':'Bearer '+tok}});
    var j=await r.json();
    if(!r.ok){out.textContent='✗ '+(j.error||r.status);return}
    var cards=(j.recommendations||[]).map(function(k){return '<div class="card rec rec-'+esc(k.severity)+'"><h3>'+esc(k.title)+'</h3><p class=muted>'+esc(k.detail)+'</p></div>'}).join('');
    out.innerHTML='<p class=muted>'+j.count+' recommendation(s) · tenant '+esc(t)+' · <span class=tag>'+esc(j.generated)+'</span> · desired revision '+esc(j.currentRevision||'—')+'</p>'+cards;
  }catch(e){out.textContent='✗ '+e}
}
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
<p><button onclick="approve()">Approve pairing</button></p>
<p id=out class=muted></p></div>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var CODE=${JSON.stringify(code)};
async function loadInfo(){
  if(!CODE)return;var el=document.getElementById('info');if(!el)return;
  try{
    var r=await fetch('/api/devices/pair/info?code='+encodeURIComponent(CODE));var j=await r.json();
    if(!r.ok){el.innerHTML='<p class=muted>✗ '+esc(j.error||r.status)+' — no pending pairing for this code.</p>';return}
    var warn=(j.status==='expired')?' <span class=tag>expired</span>':(j.status==='claimed'?' <span class=tag>already claimed</span>':'');
    var perms=(j.permissions&&j.permissions.length)?'<p><b>Requesting:</b> '+j.permissions.map(function(p){return '<span class=tag>'+esc(p)+'</span>'}).join(' ')+'</p>':'<p class=muted><b>Requesting:</b> standard device access (no elevated scope declared)</p>';
    el.innerHTML='<h3>You are approving'+warn+'</h3><p><b>Host:</b> <span class=mono>'+esc(j.host||'(unnamed machine)')+'</span></p><p><b>Tenant:</b> '+esc(j.tenant)+'</p>'+perms+'<p class=muted>Approving enrolls this machine as a device in that tenant and mints a revocable, device-scoped token — never a reusable secret in any URL. Only approve a code you started yourself.</p>';
  }catch(e){el.innerHTML='<p class=muted>✗ '+esc(e)+'</p>'}
}
async function approve(){
  var out=document.getElementById('out'),tok=document.getElementById('tok').value.trim();
  if(!tok){out.textContent='Enter the admin token.';return}
  out.textContent='Approving…';
  try{
    var r=await fetch('/api/devices/pair/approve',{method:'POST',headers:{'authorization':'Bearer '+tok,'content-type':'application/json'},body:JSON.stringify({code:CODE})});
    var j=await r.json();
    out.textContent=r.ok?'✓ approved — the machine will claim its token shortly.':('✗ '+(j.error||r.status));
  }catch(e){out.textContent='✗ '+e}
}
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
// software.yml via the validated parser. `?q=` filters by name OR binary (case-insensitive substring);
// `?limit=` caps rows (1..200, default 50). No secrets, no tenant data — browseable signed-out (M11).
app.get('/api/catalog', (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  const matched = q
    ? CATALOG.filter((e) => e.name.toLowerCase().includes(q) || e.bin.toLowerCase().includes(q))
    : CATALOG;
  return c.json({
    total: CATALOG.length,
    matched: matched.length,
    count: Math.min(matched.length, limit),
    q: q || null,
    items: matched.slice(0, limit),
  });
});

// App Store per-item DETAIL (R13/R01) — the exact per-manager install command for one catalog entry,
// built from the SAME provider→command templates the cnf executor uses (D04). PUBLIC, read-only.
app.get('/api/catalog/:name', (c) => {
  const name = c.req.param('name');
  const e = CATALOG.find((x) => x.name === name);
  if (!e) return c.json({ error: 'not_found' }, 404);
  const pkgs = e.pkgs || {};
  const commands = (e.providers || [])
    .filter((p) => INSTALL_CMD[p] && pkgs[p])
    .map((p) => ({ provider: p, pkg: pkgs[p], command: INSTALL_CMD[p](pkgs[p]) }));
  return c.json({ name: e.name, bin: e.bin, platforms: e.platforms, providers: e.providers, commands });
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
    return c.json({ tenant, revision: bp.revision, digest: await blueprintDigest(bp), updatedAt: row.updated_at, markdown: row.markdown });
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
  let body: { tenant?: string; observed?: unknown; dryRun?: boolean };
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
  const result = await computeApplyPreview(db, body.tenant || '_default', body.observed);
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
): Promise<{ deviceId: string; tenant: string; label: string | null; createdAt: string } | null> {
  const token = (authHeader || '').startsWith('Bearer ') ? (authHeader as string).slice(7) : '';
  if (!token) return null;
  const row = await db
    .prepare('SELECT device_id, tenant, label, created_at, revoked_at FROM devices WHERE token_sha256 = ?')
    .bind(await sha256hex(token))
    .first();
  if (!row || row.revoked_at) return null;
  return { deviceId: row.device_id, tenant: row.tenant, label: row.label, createdAt: row.created_at };
}
// Shared admin-bearer gate (reused by enroll + revoke + the PUT write path's pattern). Returns a
// Response to short-circuit on failure, or null when authorized.
function requireAdmin(c: any): Response | null {
  const configured = (c.env as Record<string, any>).AID_ADMIN_TOKEN as string | undefined;
  if (!configured) return c.json({ error: 'write_auth_not_configured' }, 503);
  const auth = c.req.header('authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!presented || !safeEqual(presented, configured)) return c.json({ error: 'unauthorized' }, 401);
  return null;
}

// Enroll a device (admin-gated). Mints a device id + a one-time opaque token; stores only its hash.
app.post('/api/devices/enroll', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  try {
    const body = (await c.req.json().catch(() => ({}))) as { tenant?: string; label?: string };
    const tenant = (body.tenant || '_default').trim();
    if (!tenant) return c.json({ error: 'invalid_request', detail: 'tenant required' }, 400);
    const deviceId = 'dev_' + Date.now().toString(36) + '_' + randHex(6);
    const token = 'aid_' + randHex(32);
    const now = new Date().toISOString();
    await db
      .prepare('INSERT INTO devices (device_id, tenant, token_sha256, label, created_at) VALUES (?,?,?,?,?)')
      .bind(deviceId, tenant, await sha256hex(token), body.label ?? null, now)
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
      `SELECT d.device_id, d.tenant, d.label, d.created_at, d.revoked_at,
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
  const items = (rs.results || []).map((r: any) => ({
    deviceId: r.device_id,
    tenant: r.tenant,
    label: r.label,
    enrolledAt: r.created_at,
    revoked: !!r.revoked_at,
    revokedAt: r.revoked_at || null,
    lastSeen: r.last_seen || null,
    lastKind: r.last_kind || null,
    lastStatus: r.last_status || null,
    lastRevision: r.last_revision || null,
    drift: r.last_revision && currentRevision ? (r.last_revision === currentRevision ? 'current' : 'drifted') : 'unknown',
  }));
  return { currentRevision, items };
}

app.get('/api/devices', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const tenant = c.req.query('tenant') || '_default';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
  try {
    const { currentRevision, items } = await listDevicesWithDrift(db, tenant, limit);
    return c.json({ tenant, currentRevision, count: items.length, items });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Deterministic Recommendations (N03/N08) — actionable RULE-BASED recs from OBSERVED device state
// (drift / never-reported / stale). No AI: the shared provider call (#7) will ENRICH these later;
// `generated:'rule-based'` labels that honestly. Admin-gated; reuses the devices+drift read.
app.get('/api/recommendations', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const tenant = c.req.query('tenant') || '_default';
  try {
    const { currentRevision, items } = await listDevicesWithDrift(db, tenant, 500);
    const names = (ds: any[]) => ds.map((d) => d.label || d.deviceId).join(', ');
    const active = items.filter((d) => !d.revoked);
    const drifted = active.filter((d) => d.drift === 'drifted');
    const never = active.filter((d) => !d.lastSeen);
    const stale = active.filter((d) => d.lastSeen && Date.now() - Date.parse(d.lastSeen) > 86400000);
    const recs: any[] = [];
    if (drifted.length)
      recs.push({ id: 'drifted', severity: 'warning', title: `${drifted.length} machine(s) behind the desired revision${currentRevision ? ` (${currentRevision})` : ''}`, detail: `Apply desired state (\`aid up\`) on: ${names(drifted)}`, action: 'apply', devices: drifted.map((d) => d.deviceId) });
    if (never.length)
      recs.push({ id: 'never_reported', severity: 'warning', title: `${never.length} enrolled machine(s) have never reported`, detail: `Check connectivity / run \`aid up\` on: ${names(never)}`, action: 'connect', devices: never.map((d) => d.deviceId) });
    if (stale.length)
      recs.push({ id: 'stale', severity: 'info', title: `${stale.length} machine(s) haven't reported in over 24h`, detail: `Activity is stale on: ${names(stale)}`, action: 'check', devices: stale.map((d) => d.deviceId) });
    if (!recs.length)
      recs.push({ id: 'all_good', severity: 'ok', title: active.length ? 'All machines current and recently active' : 'No machines enrolled yet', detail: active.length ? `${active.length} machine(s) at revision ${currentRevision || '—'}, all reporting.` : 'Pair a machine to get started.', action: 'none', devices: [] });
    return c.json({ tenant, currentRevision, generated: 'rule-based', count: recs.length, recommendations: recs });
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
    return c.json({ deviceId: dev.deviceId, tenant: dev.tenant, label: dev.label, enrolledAt: dev.createdAt });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Revoke a device (admin-gated, S27). Idempotent: already-revoked or unknown id → 404.
app.post('/api/devices/:id/revoke', async (c) => {
  const denied = requireAdmin(c);
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

// --- Device-SCOPED environment access (fire #17) — the tenant is resolved FROM the device token, never
// the URL/body. A real machine authenticates with its OWN token to fetch its desired state + preview the
// reconciliation plan: no admin token, no tenant in the request. Completes the E2E loop (authenticate →
// fetch desired → preview) and closes the READ-unauthenticated gap for real tenants. ---
app.get('/api/device/current', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
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
  let body: { observed?: unknown; dryRun?: boolean };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_request', detail: 'body must be JSON' }, 400);
  }
  if (body.dryRun === false) {
    return c.json({ error: 'apply_not_implemented', applied: false, detail: 'real apply runs on the on-device supervisor (Phase B)' }, 501);
  }
  const result = await computeApplyPreview(db, dev.tenant, body.observed);
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
  })
  .strict();
app.post('/api/device/report', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  const parsed = ReportRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  try {
    const id = 'hist_' + Date.now().toString(36) + '_' + randHex(6);
    const now = new Date().toISOString();
    const { kind, status, revision, summary, detail } = parsed.data;
    await db
      .prepare('INSERT INTO history (id, device_id, tenant, kind, status, revision, summary, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, dev.deviceId, dev.tenant, kind, status, revision ?? null, summary ?? null, detail === undefined ? null : JSON.stringify(detail), now)
      .run();
    return c.json({ id, deviceId: dev.deviceId, tenant: dev.tenant, kind, status, createdAt: now }, 201);
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});
app.get('/api/device/history', async (c) => {
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const dev = await resolveDevice(db, c.req.header('authorization'));
  if (!dev) return c.json({ error: 'unauthorized' }, 401);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  try {
    const rs = await db
      .prepare('SELECT id, kind, status, revision, summary, detail, created_at FROM history WHERE device_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
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
    }));
    return c.json({ deviceId: dev.deviceId, tenant: dev.tenant, count: items.length, items });
  } catch (e) {
    return c.json({ error: 'store_error', detail: e instanceof Error ? e.message : String(e) }, 503);
  }
});

// Tenant/admin HISTORY (S15) — the operator's FLEET replay: ALL devices' events for a tenant, newest
// first. Admin-gated (AID_ADMIN_TOKEN). Complements the device-scoped GET /api/device/history (one
// device's own runs); returns device_id so the operator sees WHICH machine reported.
app.get('/api/history', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const db = (c.env as Record<string, any>).DB;
  if (!db) return c.json({ error: 'store_unavailable' }, 503);
  const tenant = c.req.query('tenant') || '_default';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  try {
    const rs = await db
      .prepare('SELECT id, device_id, kind, status, revision, summary, detail, created_at FROM history WHERE tenant = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .bind(tenant, limit)
      .all();
    const items = (rs.results || []).map((r: any) => ({
      id: r.id,
      deviceId: r.device_id,
      kind: r.kind,
      status: r.status,
      revision: r.revision,
      summary: r.summary,
      detail: r.detail ? JSON.parse(r.detail) : null,
      createdAt: r.created_at,
    }));
    return c.json({ tenant, count: items.length, items });
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
  const denied = requireAdmin(c);
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
    const row = await db.prepare('SELECT code, tenant, label, status, expires_at FROM pairings WHERE poll_sha256 = ?').bind(pollHash).first();
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
    await db.prepare('INSERT INTO devices (device_id, tenant, token_sha256, label, created_at) VALUES (?,?,?,?,?)').bind(deviceId, row.tenant, await sha256hex(token), row.label ?? null, now).run();
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

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
