#!/usr/bin/env bash
# O14 / web-security baseline — the control plane handles an admin token (and soon Better Auth sessions),
# so every response carries a Content-Security-Policy + Permissions-Policy. CF-zone already sets HSTS /
# X-Frame-Options / nosniff / Referrer-Policy; this adds the CSP (anti-clickjacking via frame-ancestors,
# anti-base-injection via base-uri, object-src none, form-action self) + Permissions-Policy at the Worker.
# The dashboard uses inline <script>/<style>, so script/style are 'unsafe-inline' (honest, no per-request
# nonces) — but the inline JS is therefore NOT blocked (verified: pages still render).
# #107 completes the cross-origin header baseline: Cross-Origin-Opener-Policy (same-origin-allow-popups —
# isolates the browsing context while keeping future OAuth popups working) + Cross-Origin-Resource-Policy
# (same-origin — this worker's responses can't be hot-linked as a no-cors subresource cross-origin; CORS
# fetch + the server-to-server aid CLI are unaffected). COEP require-corp is DELIBERATELY omitted: zero
# cross-origin subresources today (no benefit) + it would break future legit embeds (Maps/R2 images).
set -uo pipefail
u="${CONTROL_PLANE_URL:-https://app.install.doctor}"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

say "security headers (O14) @ $u"

hdr() { curl -sS -D - -o /dev/null "$1" 2>/dev/null | tr -d '\r'; }

H="$(hdr "$u/")"
csp="$(printf '%s' "$H" | grep -i '^content-security-policy:' | head -1)"
# 1. CSP present on the landing page with the locked directives.
{ printf '%s' "$csp" | grep -qi "frame-ancestors 'none'" && printf '%s' "$csp" | grep -qi "object-src 'none'" && printf '%s' "$csp" | grep -qi "base-uri 'self'" && printf '%s' "$csp" | grep -qi "form-action 'self'"; } && pass "GET / -> CSP with frame-ancestors 'none' + object-src 'none' + base-uri 'self' + form-action 'self' (O14)" || fail "landing CSP -> $(printf '%s' "$csp" | head -c 200)"
# 2. CSP keeps script/style 'unsafe-inline' (so the inline dashboard JS/CSS is NOT broken by the policy).
{ printf '%s' "$csp" | grep -qi "script-src[^;]*'unsafe-inline'" && printf '%s' "$csp" | grep -qi "style-src[^;]*'unsafe-inline'"; } && pass "CSP allows inline script+style ('unsafe-inline') — dashboard inline JS/CSS intact (honest)" || fail "CSP would break inline JS/CSS -> $(printf '%s' "$csp" | head -c 200)"
# 3. Permissions-Policy present (locks camera/mic/geolocation — the dashboard needs none).
printf '%s' "$H" | grep -qi '^permissions-policy:' && pass "GET / -> Permissions-Policy present (locks unused powerful features)" || fail "no Permissions-Policy on /"
# 4. The CSP is global — also on a dashboard page + an API JSON response.
printf '%s' "$(hdr "$u/machines")" | grep -qi '^content-security-policy:' && pass "GET /machines -> CSP present (global middleware)" || fail "no CSP on /machines"
printf '%s' "$(hdr "$u/api/catalog?limit=1")" | grep -qi '^content-security-policy:' && pass "GET /api/catalog -> CSP present on API responses too" || fail "no CSP on the API"
# 5. Sanity: the page still RENDERS (CSP didn't break the response) — body has the landing content.
curl -sS "$u/" 2>/dev/null | grep -qi 'install.doctor' && pass "GET / still renders its content under the CSP (not broken)" || fail "landing body empty/broken under CSP"
# 6. Cross-Origin-Opener-Policy on / (same-origin[-allow-popups] — isolates the browsing context; #107).
coop="$(printf '%s' "$H" | grep -i '^cross-origin-opener-policy:' | head -1)"
printf '%s' "$coop" | grep -qi 'same-origin' && pass "GET / -> Cross-Origin-Opener-Policy same-origin (browsing-context isolation; #107)" || fail "no/weak COOP on / -> $(printf '%s' "$coop" | head -c 120)"
# 7. Cross-Origin-Resource-Policy on / (same-origin — no cross-origin no-cors hot-linking; #107).
corp="$(printf '%s' "$H" | grep -i '^cross-origin-resource-policy:' | head -1)"
printf '%s' "$corp" | grep -qi 'same-origin' && pass "GET / -> Cross-Origin-Resource-Policy same-origin (no cross-origin resource inclusion; #107)" || fail "no CORP on / -> $(printf '%s' "$corp" | head -c 120)"
# 8. COOP + CORP are global too (same middleware) — assert on an API JSON response.
HA="$(hdr "$u/api/catalog?limit=1")"
{ printf '%s' "$HA" | grep -qi '^cross-origin-opener-policy:' && printf '%s' "$HA" | grep -qi '^cross-origin-resource-policy:'; } && pass "GET /api/catalog -> COOP + CORP present on API responses too (global)" || fail "COOP/CORP missing on the API"
# 9. Cache-Control: no-store on a SENSITIVE tenant-scoped response (#109) — device/history data must not sit in
#    a shared proxy/browser cache. The header is set by the middleware regardless of the auth outcome, so an
#    unauthed 401 still carries it (we assert the header, not the body).
cc_hist="$(hdr "$u/api/history?tenant=_default" | grep -i '^cache-control:' | head -1)"
printf '%s' "$cc_hist" | grep -qi 'no-store' && pass "GET /api/history -> Cache-Control: no-store (tenant data not shared-cacheable; #109)" || fail "no Cache-Control:no-store on /api/history -> $(printf '%s' "$cc_hist" | head -c 120)"
# 10. Session state is not cacheable either.
cc_sess="$(hdr "$u/api/auth/get-session" | grep -i '^cache-control:' | head -1)"
printf '%s' "$cc_sess" | grep -qi 'no-store' && pass "GET /api/auth/get-session -> Cache-Control: no-store (session state not cached; #109)" || fail "no Cache-Control:no-store on get-session -> $(printf '%s' "$cc_sess" | head -c 120)"
# 11. The no-store default is GLOBAL (a dashboard page gets it too, since no handler opts into caching).
cc_pg="$(printf '%s' "$(hdr "$u/machines")" | grep -i '^cache-control:' | head -1)"
printf '%s' "$cc_pg" | grep -qi 'no-store' && pass "GET /machines -> Cache-Control: no-store (global safe default)" || fail "no Cache-Control:no-store on /machines -> $(printf '%s' "$cc_pg" | head -c 120)"
# 12-18. strict-CSP STEP 1 COMPLETE (#117-#121) — toward dropping script-src 'unsafe-inline': inline on*= handlers are
#   blocked even with a nonce, so each page's handlers were converted to addEventListener (a few pages/fire). ALL 7
#   dashboard pages (login/recommendations/pair #117 + apps #118 + environment #119 + history #120 + machines #121)
#   are now FULLY inline-handler-free. (apps' & environment's handlers were STATIC fixed buttons — simple
#   addEventListener; apps/history/machines' DYNAMIC per-row buttons use EVENT DELEGATION: data-act/data-id attrs +
#   one container listener reading e.target.closest('[data-act]').) → STEP 2 (nonce/hash the <script> blocks + drop
#   script-src 'unsafe-inline') is now UNBLOCKED (all pages handler-free).
# Match ONLY inline HTML attributes `on*="…"` (the real CSP concern, blocked even with a nonce) — NOT JS
# property assignments like `b.onclick=fn` (the shared chrome's forget-token/sign-out, which are CSP-SAFE).
# The opening double-quote after `=` is the discriminator: inline attrs are `onclick="…"`, assignments are `.onclick=fn`.
for pg in login recommendations pair apps environment history machines; do
  body="$(curl -sS "$u/$pg" 2>/dev/null)"
  if printf '%s' "$body" | grep -qE 'on(click|input|change|submit)="'; then
    fail "/$pg still has inline on*=\"…\" handler(s) -> $(printf '%s' "$body" | grep -oE 'on(click|input|change|submit)="' | sort -u | tr '\n' ' ')"
  else
    pass "/$pg -> 0 inline on*=\"…\" handlers (CSP STEP-1 #117 — converted to addEventListener; JS .onclick= assignments are CSP-safe)"
  fi
