#!/usr/bin/env bash
# Phase-A control-plane skeleton gate.
#   build gate : `wrangler deploy --dry-run` bundles the Hono Worker (fails if src/imports break).
#   prod  gate : if CONTROL_PLANE_URL is set, assert the live skeleton — /health 200 {status:ok},
#                /api/ai/v1/<known-route> 501 (provider wiring pending), /api/ai/v1/<bogus> 404.
# The Worker imports aid-core's route contracts (ROUTES/chooseRoute) by relative path so
# esbuild bundles them — no workspace link needed. See docs/aid/MASTER-PROMPT.md §2,§8,§17.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CP="$ROOT/packages/control-plane"

say(){  command -v gum >/dev/null 2>&1 && gum style --foreground 51  -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass(){ command -v gum >/dev/null 2>&1 && gum style --foreground 46  -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P+1)); }
fail(){ command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F+1)); }
skip(){ command -v gum >/dev/null 2>&1 && gum style --foreground 214 -- "SKIP $*" || printf '\033[1;33mSKIP\033[0m %s\n' "$*"; }
P=0; F=0

say "control-plane skeleton"

if [ ! -f "$CP/wrangler.toml" ] || [ ! -f "$CP/src/index.ts" ]; then
  fail "control-plane not scaffolded (packages/control-plane/{wrangler.toml,src/index.ts})"
else
  pass "control-plane scaffolded"
  # build gate: dry-run bundles the Worker (needs hono installed + wrangler available via npx)
  if ( cd "$CP" && npx --yes wrangler deploy --dry-run --outdir /tmp/cp-dist ) >/tmp/cp-build.log 2>&1; then
    pass "wrangler dry-run build OK"
  else
    fail "wrangler dry-run build failed (see /tmp/cp-build.log)"; tail -5 /tmp/cp-build.log 2>/dev/null
  fi
fi