done
# the buttons are still WIRED (addEventListener present) — interactivity preserved after the conversion.
curl -sS "$u/login" 2>/dev/null | grep -q "addEventListener('click'" && pass "/login -> sign-in buttons wired via addEventListener (interactivity preserved, not just removed)" || fail "/login addEventListener wiring missing"
# #117 spillover — the Google button (class=cta2) must have a transparent bg, else the base `button{background:#00E5FF}`
# + cta2's cyan TEXT render cyan-on-cyan (invisible). Real-browser-caught during the STEP-1 verification.
curl -sS "$u/login" 2>/dev/null | grep -qE '\.cta2\{[^}]*background:transparent' && pass "/login -> .cta2 transparent bg (Google button text readable, not cyan-on-cyan; #117 spillover)" || fail "/login .cta2 missing transparent bg (invisible button text)"
# #118 — the /apps search box + platform filter stay WIRED after the oninput/onchange → addEventListener conversion.
curl -sS "$u/apps" 2>/dev/null | grep -q "addEventListener('input'" && pass "/apps -> search box wired via addEventListener (interactivity preserved after #118 conversion)" || fail "/apps addEventListener('input') wiring missing"
# #119 — the /environment Load + Diff buttons stay WIRED after the onclick → addEventListener conversion.
curl -sS "$u/environment" 2>/dev/null | grep -q "addEventListener('click',diffProposed)" && pass "/environment -> Load+Diff buttons wired via addEventListener (interactivity preserved after #119 conversion)" || fail "/environment addEventListener('click',diffProposed) wiring missing"
# #120 — /history's dynamic per-row run-filter + clear buttons stay WIRED via EVENT DELEGATION (data-act on #out).
curl -sS "$u/history" 2>/dev/null | grep -qF "closest('[data-act]')" && pass "/history -> dynamic row/filter buttons wired via event delegation (closest('[data-act]') on #out; #120)" || fail "/history event-delegation wiring (closest('[data-act]')) missing"
# #121 — /machines' dynamic per-row detail + support-bundle + download buttons stay WIRED via EVENT DELEGATION
# (data-act on #out for detail, on #detail for bundle/dlbundle). This COMPLETES STEP 1: all 7 pages handler-free.
mb="$(curl -sS "$u/machines" 2>/dev/null)"
{ printf '%s' "$mb" | grep -qF "closest('[data-act]')" && printf '%s' "$mb" | grep -qF 'data-act="detail"' && printf '%s' "$mb" | grep -qF 'data-act="bundle"'; } && pass "/machines -> detail/bundle/download buttons wired via event delegation (closest('[data-act]') on #out + #detail; #121 — STEP 1 COMPLETE, all 7 pages handler-free)" || fail "/machines event-delegation wiring missing (closest('[data-act]') + data-act=detail/bundle)"

say "security-headers: $P passed, $F failed"
[ "$F" -eq 0 ]