if [ -n "${CONTROL_PLANE_URL:-}" ]; then
  u="${CONTROL_PLANE_URL%/}"
  code="$(curl -fsS -o /tmp/cp-health.json -w '%{http_code}' "$u/health" 2>/dev/null || echo 000)"
  if [ "$code" = 200 ] && grep -q '"status":"ok"' /tmp/cp-health.json 2>/dev/null; then pass "GET /health 200 {status:ok}"; else fail "GET /health -> $code"; fi
  # browser surface (fire: app.install.doctor availability) — landing + pairing-approval page
  land="$(curl -s "$u/" 2>/dev/null)"
  { echo "$land" | grep -q 'install.doctor' && echo "$land" | grep -qi 'aid-pair'; } && pass "GET / -> landing page (aid + pairing instructions)" || fail "landing -> $(printf '%s' "$land" | head -c 80)"
  { echo "$land" | grep -qi 'set up and maintain' && echo "$land" | grep -qi 'headless' && echo "$land" | grep -qi 'first time you run' && echo "$land" | grep -qi 'Set up a computer'; } && pass "GET / -> onboarding content (promise + desktop/headless paths + on-demand CLIs + primary CTA — M2/M3/M5/M7)" || fail "landing onboarding content -> $(printf '%s' "$land" | head -c 140)"
  pairp="$(curl -s "$u/pair?code=ABC12345" 2>/dev/null)"
  { echo "$pairp" | grep -q 'ABC12345' && echo "$pairp" | grep -qi 'approve pairing' && echo "$pairp" | grep -qi 'You are approving' && echo "$pairp" | grep -qi 'Requesting'; } && pass "GET /pair?code -> shows code + device identity + requested permissions + approve surface (P03)" || fail "pair page -> $(printf '%s' "$pairp" | head -c 80)"
  # P03: the approval surface must show WHAT is approved — start a pairing (public) then fetch its info.
  pst="$(curl -s -X POST -H 'content-type: application/json' -d '{"tenant":"_test","label":"p03-probe-host","permissions":["pull-desired-state","report-status"]}' "$u/api/devices/pair/start" 2>/dev/null)"
  pcode="$(printf '%s' "$pst" | jq -r '.code // empty')"
  if [ -n "$pcode" ]; then
    pinfo="$(curl -s "$u/api/devices/pair/info?code=$pcode" 2>/dev/null)"
    echo "$pinfo" | jq -e --arg c "$pcode" '.code==$c and .host=="p03-probe-host" and .tenant=="_test" and .status=="pending" and (.permissions==["pull-desired-state","report-status"])' >/dev/null 2>&1 && pass "GET /api/devices/pair/info -> host identity + tenant + status + REQUESTED PERMISSIONS (P03 fuller)" || fail "pair info -> $(printf '%s' "$pinfo" | head -c 160)"
    echo "$pinfo" | jq -e '(has("poll_sha256")|not) and (has("pollSecret")|not) and (has("token")|not)' >/dev/null 2>&1 && pass "pair/info leaks NO poll secret or token" || fail "pair/info leaked a secret field -> $(printf '%s' "$pinfo" | head -c 140)"
  else
    fail "pair/start -> no code ($(printf '%s' "$pst" | head -c 100))"
  fi
  pib="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/devices/pair/info?code=ZZBOGUS99" 2>/dev/null || echo 000)"
  [ "$pib" = 404 ] && pass "GET /api/devices/pair/info?code=<bogus> -> 404" || fail "pair info bogus -> $pib (want 404)"
  pc="$(curl -s "$u/api/provider-config" 2>/dev/null)"
  echo "$pc" | jq -e '(.enabled_providers[0]=="install-doctor") and (.provider["install-doctor"].options.baseURL|test("/api/ai/v1$")) and (.provider["install-doctor"].options.apiKey=="{env:AID_INFERENCE_TOKEN}")' >/dev/null 2>&1 && pass "GET /api/provider-config -> OpenCode config (install-doctor provider, {env} apiKey — no secret)" || fail "provider-config -> $(printf '%s' "$pc" | head -c 140)"
  hp="$(curl -s "$u/history" 2>/dev/null)"
  { echo "$hp" | grep -qi 'fleet activity' && echo "$hp" | grep -q 'AID_ADMIN_TOKEN' && echo "$hp" | grep -qi 'Load history' && echo "$hp" | grep -qiE 'events only|no terminal'; } && pass "GET /history -> fleet dashboard page + honest recording note (U02)" || fail "history page -> $(printf '%s' "$hp" | head -c 80)"
  # fire #91 — U03 fleet UI: the /history page surfaces a correlation "run" column + wires the built-but-UI-only
  # ?correlation= filter (click a run → only its correlated events), consistent with the /machines timeline (#90).
  { echo "$hp" | grep -q '<th>run</th>' && echo "$hp" | grep -q '&correlation=' && echo "$hp" | grep -q 'e.correlationId' && echo "$hp" | grep -qi 'clear filter'; } && pass "GET /history -> correlation run column + clickable ?correlation= filter (U03 fleet UI; wires the built filter)" || fail "history run-filter -> $(printf '%s' "$hp" | grep -oE '<th>run</th>|&correlation=|clear filter' | sort -u | tr '\n' ' ')"
  mp="$(curl -s "$u/machines" 2>/dev/null)"
  { echo "$mp" | grep -qi 'device inventory' && echo "$mp" | grep -q 'AID_ADMIN_TOKEN' && echo "$mp" | grep -qi 'Load machines' && echo "$mp" | grep -qi 'last active' && echo "$mp" | grep -qi 'drift' && echo "$mp" | grep -qi 'scope' && echo "$mp" | grep -qi 'health'; } && pass "GET /machines -> device-inventory dashboard w/ last-active + drift + scope + health columns (N08/U15/P05/U11)" || fail "machines page -> $(printf '%s' "$mp" | head -c 80)"
  # fire #64 — each device row opens a detail view (identity + health + scope + drift + its /api/history timeline, N09 UI half).
  { echo "$mp" | grep -q 'function detail(' && echo "$mp" | grep -q '/api/history?tenant=' && echo "$mp" | grep -q 'id=detail' && echo "$mp" | grep -q 'onclick="detail('; } && pass "GET /machines -> device rows open a detail view w/ unified timeline (/api/history?device=, N09)" || fail "machines detail wiring -> $(printf '%s' "$mp" | grep -oE 'detail\(|/api/history|id=detail' | sort -u | tr '\n' ' ')"
  # fire #83 — the U12 support-bundle endpoint is SURFACED in the device-detail view (interconnectedness): a
  # "Support bundle" button fetches /api/devices/:id/support-bundle, shows the sanitized contents/excluded
  # manifest, and offers a Download-JSON. Makes the #82 endpoint reachable + judgeable from the frontend.
  { echo "$mp" | grep -q 'function bundle(' && echo "$mp" | grep -q '/support-bundle' && echo "$mp" | grep -qi 'Support bundle' && echo "$mp" | grep -q 'onclick="bundle(' && echo "$mp" | grep -qi 'Download JSON'; } && pass "GET /machines -> device detail surfaces the U12 support bundle (view sanitized manifest + download JSON; interconnectedness)" || fail "machines support-bundle wiring -> $(printf '%s' "$mp" | grep -oE 'bundle\(|/support-bundle|Download JSON' | sort -u | tr '\n' ' ')"
  # fire #90 — U03 UI: the device-detail timeline surfaces the correlation "run" column (correlationId short
  # badge + ↳ child-of-parent indicator), so an operator SEES which events belong to one `aid up` run.
  { echo "$mp" | grep -q '<th>run</th>' && echo "$mp" | grep -q 'e.correlationId' && echo "$mp" | grep -q 'child of'; } && pass "GET /machines -> device-detail timeline surfaces the U03 correlation run column (correlationId + child-of parent; interconnectedness closes U03)" || fail "machines run-column -> $(printf '%s' "$mp" | grep -oE '<th>run</th>|e.correlationId|child of' | sort -u | tr '\n' ' ')"
  # fire #66 — admin token persists in sessionStorage (enter once; prefill + auto-save + forget), shared across every dashboard page via htmlPage.
  { echo "$mp" | grep -q 'sessionStorage' && echo "$mp" | grep -q 'aidAdminToken' && echo "$mp" | grep -qi 'forget'; } && pass "GET /machines -> admin token persists via sessionStorage (prefill + save + forget; embarrassingly-easy)" || fail "machines token-persist -> $(printf '%s' "$mp" | grep -oE 'sessionStorage|aidAdminToken|forget' | sort -u | tr '\n' ' ')"
  recp="$(curl -s "$u/recommendations" 2>/dev/null)"
  { echo "$recp" | grep -qi 'what to do next' && echo "$recp" | grep -q 'AID_ADMIN_TOKEN' && echo "$recp" | grep -qi 'Load recommendations'; } && pass "GET /recommendations -> rule-based recs dashboard page (N03)" || fail "recommendations page -> $(printf '%s' "$recp" | head -c 80)"
  # fire #67 — deep-link: each flagged device in a rec links to /machines?device=, and /machines auto-opens that device's detail.
  echo "$recp" | grep -q '/machines?device=' && pass "GET /recommendations -> flagged device ids deep-link to /machines?device= (interconnected, N03/N09)" || fail "recs deep-link -> $(printf '%s' "$recp" | grep -oE '/machines[^\"'"'"']*' | head -1)"
  # fire #84 — U13 UI: the recs page surfaces the deduped distinct-machine count + each card's repair command.
  { echo "$recp" | grep -q 'distinctDeviceCount' && echo "$recp" | grep -qi 'distinct machine' && echo "$recp" | grep -q 'k.command' && echo "$recp" | grep -qi 'Repair:'; } && pass "GET /recommendations -> surfaces deduped distinct-machine count + per-card repair command (U13 UI)" || fail "recs U13 UI -> $(printf '%s' "$recp" | grep -oE 'distinctDeviceCount|distinct machine|Repair:' | sort -u | tr '\n' ' ')"
  { echo "$mp" | grep -q 'URLSearchParams' && echo "$mp" | grep -q "get('device')" && echo "$mp" | grep -q 'detail('; } && pass "GET /machines -> reads ?device= on load + auto-opens that device's detail (deep-link target)" || fail "machines auto-open -> $(printf '%s' "$mp" | grep -oE 'URLSearchParams|device' | sort -u | tr '\n' ' ')"
  # fire #61 — the /environment read-only desired-state view (step-5 "review the plan"; thin honest page).
  envp="$(curl -s "$u/environment" 2>/dev/null)"
  { echo "$envp" | grep -qi 'desired state' && echo "$envp" | grep -q '/api/environment/current' && echo "$envp" | grep -qi 'ENVIRONMENT.md' && echo "$envp" | grep -q 'id=tenant'; } && pass "GET /environment -> read-only desired-state view (ENVIRONMENT.md + revision over /api/environment/current, C02/M)" || fail "environment page -> $(printf '%s' "$envp" | head -c 80)"
  # fire #86 — C09: surface the SEMANTIC DIFF on /environment (step-5 "review the plan before applying").
  # Paste a proposed ENVIRONMENT.md -> import both (current + proposed) -> diff -> render added/removed/changed.
  # Wires the built-but-UI-only /api/environment/import + /diff endpoints into the UI (interconnectedness).
  { echo "$envp" | grep -q 'function diffProposed(' && echo "$envp" | grep -q '/api/environment/import' && echo "$envp" | grep -q '/api/environment/diff' && echo "$envp" | grep -qi 'Diff vs current' && echo "$envp" | grep -q 'id=proposed'; } && pass "GET /environment -> surfaces a semantic blueprint DIFF tool (import+diff a proposed ENVIRONMENT.md vs current; C09 interconnectedness)" || fail "environment diff tool -> $(printf '%s' "$envp" | grep -oE 'diffProposed|/api/environment/diff|Diff vs current' | sort -u | tr '\n' ' ')"
  # fire #93 — C12 "review the plan" (intended-experience step 5): a structured at-a-glance summary of the
  # desired blueprint (packages/machines/services/routing/privacy), imported from the current markdown.
  { echo "$envp" | grep -q 'id=summary' && echo "$envp" | grep -q 'function renderSummary(' && echo "$envp" | grep -qi 'Plan at a glance'; } && pass "GET /environment -> structured 'Plan at a glance' summary of the desired blueprint (step-5 review; C12)" || fail "environment plan summary -> $(printf '%s' "$envp" | grep -oE 'id=summary|renderSummary|Plan at a glance' | sort -u | tr '\n' ' ')"
  # fire #98 — each planned package in the Plan-at-a-glance LINKS to its App Store detail (step-5 review +
  # interconnectedness): click a package → see what it is, install commands, platforms, learn-more links.
  { echo "$envp" | grep -q 'function pkgLinks(' && echo "$envp" | grep -q '/apps?q='; } && pass "GET /environment -> plan packages LINK to the App Store (/apps?q=; interconnectedness #98)" || fail "environment pkg links -> $(printf '%s' "$envp" | grep -oE 'pkgLinks|/apps.q=' | sort -u | tr '\n' ' ')"
  echo "$mp" | grep -q 'href="/environment"' && pass "dashboard nav includes /environment (interconnected)" || fail "nav missing /environment -> $(printf '%s' "$mp" | grep -o 'href="/[a-z]*"' | tr '\n' ' ')"
  # fire #64 — inline-JS syntax guard: a dashboard page's inline <script> is a template STRING (NOT
  # tsc/dry-run checked), so a stray quote/escape silently breaks the ENTIRE page script. node --check
  # every served inline script. (This caught the #64 onclick \' -> '' escaping bug before it shipped.)
  if command -v node >/dev/null 2>&1 && command -v perl >/dev/null 2>&1; then
    jsbad=""
    for pg in machines history recommendations apps environment; do
      tmpjs="$(mktemp).js" # node --check needs a .js extension to pick a module loader (else it errors regardless of JS validity)
      curl -s "$u/$pg" 2>/dev/null | perl -0777 -ne 'while(/<script>(.*?)<\/script>/sg){print "$1\n"}' >"$tmpjs"
      if [ -s "$tmpjs" ]; then node --check "$tmpjs" 2>/dev/null || jsbad="$jsbad $pg"; fi
      rm -f "$tmpjs"
    done
    [ -z "$jsbad" ] && pass "every dashboard page's inline <script> parses clean (node --check; no template-string JS break)" || fail "inline JS syntax error on:$jsbad"
  else
    skip "node/perl absent — inline-JS syntax guard skipped"
  fi
  ap="$(curl -s "$u/apps" 2>/dev/null)"
  # fire #94 — the search box ADVERTISES the breadth (name · command · what-it-does) so the description-search
  # superpower is discoverable, not hidden behind a bare "Search apps" label (embarrassingly-easy-to-use).
  { echo "$ap" | grep -qi 'installable catalog' && echo "$ap" | grep -qi 'what it does'; } && pass "GET /apps -> App Store catalog page (public, live search advertises name/command/what-it-does)" || fail "apps page -> $(printf '%s' "$ap" | head -c 80)"
  # fire #92 — D11/R13: the App Store surfaces WHAT each tool does (_short description, list sub-line) + its
  # PROVENANCE (_github source link, detail) — previously name/command/installers/platforms only.
  { echo "$ap" | grep -q 'e.short' && echo "$ap" | grep -q 'j.github' && echo "$ap" | grep -qi 'Source'; } && pass "GET /apps -> surfaces tool description (_short) + github provenance (_github source link; D11/R13)" || fail "apps desc/provenance -> $(printf '%s' "$ap" | grep -oE 'e.short|j.github|Source' | sort -u | tr '\n' ' ')"
  # fire #95 — the App Store detail renders Homepage + Docs "learn more" links (j.home / j.docs) alongside Source.
  { echo "$ap" | grep -q 'j.home' && echo "$ap" | grep -q 'j.docs' && echo "$ap" | grep -qi 'Homepage'; } && pass "GET /apps -> detail renders Homepage + Docs learn-more links (j.home/j.docs; D11 #95)" || fail "apps home/docs render -> $(printf '%s' "$ap" | grep -oE 'j.home|j.docs|Homepage' | sort -u | tr '\n' ' ')"
  # fire #97 — the App Store has a PLATFORM filter (show only tools installable on your OS); load() appends &platform=.
  { echo "$ap" | grep -q 'id=plat' && echo "$ap" | grep -q 'platform=' && echo "$ap" | grep -qi 'macOS'; } && pass "GET /apps -> platform filter control (id=plat + &platform= wired; D05 #97)" || fail "apps platform filter -> $(printf '%s' "$ap" | grep -oE 'id=plat|platform=|macOS' | sort -u | tr '\n' ' ')"
  # fire #98 — /apps honors ?q= from the URL (so a package link from the Environment plan lands on a filtered view).
  { echo "$ap" | grep -q "URLSearchParams(location.search).get('q')"; } && pass "GET /apps -> honors ?q= from the URL (deep-link from the Environment plan; #98)" || fail "apps ?q= deep-link -> $(printf '%s' "$ap" | grep -oE "URLSearchParams\(location.search\).get\('q'\)" | head -1)"
  cat="$(curl -s "$u/api/catalog?limit=3" 2>/dev/null)"
  echo "$cat" | jq -e '(.total>=1000) and (.items|length==3) and (.items[0].name|type=="string") and (.items[0].bin|type=="string") and (.items[0].providers|type=="array")' >/dev/null 2>&1 && pass "GET /api/catalog -> software.yml catalog (total>=1000, typed entries, D01/D02)" || fail "catalog -> $(printf '%s' "$cat" | head -c 140)"
  cq="$(curl -s "$u/api/catalog?q=ripgrep" 2>/dev/null)"
  echo "$cq" | jq -e '.q=="ripgrep" and (.matched>=1) and ([.items[]|select(.bin=="rg" or .name=="ripgrep")]|length>=1)' >/dev/null 2>&1 && pass "GET /api/catalog?q=ripgrep -> filtered match (rg)" || fail "catalog query -> $(printf '%s' "$cq" | head -c 140)"
  # fire #94 — the catalog search also matches the DESCRIPTION (_short), so you can find a tool by WHAT IT DOES,
  # not just its name/bin. "fuzzy" is in NO name/bin but IS in fzf's _short ("command-line fuzzy finder").
  cqd="$(curl -s "$u/api/catalog?q=fuzzy" 2>/dev/null)"
  echo "$cqd" | jq -e '.q=="fuzzy" and (.matched>=1) and ([.items[]|select(.name=="fzf")]|length==1)' >/dev/null 2>&1 && pass "GET /api/catalog?q=fuzzy -> matches by DESCRIPTION (finds fzf via its _short; search-by-what-it-does)" || fail "catalog desc-search -> $(printf '%s' "$cqd" | jq -c '{matched,names:[.items[].name]}' 2>/dev/null | head -c 160)"
  # fire #97 — the catalog filters by PLATFORM so you see only what's installable on YOUR OS (D05). Server
  # allowlists the value + echoes what it applied. Anchors: cockpit=linux-only, aerospace=macos-only.
  cpl="$(curl -s "$u/api/catalog?platform=linux&limit=200" 2>/dev/null)"
  echo "$cpl" | jq -e '.platform=="linux" and ([.items[]|select(.name=="cockpit")]|length==1) and ([.items[]|select(.name=="aerospace")]|length==0)' >/dev/null 2>&1 && pass "GET /api/catalog?platform=linux -> only linux-installable (cockpit in, macos-only aerospace out; D05)" || fail "catalog platform=linux -> $(printf '%s' "$cpl" | jq -c '{platform,cockpit:([.items[]|select(.name=="cockpit")]|length),aerospace:([.items[]|select(.name=="aerospace")]|length)}' 2>/dev/null | head -c 160)"
  cpm="$(curl -s "$u/api/catalog?platform=macos&limit=200" 2>/dev/null)"
  echo "$cpm" | jq -e '.platform=="macos" and ([.items[]|select(.name=="aerospace")]|length==1) and ([.items[]|select(.name=="cockpit")]|length==0)' >/dev/null 2>&1 && pass "GET /api/catalog?platform=macos -> only macos-installable (aerospace in, linux-only cockpit out)" || fail "catalog platform=macos -> $(printf '%s' "$cpm" | jq -c '{platform}' 2>/dev/null | head -c 120)"
  cpx="$(curl -s "$u/api/catalog?platform=bogus" 2>/dev/null)"
  echo "$cpx" | jq -e '.platform==null and (.matched==.total)' >/dev/null 2>&1 && pass "GET /api/catalog?platform=bogus -> invalid value ignored (echoes null, returns all; allowlist)" || fail "catalog platform=bogus -> $(printf '%s' "$cpx" | jq -c '{platform,matched,total}' 2>/dev/null | head -c 120)"
  cd1="$(curl -s "$u/api/catalog/ripgrep" 2>/dev/null)"
  echo "$cd1" | jq -e '.name=="ripgrep" and ([.commands[]|select(.command=="brew install ripgrep")]|length==1) and ([.commands[]|select(.provider=="cargo" and .command=="cargo install ripgrep")]|length==1)' >/dev/null 2>&1 && pass "GET /api/catalog/:name -> per-manager install commands (R13: brew+cargo install ripgrep)" || fail "catalog detail -> $(printf '%s' "$cd1" | head -c 160)"
  # fire #92 — the detail carries the human-facing description + provenance from software.yml (_short/_github).
  echo "$cd1" | jq -e '((.short|type=="string") and (.short|test("search";"i"))) and ((.github|type=="string") and (.github|test("github.com/BurntSushi/ripgrep")))' >/dev/null 2>&1 && pass "GET /api/catalog/:name -> description (_short) + github provenance (_github) (D11/R13)" || fail "catalog short/github -> $(printf '%s' "$cd1" | jq -c '{short,github}' 2>/dev/null | head -c 180)"
  cd2="$(curl -s "$u/api/catalog/angular-cli" 2>/dev/null)"
  echo "$cd2" | jq -e '[.commands[]|select(.provider=="npm" and .command=="npm install -g @angular/cli")]|length==1' >/dev/null 2>&1 && pass "catalog detail uses real per-provider pkg id (angular-cli -> npm @angular/cli, not the name)" || fail "catalog detail pkg-id -> $(printf '%s' "$cd2" | head -c 160)"
  # fire #95 — the detail also carries "learn more" links: _home (homepage) + _docs (documentation) from
  # software.yml (521 entries have one+), surfaced alongside the existing _github Source link (D11).
  echo "$cd2" | jq -e '((.home|type=="string") and (.home|test("angular.io"))) and ((.docs|type=="string") and (.docs|test("angular.io/docs")))' >/dev/null 2>&1 && pass "GET /api/catalog/:name -> homepage (_home) + docs (_docs) learn-more links (D11 #95)" || fail "catalog home/docs -> $(printf '%s' "$cd2" | jq -c '{home,docs}' 2>/dev/null | head -c 180)"
  cd3="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/catalog/definitely-not-an-app-xyz" 2>/dev/null || echo 000)"
  [ "$cd3" = 404 ] && pass "GET /api/catalog/<bogus> -> 404" || fail "catalog detail bogus -> $cd3 (want 404)"
  { echo "$ap" | grep -qi 'install commands'; } && pass "/apps page ships the per-item install-command expander" || fail "apps install-command expander missing"
  # inference route pre-flight (fire #8): POST-only; restricted fails closed; fail-closed when unconfigured
  rc="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rc" = 503 ] && pass "POST /api/ai/v1/economy -> 503 (provider not configured, fail-closed)" || fail "economy POST -> $rc (want 503)"
  rr="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$u/api/ai/v1/restricted" 2>/dev/null || echo 000)"
  [ "$rr" = 451 ] && pass "POST /api/ai/v1/restricted -> 451 (restricted fails closed — no public gateway)" || fail "restricted POST -> $rr (want 451)"
  rg="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rg" = 405 ] && pass "GET /api/ai/v1/economy -> 405 (inference uses POST)" || fail "economy GET -> $rg (want 405)"
  rb="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/ai/v1/definitely-not-a-route" 2>/dev/null || echo 000)"
  [ "$rb" = 404 ] && pass "GET /api/ai/v1/<bogus> -> 404" || fail "bogus route -> $rb (want 404)"

  # cost-reservation gate (fire #9): fail-closed BEFORE any provider work
  rov="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"estimateMicros":300000}' "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rov" = 402 ] && pass "over-ceiling estimate -> 402 (cost reservation, fail-closed)" || fail "over-budget -> $rov (want 402)"
  rneg="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"estimateMicros":-1}' "$u/api/ai/v1/economy" 2>/dev/null || echo 000)"
  [ "$rneg" = 400 ] && pass "negative estimate -> 400 (Zod boundary)" || fail "negative estimate -> $rneg (want 400)"

  # routing-policy decisions — reuses aid-core chooseRoute at the HTTP boundary (no inference performed)
  rp(){ curl -s -X POST -H 'content-type: application/json' -d "$1" "$u/api/ai/v1/resolve" 2>/dev/null; }
  echo "$(rp '{}')"                                                                                | grep -q '"route":"economy"'    && pass "resolve {} -> economy (routine default)"          || fail "resolve {} -> $(rp '{}')"
  echo "$(rp '{"sensitivity":"restricted","kind":"code","verificationFailed":true,"allowPremium":true}')" | grep -q '"route":"restricted"' && pass "restricted fails closed (ignores premium)"    || fail "restricted not failing closed"
  echo "$(rp '{"kind":"architecture","allowPremium":false}')"                                      | grep -q '"route":"code"'      && pass "architecture w/o premium -> code (opt-in gate)"  || fail "architecture gate wrong"
  echo "$(rp '{"kind":"code","verificationFailed":true,"allowPremium":true}')"                      | grep -q '"route":"critical"'  && pass "verified-failure + premium -> critical"          || fail "escalation wrong"
  rbad="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"sensitivity":"bogus"}' "$u/api/ai/v1/resolve" 2>/dev/null || echo 000)"
  [ "$rbad" = 400 ] && pass "invalid body -> 400 (Zod boundary)" || fail "invalid body -> $rbad (want 400)"

  # ENVIRONMENT.md round-trip (S01 / MASTER-PROMPT §9) — aid-core validate/export/import/digest
  bpf="$(mktemp)"; mdf="$(mktemp)"
  cat > "$bpf" <<'JSON'
{"schemaVersion":1,"revision":"r1","appUrl":"https://app.install.doctor","routing":{"engine":"projectsites","preferredProvider":"deepseek","allowPremium":false,"maxTaskCostMicros":250000},"skills":{"repository":"heymegabyte/agent-skills","commit":"0000000000000000000000000000000000000000","include":["desktop-provisioning"]},"defaults":{"packages":["git","chezmoi","mise"],"shellHistory":"hishtory"},"machines":[{"id":"runner","os":"linux","role":"runner","packages":["alloy"]},{"id":"laptop","os":"darwin","role":"workstation","packages":[]}],"services":[{"id":"logs","kind":"loki","pushUrl":"https://logs.example.invalid/loki/api/v1/push","credentialRef":"infisical://fleet/loki","machineIds":["runner","laptop"]}],"privacy":{"shellAnalysis":"local","screenshots":"off","terminalInput":false,"productLearning":false}}
JSON
  vd="$(curl -s -X POST -H 'content-type: application/json' --data-binary @"$bpf" "$u/api/environment/validate" 2>/dev/null)"
  echo "$vd" | grep -q '"valid":true' && pass "env validate -> valid + digest" || fail "env validate -> $vd"
  d1="$(printf '%s' "$vd" | grep -oE '"digest":"[0-9a-f]+"' | head -1)"
  ec="$(curl -s -o "$mdf" -w '%{http_code}' -X POST -H 'content-type: application/json' --data-binary @"$bpf" "$u/api/environment/export" 2>/dev/null || echo 000)"
  { [ "$ec" = 200 ] && grep -q 'install-doctor+json' "$mdf"; } && pass "env export -> ENVIRONMENT.md markdown" || fail "env export -> $ec"
  id="$(curl -s -X POST -H 'content-type: text/markdown' --data-binary @"$mdf" "$u/api/environment/import" 2>/dev/null | grep -oE '"digest":"[0-9a-f]+"' | head -1)"
  { [ -n "$d1" ] && [ "$d1" = "$id" ]; } && pass "env round-trip lossless (import(export).digest == validate.digest)" || fail "round-trip digest mismatch ($d1 vs $id)"
  iv="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$u/api/environment/validate" 2>/dev/null || echo 000)"
  [ "$iv" = 400 ] && pass "env validate {} -> 400 (invalid blueprint)" || fail "invalid blueprint -> $iv (want 400)"

  # ENVIRONMENT.md diff (§9 Environment "Diff" action) — structured blueprint-vs-blueprint diff
  bpf2="$(mktemp)"; jq '.defaults.packages += ["ripgrep"]' "$bpf" > "$bpf2" 2>/dev/null
  same="$(curl -s -X POST -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" '{from:$a[0],to:$a[0]}')" "$u/api/environment/diff" 2>/dev/null)"
  echo "$same" | grep -q '"changed":false' && pass "env diff (identical) -> changed:false" || fail "diff identical -> $same"
  chg="$(curl -s -X POST -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" --slurpfile b "$bpf2" '{from:$a[0],to:$b[0]}')" "$u/api/environment/diff" 2>/dev/null)"
  { echo "$chg" | grep -q '"changed":true' && echo "$chg" | grep -q 'ripgrep'; } && pass "env diff (added package) -> changed:true + ripgrep" || fail "diff changed -> $chg"
  dbad="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"from":{},"to":{}}' "$u/api/environment/diff" 2>/dev/null || echo 000)"
  [ "$dbad" = 400 ] && pass "env diff (invalid blueprint) -> 400" || fail "diff invalid -> $dbad (want 400)"

  # persistence read path (§9) — D1-stored "current" blueprint (seeded _default)
  cur="$(curl -s "$u/api/environment/current?tenant=_default" 2>/dev/null)"
  echo "$cur" | grep -q '"digest"' && pass "env current (_default) -> stored blueprint + digest (D1 read)" || fail "env current _default -> $cur"
  # fire #93 — C12: /api/environment/current carries a compact structured `summary` (packages/machines/services/
  # routing/privacy) so the dashboard renders the "review the plan" at-a-glance view synchronously (one fetch).
  echo "$cur" | jq -e '(.summary.defaults.packages|type=="array") and (.summary.machines|type=="array") and (.summary.routing.engine|type=="string") and (.summary.privacy|type=="object")' >/dev/null 2>&1 && pass "GET /api/environment/current -> structured plan summary (packages/machines/services/routing/privacy; C12 step-5)" || fail "env summary -> $(printf '%s' "$cur" | jq -c '.summary' 2>/dev/null | head -c 180)"
  nf="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/environment/current?tenant=__nope__" 2>/dev/null || echo 000)"
  [ "$nf" = 404 ] && pass "env current (unknown tenant) -> 404" || fail "env current unknown -> $nf (want 404)"

  # authed WRITE path (§9) — PUT /api/environment/current, optimistic revision-check, AID_ADMIN_TOKEN bearer.
  # Unauthed is rejected the moment the Worker secret is set (503 before it's set — honest SKIP, never a false pass).
  un="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H 'content-type: application/json' -d '{"tenant":"_test","blueprint":{}}' "$u/api/environment/current" 2>/dev/null || echo 000)"
  case "$un" in
    401) pass "PUT current (no bearer) -> 401 (fail-closed auth)";;
    503) skip "PUT current -> 503 (AID_ADMIN_TOKEN not yet set on Worker)";;
    *)   fail "PUT current (no bearer) -> $un (want 401)";;
  esac
  ADMIN="${AID_ADMIN_TOKEN:-}"; [ -z "$ADMIN" ] && ADMIN="$(get-secret AID_ADMIN_TOKEN 2>/dev/null || true)"; [ -z "$ADMIN" ] && [ -f "$CP/.aid-admin-token" ] && ADMIN="$(cat "$CP/.aid-admin-token" 2>/dev/null || true)"
  if [ -n "$ADMIN" ]; then
    wr="$(curl -s -X PUT -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" '{tenant:"_test",blueprint:$a[0]}')" "$u/api/environment/current" 2>/dev/null)"
    echo "$wr" | grep -q '"digest"' && pass "PUT current (bearer, valid) -> 200 + digest" || fail "authed PUT -> $wr"
    rb="$(curl -s "$u/api/environment/current?tenant=_test" 2>/dev/null)"
    echo "$rb" | grep -q '"revision":"r1"' && pass "GET current (_test) -> stored r1 (write persisted to D1)" || fail "read-back -> $rb"
    sc="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" '{tenant:"_test",expectedRevision:"STALE",blueprint:$a[0]}')" "$u/api/environment/current" 2>/dev/null || echo 000)"
    [ "$sc" = 409 ] && pass "PUT current (stale expectedRevision) -> 409 (optimistic lock)" || fail "stale revision -> $sc (want 409)"
    mc="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" '{tenant:"_test",expectedRevision:"r1",blueprint:$a[0]}')" "$u/api/environment/current" 2>/dev/null || echo 000)"
    [ "$mc" = 200 ] && pass "PUT current (matching expectedRevision r1) -> 200" || fail "matching revision -> $mc (want 200)"
    ib="$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"tenant":"_test","blueprint":{}}' "$u/api/environment/current" 2>/dev/null || echo 000)"
    [ "$ib" = 400 ] && pass "PUT current (authed, invalid blueprint) -> 400" || fail "authed invalid -> $ib (want 400)"
  else
    skip "AID_ADMIN_TOKEN unset (env + get-secret) — authed PUT assertions skipped"
  fi

  # apply-PREVIEW (§9 / S02,S03,S12) — reconciliation plan observed->desired, dry-run, no mutation.
  # Derive a known-good observed from the seeded _default (GET current -> import markdown -> blueprint),
  # so these run unauthenticated + deterministic every fire.
  dmd="$(curl -s "$u/api/environment/current?tenant=_default" 2>/dev/null | jq -r '.markdown')"
  obp="$(printf '%s' "$dmd" | curl -s -X POST -H 'content-type: text/markdown' --data-binary @- "$u/api/environment/import" 2>/dev/null | jq -c '.blueprint')"
  if [ -n "$obp" ] && [ "$obp" != "null" ]; then
    noop="$(curl -s -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" '{tenant:"_default",observed:$o}')" "$u/api/environment/apply" 2>/dev/null)"
    echo "$noop" | jq -e '.dryRun==true and .applied==false and .plan.total==0 and .plan.noop==true' >/dev/null 2>&1 && pass "apply (observed==desired _default) -> dryRun plan, 0 changes (noop)" || fail "apply noop -> $noop"
    obp2="$(printf '%s' "$obp" | jq -c '.defaults.packages += ["zzz-drift-probe"]')"
    drift="$(curl -s -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp2" '{tenant:"_default",observed:$o}')" "$u/api/environment/apply" 2>/dev/null)"
    { echo "$drift" | jq -e '.plan.remove>=1' >/dev/null 2>&1 && echo "$drift" | grep -q 'zzz-drift-probe'; } && pass "apply (observed has extra pkg) -> plan.remove>=1 + names the drift" || fail "apply drift -> $drift"
    na="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" '{tenant:"_default",observed:$o,dryRun:false}')" "$u/api/environment/apply" 2>/dev/null || echo 000)"
    [ "$na" = 501 ] && pass "apply dryRun:false -> 501 (mutation needs the on-device supervisor, Phase B)" || fail "apply real -> $na (want 501)"
    ua="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" '{tenant:"__nope__",observed:$o}')" "$u/api/environment/apply" 2>/dev/null || echo 000)"
    [ "$ua" = 404 ] && pass "apply (unknown tenant, no desired) -> 404" || fail "apply no-desired -> $ua (want 404)"
    # §3 / P09 — execution must match the plan's expected revision. A STALE expectedRevision is rejected
    # 409 revision_mismatch (the plan is for an old desired state → re-pull); a MATCHING one proceeds;
    # OMITTING it preserves the prior unguarded behavior (the noop above already proves omit→200).
    dr="$(printf '%s' "$noop" | jq -r '.desiredRevision // empty')"
    rmresp="$(curl -s -w $'\n%{http_code}' -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" '{tenant:"_default",observed:$o,expectedRevision:"__stale__"}')" "$u/api/environment/apply" 2>/dev/null)"
    rmcode="${rmresp##*$'\n'}"; rmbody="${rmresp%$'\n'*}"
    { [ "$rmcode" = 409 ] && printf '%s' "$rmbody" | jq -e '.error=="revision_mismatch" and .expectedRevision=="__stale__" and (.desiredRevision|type=="string")' >/dev/null 2>&1; } && pass "apply (stale expectedRevision) -> 409 revision_mismatch (§3 plan-revision guard, P09)" || fail "apply stale rev -> $rmcode $rmbody"
    rmok="$(curl -s -X POST -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" --arg r "$dr" '{tenant:"_default",observed:$o,expectedRevision:$r}')" "$u/api/environment/apply" 2>/dev/null)"
    printf '%s' "$rmok" | jq -e '.dryRun==true and .plan.noop==true' >/dev/null 2>&1 && pass "apply (matching expectedRevision) -> proceeds (dry-run plan)" || fail "apply match rev -> $rmok"
  else
    fail "apply-preview setup — could not derive observed blueprint from _default (import returned '$obp')"
  fi
  ia="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"tenant":"_default","observed":{}}' "$u/api/environment/apply" 2>/dev/null || echo 000)"
  [ "$ia" = 400 ] && pass "apply (invalid observed) -> 400 (Zod boundary)" || fail "apply invalid -> $ia (want 400)"

  # device identity lifecycle (Phase B / S04 enrollment, S27 revocation) — enroll(admin)->me->revoke->denied.
  eun="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"tenant":"_test"}' "$u/api/devices/enroll" 2>/dev/null || echo 000)"
  case "$eun" in
    401) pass "enroll (no admin bearer) -> 401 (fail-closed)";;
    503) skip "enroll -> 503 (AID_ADMIN_TOKEN not set on Worker)";;
    *)   fail "enroll (no bearer) -> $eun (want 401)";;
  esac
  mbog="$(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer aid_bogus_nonexistent_token' "$u/api/devices/me" 2>/dev/null || echo 000)"
  [ "$mbog" = 401 ] && pass "devices/me (unknown token) -> 401" || fail "me bogus -> $mbog (want 401)"
  dcn="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/device/current" 2>/dev/null || echo 000)"
  [ "$dcn" = 401 ] && pass "device/current (no bearer) -> 401" || fail "device/current no-bearer -> $dcn (want 401)"
  dan="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"observed":{}}' "$u/api/device/apply" 2>/dev/null || echo 000)"
  [ "$dan" = 401 ] && pass "device/apply (no bearer) -> 401" || fail "device/apply no-bearer -> $dan (want 401)"
  rpn="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"kind":"run"}' "$u/api/device/report" 2>/dev/null || echo 000)"
  [ "$rpn" = 401 ] && pass "device/report (no bearer) -> 401" || fail "report no-bearer -> $rpn (want 401)"
  hsn="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/device/history" 2>/dev/null || echo 000)"
  [ "$hsn" = 401 ] && pass "device/history (no bearer) -> 401" || fail "history no-bearer -> $hsn (want 401)"
  ahn="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/history?tenant=_default" 2>/dev/null || echo 000)"
  [ "$ahn" = 401 ] && pass "GET /api/history (no admin bearer) -> 401 (fail-closed)" || fail "admin history no-bearer -> $ahn (want 401)"
  adn="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/devices?tenant=_default" 2>/dev/null || echo 000)"
  [ "$adn" = 401 ] && pass "GET /api/devices (no admin bearer) -> 401 (fail-closed)" || fail "admin devices no-bearer -> $adn (want 401)"
  arn="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/recommendations?tenant=_default" 2>/dev/null || echo 000)"
  [ "$arn" = 401 ] && pass "GET /api/recommendations (no admin bearer) -> 401 (fail-closed)" || fail "admin recs no-bearer -> $arn (want 401)"

  # browser-first PAIRING (fire #19 / S04) — start (unauthenticated) + poll-before-approval + bad polls
  pstart="$(curl -s -X POST -H 'content-type: application/json' -d '{"tenant":"_default","label":"pair-probe"}' "$u/api/devices/pair/start" 2>/dev/null)"
  pcode="$(printf '%s' "$pstart" | jq -r '.code // empty')"; psecret="$(printf '%s' "$pstart" | jq -r '.pollSecret // empty')"
  echo "$pstart" | jq -e '(.code|type=="string") and (.pollSecret|type=="string") and (.verifyUrl|test("/pair\\?code="))' >/dev/null 2>&1 && pass "pair/start -> 201 code + pollSecret + verifyUrl" || fail "pair/start -> $pstart"
  ppend="$(curl -s -H "authorization: Bearer $psecret" "$u/api/devices/pair/poll" 2>/dev/null)"
  echo "$ppend" | jq -e '.status=="pending"' >/dev/null 2>&1 && pass "pair/poll (pre-approval) -> pending" || fail "pair/poll pending -> $ppend"
  pbog="$(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer aidp_bogus' "$u/api/devices/pair/poll" 2>/dev/null || echo 000)"
  [ "$pbog" = 404 ] && pass "pair/poll (unknown secret) -> 404" || fail "pair/poll bogus -> $pbog (want 404)"
  pnb="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/devices/pair/poll" 2>/dev/null || echo 000)"
  [ "$pnb" = 401 ] && pass "pair/poll (no bearer) -> 401" || fail "pair/poll no-bearer -> $pnb (want 401)"
  DADM="${AID_ADMIN_TOKEN:-}"; [ -z "$DADM" ] && DADM="$(get-secret AID_ADMIN_TOKEN 2>/dev/null || true)"; [ -z "$DADM" ] && [ -f "$CP/.aid-admin-token" ] && DADM="$(cat "$CP/.aid-admin-token" 2>/dev/null || true)"
  if [ -n "$DADM" ]; then
    enr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_test","label":"e2e-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    did="$(printf '%s' "$enr" | jq -r '.deviceId // empty')"; dtok="$(printf '%s' "$enr" | jq -r '.token // empty')"
    { [ -n "$did" ] && [ -n "$dtok" ]; } && pass "enroll (admin) -> 201 deviceId + one-time token" || fail "enroll -> $enr"
    who="$(curl -s -H "authorization: Bearer $dtok" "$u/api/devices/me" 2>/dev/null)"
    echo "$who" | jq -e --arg d "$did" '.deviceId==$d and .tenant=="_test"' >/dev/null 2>&1 && pass "devices/me (issued token) -> identity (deviceId + tenant)" || fail "me -> $who"
    rv="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$did/revoke" 2>/dev/null || echo 000)"
    [ "$rv" = 200 ] && pass "revoke (admin) -> 200" || fail "revoke -> $rv (want 200)"
    whor="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $dtok" "$u/api/devices/me" 2>/dev/null || echo 000)"
    [ "$whor" = 401 ] && pass "devices/me (revoked token) -> 401 (S27 per-device revocation)" || fail "me after revoke -> $whor (want 401)"
    rvb="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $DADM" "$u/api/devices/dev_nonexistent/revoke" 2>/dev/null || echo 000)"
    [ "$rvb" = 404 ] && pass "revoke (unknown deviceId) -> 404" || fail "revoke bogus -> $rvb (want 404)"

    # device-SCOPED environment access (fire #17) — tenant resolved FROM the token (no tenant in URL)
    enr2="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_default","label":"scoped-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    did2="$(printf '%s' "$enr2" | jq -r '.deviceId // empty')"; dtok2="$(printf '%s' "$enr2" | jq -r '.token // empty')"
    dcur="$(curl -s -H "authorization: Bearer $dtok2" "$u/api/device/current" 2>/dev/null)"
    echo "$dcur" | jq -e '.tenant=="_default" and (.digest|type=="string")' >/dev/null 2>&1 && pass "device/current (device token) -> own tenant blueprint (_default, no tenant in URL)" || fail "device/current -> $dcur"
    dap="$(curl -s -X POST -H "authorization: Bearer $dtok2" -H 'content-type: application/json' -d "$(jq -nc --argjson o "$obp" '{observed:$o}')" "$u/api/device/apply" 2>/dev/null)"
    echo "$dap" | jq -e --arg d "$did2" '.dryRun==true and .tenant=="_default" and .deviceId==$d and .plan.total==0' >/dev/null 2>&1 && pass "device/apply (device token) -> scoped dry-run plan (noop vs _default)" || fail "device/apply -> $dap"
    dmd2="$(curl -s -H "authorization: Bearer $dtok2" "$u/api/device/current.md" 2>/dev/null)"
    echo "$dmd2" | grep -q 'install-doctor+json' && pass "device/current.md (device token) -> raw ENVIRONMENT.md (§9 Export)" || fail "device/current.md -> $(printf '%s' "$dmd2" | head -c 80)"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$did2/revoke" >/dev/null 2>&1
    dcr="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $dtok2" "$u/api/device/current" 2>/dev/null || echo 000)"
    [ "$dcr" = 401 ] && pass "device/current (revoked token) -> 401 (S27)" || fail "device/current revoked -> $dcr (want 401)"

    # History (fire #18 / S14,S15) — a device reports a run, then reads it back newest-first
    enr4="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_default","label":"history-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    dtok4="$(printf '%s' "$enr4" | jq -r '.token // empty')"; did4="$(printf '%s' "$enr4" | jq -r '.deviceId // empty')"
    rep="$(curl -s -X POST -H "authorization: Bearer $dtok4" -H 'content-type: application/json' -d '{"kind":"apply","status":"success","revision":"r1","summary":"e2e report","detail":{"plan":{"total":0}}}' "$u/api/device/report" 2>/dev/null)"
    echo "$rep" | jq -e '(.id|type=="string") and .kind=="apply" and .status=="success"' >/dev/null 2>&1 && pass "device/report (device token) -> 201 + event id" || fail "report -> $rep"
    hst="$(curl -s -H "authorization: Bearer $dtok4" "$u/api/device/history" 2>/dev/null)"
    echo "$hst" | jq -e '.count>=1 and (.items[0].kind=="apply") and (.items[0].status=="success") and (.recordingMode=="events-only")' >/dev/null 2>&1 && pass "device/history (device token) -> lists the reported run + recordingMode:events-only (U02)" || fail "history -> $hst"
    rpb="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $dtok4" -H 'content-type: application/json' -d '{"kind":"bogus_kind"}' "$u/api/device/report" 2>/dev/null || echo 000)"
    [ "$rpb" = 400 ] && pass "device/report (invalid kind) -> 400 (Zod boundary)" || fail "report invalid -> $rpb (want 400)"
    ah="$(curl -s -H "authorization: Bearer $DADM" "$u/api/history?tenant=_default&limit=5" 2>/dev/null)"
    echo "$ah" | jq -e '.tenant=="_default" and (.count>=1) and (.items[0].deviceId|type=="string") and (.items[0].kind|type=="string") and (.recordingMode=="events-only")' >/dev/null 2>&1 && pass "GET /api/history?tenant (admin) -> fleet events + recordingMode:events-only (S15/U02)" || fail "admin history -> $(printf '%s' "$ah" | head -c 160)"
    # fire #63 — per-device timeline filter (N09). Fresh device ids per run → id-scoped assertions are
    # deterministic even though the _histf tenant accumulates events across runs.
    hfA="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_histf","label":"hist-A"}' "$u/api/devices/enroll" 2>/dev/null)"
    hfAtok="$(printf '%s' "$hfA" | jq -r '.token // empty')"; hfAid="$(printf '%s' "$hfA" | jq -r '.deviceId // empty')"
    hfB="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_histf","label":"hist-B"}' "$u/api/devices/enroll" 2>/dev/null)"
    hfBtok="$(printf '%s' "$hfB" | jq -r '.token // empty')"; hfBid="$(printf '%s' "$hfB" | jq -r '.deviceId // empty')"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $hfAtok" -H 'content-type: application/json' -d '{"kind":"run","status":"success","summary":"A1"}' "$u/api/device/report" 2>/dev/null
    curl -s -o /dev/null -X POST -H "authorization: Bearer $hfAtok" -H 'content-type: application/json' -d '{"kind":"check","status":"success","summary":"A2"}' "$u/api/device/report" 2>/dev/null
    curl -s -o /dev/null -X POST -H "authorization: Bearer $hfBtok" -H 'content-type: application/json' -d '{"kind":"run","status":"success","summary":"B1"}' "$u/api/device/report" 2>/dev/null
    hffilt="$(curl -s -H "authorization: Bearer $DADM" "$u/api/history?tenant=_histf&device=$hfAid" 2>/dev/null)"
    echo "$hffilt" | jq -e --arg a "$hfAid" '(.device==$a) and (.count==2) and (([.items[].deviceId]|unique)==[$a])' >/dev/null 2>&1 && pass "GET /api/history?device= -> per-device timeline (only that device's 2 events, N09)" || fail "history device-filter -> $(printf '%s' "$hffilt" | head -c 220)"
    hfall="$(curl -s -H "authorization: Bearer $DADM" "$u/api/history?tenant=_histf&limit=200" 2>/dev/null)"
    echo "$hfall" | jq -e --arg a "$hfAid" --arg b "$hfBid" '(.device==null) and (.count>=3) and ([.items[].deviceId] as $d | ($d|index($a))!=null and ($d|index($b))!=null)' >/dev/null 2>&1 && pass "GET /api/history (no device) -> full tenant timeline incl. A+B (back-compat)" || fail "history no-filter -> $(printf '%s' "$hfall" | head -c 200)"
    [ -n "$hfAid" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$hfAid/revoke" >/dev/null 2>&1
    [ -n "$hfBid" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$hfBid/revoke" >/dev/null 2>&1
    # fire #82 — U12 support bundle: admin-scoped, SANITIZED, with an explicit contents/excluded manifest.
    # Report an event carrying a sentinel in its `detail` blob, then prove the bundle EXCLUDES both the
    # device token and that blob (sanitized by construction — the bundle allowlists safe fields only).
    sbenr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_sbundle","label":"sbundle-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    sbtok="$(printf '%s' "$sbenr" | jq -r '.token // empty')"; sbid="$(printf '%s' "$sbenr" | jq -r '.deviceId // empty')"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $sbtok" -H 'content-type: application/json' -d '{"kind":"apply","status":"success","revision":"r1","summary":"sb event","detail":{"secretish":"SHOULD_NOT_LEAK"}}' "$u/api/device/report" 2>/dev/null
    sbun="$(curl -s -o /dev/null -w '%{http_code}' "$u/api/devices/$sbid/support-bundle?tenant=_sbundle" 2>/dev/null || echo 000)"
    [ "$sbun" = 401 ] && pass "support-bundle (no admin bearer) -> 401 (U12 admin-scoped)" || fail "support-bundle no-auth -> $sbun (want 401)"
    sb="$(curl -s -H "authorization: Bearer $DADM" "$u/api/devices/$sbid/support-bundle?tenant=_sbundle" 2>/dev/null)"
    echo "$sb" | jq -e --arg d "$sbid" '(.bundleVersion==1) and (.device.deviceId==$d) and (.contents|type=="array" and length>=3) and (.excluded|type=="array" and length>=1) and (.recordingMode=="events-only") and (.recentHistory|type=="array" and length>=1)' >/dev/null 2>&1 && pass "support-bundle (admin) -> sanitized bundle + explicit contents/excluded manifest (U12)" || fail "support-bundle -> $(printf '%s' "$sb" | head -c 200)"
    { ! printf '%s' "$sb" | grep -qF "$sbtok"; } && pass "support-bundle EXCLUDES the device token (sanitized)" || fail "support-bundle LEAKED the device token"
    { ! printf '%s' "$sb" | grep -qF "SHOULD_NOT_LEAK"; } && pass "support-bundle EXCLUDES the raw reported detail blob (sanitized)" || fail "support-bundle LEAKED a reported detail value"
    sbnf="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $DADM" "$u/api/devices/dev_nonexistent/support-bundle?tenant=_sbundle" 2>/dev/null || echo 000)"
    [ "$sbnf" = 404 ] && pass "support-bundle (unknown device) -> 404" || fail "support-bundle unknown -> $sbnf (want 404)"
    [ -n "$sbid" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$sbid/revoke" >/dev/null 2>&1
    # fire #84 — U13 deduplicate alerts + link repair actions. Seed a device that is BOTH failed AND drifted
    # (a failed apply reported at an OLD revision while the tenant is at r1): it must be alerted in EXACTLY
    # ONE card (failed wins by severity — no duplicate alert), the response must carry a deduped
    # distinctDeviceCount, and every warning/info rec must carry a concrete repair `command`.
    curl -s -o /dev/null -X PUT -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d "$(jq -n --slurpfile a "$bpf" '{tenant:"_u13",blueprint:$a[0]}')" "$u/api/environment/current" 2>/dev/null
    u13enr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_u13","label":"u13-faildrift"}' "$u/api/devices/enroll" 2>/dev/null)"
    u13tok="$(printf '%s' "$u13enr" | jq -r '.token // empty')"; u13id="$(printf '%s' "$u13enr" | jq -r '.deviceId // empty')"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $u13tok" -H 'content-type: application/json' -d '{"kind":"apply","status":"failed","revision":"r0","summary":"u13 failed apply at old rev"}' "$u/api/device/report" 2>/dev/null
    u13recs="$(curl -s -H "authorization: Bearer $DADM" "$u/api/recommendations?tenant=_u13" 2>/dev/null)"
    echo "$u13recs" | jq -e --arg d "$u13id" '[.recommendations[]|select(.devices|index($d))|.id]==["failed_last_run"]' >/dev/null 2>&1 && pass "recommendations -> a failed+drifted device is alerted in EXACTLY ONE card (failed wins; U13 dedup)" || fail "U13 dedup -> $(printf '%s' "$u13recs" | jq -c '[.recommendations[]|{id,devices}]' 2>/dev/null | head -c 220)"
    echo "$u13recs" | jq -e '(([.recommendations[].devices[]]|length)==([.recommendations[].devices[]]|unique|length)) and (.distinctDeviceCount==([.recommendations[].devices[]]|unique|length))' >/dev/null 2>&1 && pass "recommendations -> no device appears in 2+ cards + distinctDeviceCount == unique flagged (U13 dedup invariant)" || fail "U13 distinct-count -> $(printf '%s' "$u13recs" | jq -c '{distinctDeviceCount,listed:[.recommendations[].devices[]]}' 2>/dev/null | head -c 220)"
    echo "$u13recs" | jq -e '[.recommendations[]|select(.severity!="ok")|.command] as $c | ($c|length)>0 and ($c|all(.!=null and .!=""))' >/dev/null 2>&1 && pass "recommendations -> every warning/info rec carries a concrete repair command (U13 link-repair-actions)" || fail "U13 repair command -> $(printf '%s' "$u13recs" | jq -c '[.recommendations[]|{id,command}]' 2>/dev/null | head -c 220)"
    [ -n "$u13id" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$u13id/revoke" >/dev/null 2>&1
    # fire #85 — U14 report payload QUOTA: `detail` was z.unknown() (UNBOUNDED) → a buggy/compromised device
    # could bloat the history table (D1 10GB) with huge detail blobs. Cap the serialized detail (+ the body
    # via Content-Length): oversized → 413 payload_too_large; a normal report still 201 (happy path intact).
    u14enr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_u14","label":"u14-quota"}' "$u/api/devices/enroll" 2>/dev/null)"
    u14tok="$(printf '%s' "$u14enr" | jq -r '.token // empty')"; u14id="$(printf '%s' "$u14enr" | jq -r '.deviceId // empty')"
    u14big="$(printf 'x%.0s' $(seq 1 20000))"   # 20,000-char detail string (> the 16 KB detail cap)
    u14bigcode="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $u14tok" -H 'content-type: application/json' -d "$(jq -nc --arg d "$u14big" '{kind:"run",status:"success",detail:$d}')" "$u/api/device/report" 2>/dev/null || echo 000)"
    [ "$u14bigcode" = 413 ] && pass "device/report (oversized detail > 16KB) -> 413 payload_too_large (U14 quota — unbounded detail blob rejected)" || fail "U14 oversized report -> $u14bigcode (want 413)"
    u14err="$(curl -s -X POST -H "authorization: Bearer $u14tok" -H 'content-type: application/json' -d "$(jq -nc --arg d "$u14big" '{kind:"run",status:"success",detail:$d}')" "$u/api/device/report" 2>/dev/null)"
    echo "$u14err" | jq -e '.error=="payload_too_large" and (.limitBytes|type=="number")' >/dev/null 2>&1 && pass "device/report (oversized) -> typed payload_too_large + limitBytes (U14)" || fail "U14 error shape -> $(printf '%s' "$u14err" | head -c 120)"
    u14okcode="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $u14tok" -H 'content-type: application/json' -d '{"kind":"run","status":"success","summary":"normal report","detail":{"plan":{"total":0}}}' "$u/api/device/report" 2>/dev/null || echo 000)"
    [ "$u14okcode" = 201 ] && pass "device/report (normal payload) -> 201 (U14 quota doesn't break the happy path)" || fail "U14 normal report -> $u14okcode (want 201)"
    [ -n "$u14id" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$u14id/revoke" >/dev/null 2>&1
    # fire #87 — U14 RETENTION: admin POST /api/history/prune (tenant-scoped, EXPLICIT olderThanDays) deletes
    # old history so the table can't grow unbounded. Seed 2 events, prune olderThanDays=0 (cutoff=now → all),
    # prove prunedCount>=2 AND the device history is then EMPTY. No-auth → 401; missing olderThanDays → 400.
    pr_un="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$u/api/history/prune?tenant=_u14prune&olderThanDays=0" 2>/dev/null || echo 000)"
    [ "$pr_un" = 401 ] && pass "history/prune (no admin bearer) -> 401 (U14 retention admin-scoped)" || fail "prune no-auth -> $pr_un (want 401)"
    pr_bad="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $DADM" "$u/api/history/prune?tenant=_u14prune" 2>/dev/null || echo 000)"
    [ "$pr_bad" = 400 ] && pass "history/prune (missing olderThanDays) -> 400 (explicit retention window required; no silent policy)" || fail "prune missing-param -> $pr_bad (want 400)"
    prenr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_u14prune","label":"u14-prune"}' "$u/api/devices/enroll" 2>/dev/null)"
    prtok="$(printf '%s' "$prenr" | jq -r '.token // empty')"; prid="$(printf '%s' "$prenr" | jq -r '.deviceId // empty')"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $prtok" -H 'content-type: application/json' -d '{"kind":"run","status":"success","summary":"prune ev1"}' "$u/api/device/report" 2>/dev/null
    curl -s -o /dev/null -X POST -H "authorization: Bearer $prtok" -H 'content-type: application/json' -d '{"kind":"run","status":"success","summary":"prune ev2"}' "$u/api/device/report" 2>/dev/null
    prpre="$(curl -s -H "authorization: Bearer $prtok" "$u/api/device/history" 2>/dev/null)"
    echo "$prpre" | jq -e '.count>=2' >/dev/null 2>&1 && pass "history/prune setup -> device has >=2 events before prune" || fail "prune pre-count -> $(printf '%s' "$prpre" | head -c 120)"
    prdo="$(curl -s -X POST -H "authorization: Bearer $DADM" "$u/api/history/prune?tenant=_u14prune&olderThanDays=0" 2>/dev/null)"
    echo "$prdo" | jq -e '.prunedCount>=2 and .tenant=="_u14prune" and (.cutoff|type=="string")' >/dev/null 2>&1 && pass "history/prune (olderThanDays=0) -> prunedCount>=2 + typed {tenant,cutoff} (U14 retention)" || fail "prune do -> $(printf '%s' "$prdo" | head -c 160)"
    prpost="$(curl -s -H "authorization: Bearer $prtok" "$u/api/device/history" 2>/dev/null)"
    echo "$prpost" | jq -e '.count==0' >/dev/null 2>&1 && pass "history/prune -> device history EMPTY after prune (retention actually removed the events)" || fail "prune post-count -> $(printf '%s' "$prpost" | head -c 120)"
    [ -n "$prid" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$prid/revoke" >/dev/null 2>&1
    # fire #88 — U03 parent/child run correlation. A report may carry correlationId (groups a logical run's
    # events — one `aid up` = plan+apply+report) + parentRunId (links a child run to its parent). Admin history
    # filters by ?correlation=; both history reads surface the fields. (ReportRequest is .strict() → unknown
    # keys were REJECTED 400 pre-migration, so a correlationId report is a real RED→GREEN.)
    u3enr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_u03","label":"u03-corr"}' "$u/api/devices/enroll" 2>/dev/null)"
    u3tok="$(printf '%s' "$u3enr" | jq -r '.token // empty')"; u3id="$(printf '%s' "$u3enr" | jq -r '.deviceId // empty')"
    u3corr="u03-${u3id}"   # per-run-unique (fresh deviceId) → hermetic: the ?correlation= filter returns ONLY this run's 2 events (the _u03 tenant persists across runs)
    u3a="$(curl -s -X POST -H "authorization: Bearer $u3tok" -H 'content-type: application/json' -d "$(jq -nc --arg c "$u3corr" '{kind:"apply",status:"success",summary:"u03 parent",correlationId:$c}')" "$u/api/device/report" 2>/dev/null)"
    echo "$u3a" | jq -e --arg c "$u3corr" '.correlationId==$c' >/dev/null 2>&1 && pass "device/report (correlationId) -> 201 + echoes correlationId (U03)" || fail "U03 report echo -> $(printf '%s' "$u3a" | head -c 140)"
    u3aid="$(printf '%s' "$u3a" | jq -r '.id // empty')"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $u3tok" -H 'content-type: application/json' -d "$(jq -nc --arg p "$u3aid" --arg c "$u3corr" '{kind:"run",status:"success",summary:"u03 child",correlationId:$c,parentRunId:$p}')" "$u/api/device/report" 2>/dev/null
    u3h="$(curl -s -H "authorization: Bearer $DADM" "$u/api/history?tenant=_u03&correlation=$u3corr" 2>/dev/null)"
    echo "$u3h" | jq -e --arg p "$u3aid" --arg c "$u3corr" '(.count==2) and (([.items[].correlationId]|unique)==[$c]) and (([.items[]|select(.parentRunId==$p)]|length)==1)' >/dev/null 2>&1 && pass "GET /api/history?correlation= -> the correlated run tree (2 events, shared correlationId, child links parent; U03)" || fail "U03 history filter -> $(printf '%s' "$u3h" | jq -c '[.items[]|{id,correlationId,parentRunId}]' 2>/dev/null | head -c 220)"
    u3dh="$(curl -s -H "authorization: Bearer $u3tok" "$u/api/device/history" 2>/dev/null)"
    echo "$u3dh" | jq -e --arg c "$u3corr" '([.items[].correlationId]|index($c))!=null' >/dev/null 2>&1 && pass "GET /api/device/history -> items carry correlationId (U03 surfaced to the device)" || fail "U03 device history -> $(printf '%s' "$u3dh" | jq -c '[.items[]|{correlationId}]' 2>/dev/null | head -c 160)"
    [ -n "$u3id" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$u3id/revoke" >/dev/null 2>&1
    # fire #65 — W08 cross-tenant isolation (golden path "other-tenant can't retrieve"). Seed two
    # tenants with DISTINCT revisions; a device in _isoA must see ONLY _isoA — never _isoB — and its
    # token must not escalate to the admin fleet view. (The device model resolves tenant FROM the token.)
    isobase="$(curl -s "$u/api/environment/current?tenant=_default" 2>/dev/null | jq -r '.markdown' | curl -s -X POST -H 'content-type: text/markdown' --data-binary @- "$u/api/environment/import" 2>/dev/null | jq -c '.blueprint')"
    if [ -n "$isobase" ] && [ "$isobase" != "null" ]; then
      isoAbp="$(printf '%s' "$isobase" | jq -c '.revision="iso-a-1"')"; isoBbp="$(printf '%s' "$isobase" | jq -c '.revision="iso-b-1"')"
      curl -s -o /dev/null -X PUT -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d "$(jq -nc --argjson b "$isoAbp" '{tenant:"_isoA",blueprint:$b}')" "$u/api/environment/current" 2>/dev/null
      curl -s -o /dev/null -X PUT -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d "$(jq -nc --argjson b "$isoBbp" '{tenant:"_isoB",blueprint:$b}')" "$u/api/environment/current" 2>/dev/null
      isoenr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_isoA","label":"iso-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
      isotok="$(printf '%s' "$isoenr" | jq -r '.token // empty')"; isodid="$(printf '%s' "$isoenr" | jq -r '.deviceId // empty')"
      isocur="$(curl -s -H "authorization: Bearer $isotok" "$u/api/device/current" 2>/dev/null)"
      echo "$isocur" | jq -e '.tenant=="_isoA" and .revision=="iso-a-1"' >/dev/null 2>&1 && pass "W08: device/current -> ONLY its own tenant's desired state (_isoA iso-a-1)" || fail "W08 own-tenant -> $(printf '%s' "$isocur" | head -c 160)"
      isowiden="$(curl -s -H "authorization: Bearer $isotok" "$u/api/device/current?tenant=_isoB" 2>/dev/null)"
      echo "$isowiden" | jq -e '.tenant=="_isoA" and .revision=="iso-a-1"' >/dev/null 2>&1 && pass "W08: device/current?tenant=_isoB IGNORED -> still _isoA (no cross-tenant widening via param)" || fail "W08 widen -> $(printf '%s' "$isowiden" | head -c 160)"
      curl -s -o /dev/null -X POST -H "authorization: Bearer $isotok" -H 'content-type: application/json' -d '{"kind":"run","status":"success","summary":"ISO_SECRET_EVENT_65"}' "$u/api/device/report" 2>/dev/null
      isohA="$(curl -s -H "authorization: Bearer $DADM" "$u/api/history?tenant=_isoA&limit=50" 2>/dev/null)"
      isohB="$(curl -s -H "authorization: Bearer $DADM" "$u/api/history?tenant=_isoB&limit=50" 2>/dev/null)"
      { echo "$isohA" | grep -q 'ISO_SECRET_EVENT_65' && ! echo "$isohB" | grep -q 'ISO_SECRET_EVENT_65'; } && pass "W08: device History recorded under _isoA, ABSENT from _isoB (tenant isolation)" || fail "W08 history-leak -> A=$(echo "$isohA"|grep -c ISO_SECRET_EVENT_65) B=$(echo "$isohB"|grep -c ISO_SECRET_EVENT_65)"
      isoesc="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $isotok" "$u/api/devices?tenant=_isoB" 2>/dev/null || echo 000)"
      [ "$isoesc" = 401 ] && pass "W08: device token REJECTED by admin fleet endpoint -> 401 (no privilege escalation)" || fail "W08 escalation -> $isoesc (want 401)"
      [ -n "$isodid" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$isodid/revoke" >/dev/null 2>&1
    else
      fail "W08 setup — could not derive a base blueprint to seed _isoA/_isoB"
    fi
    # Machines inventory (fire #37 / N03·S04): the _test device enrolled above ($did) must appear with a boolean revoked status.
    ad="$(curl -s -H "authorization: Bearer $DADM" "$u/api/devices?tenant=_test&limit=200" 2>/dev/null)"
    echo "$ad" | jq -e --arg d "$did" '.tenant=="_test" and (.count>=1) and ([.items[].deviceId]|index($d)!=null) and (.items[0].revoked|type=="boolean")' >/dev/null 2>&1 && pass "GET /api/devices?tenant (admin) -> enrolled device inventory w/ status (N03/S04)" || fail "admin devices -> $(printf '%s' "$ad" | head -c 160)"
    # N08/U15: did4 reported an 'apply' event above — the inventory must surface its last activity (freshness).
    adf="$(curl -s -H "authorization: Bearer $DADM" "$u/api/devices?tenant=_default&limit=200" 2>/dev/null)"
    echo "$adf" | jq -e --arg d "$did4" '([.items[]|select(.deviceId==$d)]) as $m | ($m|length>=1) and ($m[0].lastKind=="apply") and ($m[0].lastSeen|type=="string")' >/dev/null 2>&1 && pass "GET /api/devices -> per-device last-activity (lastKind=apply + lastSeen) after a report (N08/U15)" || fail "devices freshness -> $(printf '%s' "$adf" | head -c 180)"
    # N08 drift: _default desired revision is r1; did4 applied r1 -> 'current'.
    echo "$adf" | jq -e --arg d "$did4" '(.currentRevision=="r1") and ([.items[]|select(.deviceId==$d)][0].drift=="current")' >/dev/null 2>&1 && pass "GET /api/devices -> drift: device at desired revision reads 'current' (N08)" || fail "drift current -> $(printf '%s' "$adf" | head -c 200)"
    # U11 (#59): separate connectivity / software / backup health. did4 reported an apply at r1 just now.
    echo "$adf" | jq -e --arg d "$did4" '([.items[]|select(.deviceId==$d)][0].health) as $h | ($h.connectivity=="ok") and ($h.software=="current") and ($h.backup=="not_configured")' >/dev/null 2>&1 && pass "GET /api/devices -> health: recent+current device reads connectivity=ok · software=current · backup=not_configured (U11)" || fail "health current -> $(printf '%s' "$adf" | head -c 240)"
    # a freshly-enrolled, never-reported device reads connectivity=never · software=unknown.
    hnenr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_default","label":"health-never"}' "$u/api/devices/enroll" 2>/dev/null)"
    hndid="$(printf '%s' "$hnenr" | jq -r '.deviceId // empty')"
    hnadf="$(curl -s -H "authorization: Bearer $DADM" "$u/api/devices?tenant=_default&limit=500" 2>/dev/null)"
    echo "$hnadf" | jq -e --arg d "$hndid" '([.items[]|select(.deviceId==$d)][0].health) as $h | ($h.connectivity=="never") and ($h.software=="unknown")' >/dev/null 2>&1 && pass "GET /api/devices -> health: never-reported device reads connectivity=never · software=unknown (U11)" || fail "health never -> $(printf '%s' "$hnadf" | head -c 220)"
    [ -n "$hndid" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$hndid/revoke" >/dev/null 2>&1
    # ...and a device that applied an OLDER revision reads 'drifted'.
    drenr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_default","label":"drift-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    drdid="$(printf '%s' "$drenr" | jq -r '.deviceId // empty')"; drtok="$(printf '%s' "$drenr" | jq -r '.token // empty')"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $drtok" -H 'content-type: application/json' -d '{"kind":"apply","status":"success","revision":"r0","summary":"old revision"}' "$u/api/device/report" 2>/dev/null
    add="$(curl -s -H "authorization: Bearer $DADM" "$u/api/devices?tenant=_default&limit=200" 2>/dev/null)"
    echo "$add" | jq -e --arg d "$drdid" '([.items[]|select(.deviceId==$d)][0]) as $m | ($m.drift=="drifted") and ($m.lastRevision=="r0")' >/dev/null 2>&1 && pass "GET /api/devices -> drift: device at older revision reads 'drifted' (r0 vs r1, N08)" || fail "drift drifted -> $(printf '%s' "$add" | head -c 200)"
    echo "$add" | jq -e --arg d "$drdid" '([.items[]|select(.deviceId==$d)][0].health.software)=="drifted"' >/dev/null 2>&1 && pass "GET /api/devices -> health.software=drifted for the behind-revision device (U11)" || fail "health drifted -> $(printf '%s' "$add" | head -c 200)"
    [ -n "$drdid" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$drdid/revoke" >/dev/null 2>&1
    # Recommendations (N03): a drifted device yields a 'drifted' rec (rule-based) naming that device.
    rcenr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_default","label":"recs-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    rcdid="$(printf '%s' "$rcenr" | jq -r '.deviceId // empty')"; rctok="$(printf '%s' "$rcenr" | jq -r '.token // empty')"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $rctok" -H 'content-type: application/json' -d '{"kind":"apply","status":"success","revision":"r0","summary":"old"}' "$u/api/device/report" 2>/dev/null
    recs="$(curl -s -H "authorization: Bearer $DADM" "$u/api/recommendations?tenant=_default" 2>/dev/null)"
    echo "$recs" | jq -e --arg d "$rcdid" '(.generated=="rule-based") and ([.recommendations[]|select(.id=="drifted")][0] as $r | ($r!=null) and ($r.action=="apply") and ([$r.devices[]]|index($d)!=null))' >/dev/null 2>&1 && pass "GET /api/recommendations -> 'drifted' rec names the behind-revision device (N03, rule-based)" || fail "recs drifted -> $(printf '%s' "$recs" | head -c 220)"
    [ -n "$rcdid" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$rcdid/revoke" >/dev/null 2>&1
    # fire #60 — a FAILED last run yields a 'failed_last_run' rec (N03/U09). The most urgent signal — a
    # failed apply/run beats drift. Reuses lastStatus already surfaced by listDevicesWithDrift.
    frenr="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"tenant":"_default","label":"recs-failed-probe"}' "$u/api/devices/enroll" 2>/dev/null)"
    frdid="$(printf '%s' "$frenr" | jq -r '.deviceId // empty')"; frtok="$(printf '%s' "$frenr" | jq -r '.token // empty')"
    curl -s -o /dev/null -X POST -H "authorization: Bearer $frtok" -H 'content-type: application/json' -d '{"kind":"apply","status":"failed","summary":"install failed"}' "$u/api/device/report" 2>/dev/null
    frecs="$(curl -s -H "authorization: Bearer $DADM" "$u/api/recommendations?tenant=_default" 2>/dev/null)"
    echo "$frecs" | jq -e --arg d "$frdid" '([.recommendations[]|select(.id=="failed_last_run")][0] as $r | ($r!=null) and ($r.severity=="warning") and ($r.action=="investigate") and ([$r.devices[]]|index($d)!=null))' >/dev/null 2>&1 && pass "GET /api/recommendations -> 'failed_last_run' rec names the device whose last run FAILED (N03/U09)" || fail "recs failed -> $(printf '%s' "$frecs" | head -c 240)"
    [ -n "$frdid" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$frdid/revoke" >/dev/null 2>&1
    [ -n "$did4" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$did4/revoke" >/dev/null 2>&1

    # pairing: owner approves (admin leg) then the machine claims its token (fire #19 / S04)
    pabog="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d '{"code":"ZZZZZZZZ"}' "$u/api/devices/pair/approve" 2>/dev/null || echo 000)"
    [ "$pabog" = 404 ] && pass "pair/approve (unknown code) -> 404" || fail "pair/approve bogus -> $pabog (want 404)"
    if [ -n "$pcode" ] && [ -n "$psecret" ]; then
      pap="$(curl -s -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d "$(jq -nc --arg c "$pcode" '{code:$c}')" "$u/api/devices/pair/approve" 2>/dev/null)"
      echo "$pap" | jq -e '.status=="approved"' >/dev/null 2>&1 && pass "pair/approve (admin) -> approved" || fail "pair/approve -> $pap"
      pclaim="$(curl -s -H "authorization: Bearer $psecret" "$u/api/devices/pair/poll" 2>/dev/null)"
      ptok="$(printf '%s' "$pclaim" | jq -r '.token // empty')"
      echo "$pclaim" | jq -e '.status=="claimed" and (.token|type=="string") and (.deviceId|type=="string")' >/dev/null 2>&1 && pass "pair/poll (post-approval) -> claimed + one-time device token" || fail "pair/poll claim -> $pclaim"
      pme="$(curl -s -H "authorization: Bearer $ptok" "$u/api/devices/me" 2>/dev/null)"
      echo "$pme" | jq -e '.tenant=="_default"' >/dev/null 2>&1 && pass "paired token works -> devices/me resolves (tenant _default)" || fail "paired me -> $pme"
      prepoll="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $psecret" "$u/api/devices/pair/poll" 2>/dev/null || echo 000)"
      [ "$prepoll" = 410 ] && pass "pair/poll (already claimed) -> 410 (token delivered once)" || fail "pair/poll re-claim -> $prepoll (want 410)"
    else
      fail "pairing setup — start did not return code/pollSecret"
    fi

    # P05 — the GRANTED scope is persisted on the device at claim (not just REQUESTED on the pairing).
    # Full flow with permissions: pair/start(perms) -> approve -> claim -> devices/me + /api/devices surface grantedPermissions.
    p5start="$(curl -s -X POST -H 'content-type: application/json' -d '{"tenant":"_test","label":"p05-scope-host","permissions":["pull-desired-state","report-status"]}' "$u/api/devices/pair/start" 2>/dev/null)"
    p5code="$(printf '%s' "$p5start" | jq -r '.code // empty')"; p5secret="$(printf '%s' "$p5start" | jq -r '.pollSecret // empty')"
    if [ -n "$p5code" ] && [ -n "$p5secret" ]; then
      curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d "$(jq -nc --arg c "$p5code" '{code:$c}')" "$u/api/devices/pair/approve" >/dev/null 2>&1
      p5claim="$(curl -s -H "authorization: Bearer $p5secret" "$u/api/devices/pair/poll" 2>/dev/null)"
      p5tok="$(printf '%s' "$p5claim" | jq -r '.token // empty')"; p5did="$(printf '%s' "$p5claim" | jq -r '.deviceId // empty')"
      p5me="$(curl -s -H "authorization: Bearer $p5tok" "$u/api/devices/me" 2>/dev/null)"
      echo "$p5me" | jq -e '(.grantedPermissions|sort)==["pull-desired-state","report-status"]' >/dev/null 2>&1 && pass "P05 devices/me -> GRANTED scope copied onto the device at claim" || fail "P05 me grant -> $(printf '%s' "$p5me" | head -c 160)"
      p5list="$(curl -s -H "authorization: Bearer $DADM" "$u/api/devices?tenant=_test&limit=200" 2>/dev/null)"
      echo "$p5list" | jq -e --arg d "$p5did" '[.items[]|select(.deviceId==$d)][0].grantedPermissions|sort==["pull-desired-state","report-status"]' >/dev/null 2>&1 && pass "P05 /api/devices -> device carries grantedPermissions (admin sees the grant)" || fail "P05 devices grant -> $(printf '%s' "$p5list" | head -c 200)"
      [ -n "$p5did" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$p5did/revoke" >/dev/null 2>&1
    else
      fail "P05 pairing setup — start did not return code/pollSecret"
    fi

    # P05-enforcement (O12) — the device token's GRANTED scope is ENFORCED per-action. A device granted
    # ONLY report-status CAN report but CANNOT pull desired state (403 insufficient_scope, not 404 — the
    # device IS known, the action isn't granted). An empty-scope (legacy, pre-#53) device is grandfathered.
    p6start="$(curl -s -X POST -H 'content-type: application/json' -d '{"tenant":"_test","label":"p06-scope-enforce","permissions":["report-status"]}' "$u/api/devices/pair/start" 2>/dev/null)"
    p6code="$(printf '%s' "$p6start" | jq -r '.code // empty')"; p6secret="$(printf '%s' "$p6start" | jq -r '.pollSecret // empty')"
    if [ -n "$p6code" ] && [ -n "$p6secret" ]; then
      curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" -H 'content-type: application/json' -d "$(jq -nc --arg c "$p6code" '{code:$c}')" "$u/api/devices/pair/approve" >/dev/null 2>&1
      p6claim="$(curl -s -H "authorization: Bearer $p6secret" "$u/api/devices/pair/poll" 2>/dev/null)"
      p6tok="$(printf '%s' "$p6claim" | jq -r '.token // empty')"; p6did="$(printf '%s' "$p6claim" | jq -r '.deviceId // empty')"
      p6cur="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $p6tok" "$u/api/device/current" 2>/dev/null || echo 000)"
      [ "$p6cur" = 403 ] && pass "P05-enforce: report-only device -> GET /api/device/current 403 (lacks pull-desired-state)" || fail "P05-enforce current -> $p6cur (want 403)"
      p6curb="$(curl -s -H "authorization: Bearer $p6tok" "$u/api/device/current" 2>/dev/null)"
      echo "$p6curb" | jq -e '.error=="insufficient_scope" and .required=="pull-desired-state"' >/dev/null 2>&1 && pass "P05-enforce: 403 body names the required scope (insufficient_scope)" || fail "P05-enforce body -> $(printf '%s' "$p6curb" | head -c 120)"
      p6rep="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "authorization: Bearer $p6tok" -H 'content-type: application/json' -d '{"kind":"check","status":"success","summary":"scope-enforce probe"}' "$u/api/device/report" 2>/dev/null || echo 000)"
      [ "$p6rep" = 201 ] && pass "P05-enforce: report-only device -> POST /api/device/report 201 (report-status granted)" || fail "P05-enforce report -> $p6rep (want 201)"
      [ -n "$p6did" ] && curl -s -o /dev/null -X POST -H "authorization: Bearer $DADM" "$u/api/devices/$p6did/revoke" >/dev/null 2>&1
    else
      fail "P05-enforce pairing setup — start did not return code/pollSecret"
    fi
    # back-compat: an empty-scope (legacy) device is GRANDFATHERED — scope enforcement never 403s it.
    if [ -n "$ptok" ]; then
      p6leg="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $ptok" "$u/api/device/current" 2>/dev/null || echo 000)"
      [ "$p6leg" != 403 ] && pass "P05-enforce: empty-scope (legacy) device grandfathered -> current NOT 403 ($p6leg)" || fail "P05-enforce legacy grandfather -> $p6leg (should NOT be 403)"
    fi
    skip "AID_ADMIN_TOKEN unset — device enroll/me/revoke lifecycle assertions skipped"
  fi

  rm -f "$bpf" "$mdf" "$bpf2"
else
  skip "CONTROL_PLANE_URL unset — prod /health + routing E2E skipped (set after deploy)"
fi

say "control-plane: $P passed, $F failed"
[ "$F" -eq 0 ]
