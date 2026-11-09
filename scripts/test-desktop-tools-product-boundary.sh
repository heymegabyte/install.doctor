#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOUNDARY="$ROOT/docs/desktop-tools/README.md"
CORE="$ROOT/packages/aid-core/README.md"
SPEC="$ROOT/packages/aid-core/docs/PRODUCT-SPEC.md"
STATUS="$ROOT/docs/desktop-tools/status.md"
PROVISION="$ROOT/home/dot_local/bin/executable_provision"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*"; F=$((F + 1)); }

for file in "$BOUNDARY" "$CORE" "$SPEC" "$STATUS"; do
  if [ -s "$file" ]; then pass "$(basename "$file") exists"; else fail "$file is missing"; fi
done

if grep -Fq 'Desktop Tools is the product' "$BOUNDARY" \
  && grep -Fq 'curl -fsSL https://example.desktop.tools | bash' "$BOUNDARY"; then
  pass 'boundary names one product and the profile-subdomain entrypoint'
else
  fail 'boundary does not define Desktop Tools and its entrypoint'
fi

if grep -Fq 'Install Doctor is the repository and historical provisioning' "$BOUNDARY" \
  && grep -Fq 'not a parallel product' "$BOUNDARY"; then
  pass 'historical attribution is preserved without a second product'
else
  fail 'historical attribution or single-product boundary is missing'
fi

retired='The product target is `app\.install\.doctor`|The web app is app\.install\.doctor|future OpenCode-derived executable is named `aid`|intended OpenCode-derived executable is aid|Deployed at app\.install\.doctor|\*\*aid runtime\*\*|Built \+ verified \(live on app\.install\.doctor|curl -fsSL https://app\.install\.doctor/start|Render a real local PTY running aid|automatically configured aid|Every aid launch'
if grep -Eqi "$retired" "$ROOT/README.md" "$CORE" "$SPEC"; then
  fail 'canonical package docs reintroduce the retired two-product architecture'
else
  pass 'canonical package docs reject the retired two-product architecture'
fi

if grep -Fq '`app.install.doctor` remains a compatibility implementation' "$ROOT/README.md" \
  && grep -Fq 'is a bounded compatibility alias' "$SPEC"; then
  pass 'legacy runtime names appear only as explicit compatibility attribution'
else
  fail 'compatibility attribution for legacy runtime names is missing'
fi

if grep -Fq 'Generated from packages/aid-core/src/product-identity.ts' "$STATUS" \
  && grep -Fq '/api/v1/product-status' "$BOUNDARY"; then
  pass 'documentation and hosted status share canonical product truth'
else
  fail 'product truth is not linked to the generated registry'
fi

if grep -Fq 'contract-only' "$BOUNDARY" && grep -Fq 'production proof' "$BOUNDARY"; then
  pass 'unintegrated behavior is explicitly distinguished from shipped behavior'
else
  fail 'capability evidence boundary is absent'
fi

for lifecycle in 'Create' 'Export and standalone recovery' 'Disable' 'Recover'; do
  grep -Fq "**$lifecycle**" "$BOUNDARY" \
    && pass "profile lifecycle documents $lifecycle" \
    || fail "profile lifecycle omits $lifecycle"
done

if grep -Fq 'https://example.desktop.tools/.well-known/desktop-tools-profile.json' "$BOUNDARY" \
  && grep -Fq 'Sharing that URL grants no enrollment, secret, fleet, or mutation authority' "$BOUNDARY" \
  && grep -Fq 'must not substitute the hosted current revision' "$BOUNDARY"; then
  pass 'profile descriptor, non-authority, and standalone recovery boundaries are documented'
else
  fail 'profile descriptor or recovery boundary is incomplete'
fi

if grep -Eq 'curl.*https://(app\.install\.doctor|install\.doctor|desktop\.tools)(/start)?[ |]' "$BOUNDARY"; then
  fail 'Desktop Tools lifecycle publishes a non-profile curl command'
else
  pass 'every Desktop Tools lifecycle curl command uses an explicit profile subdomain'
fi

if grep -Fq 'https://${profile_slug}.desktop.tools/' "$PROVISION" \
  && ! grep -Fq 'app.install.doctor/start' "$PROVISION" \
  && ! grep -Fq 'warp-cli disconnect' "$PROVISION" \
  && bash -n "$PROVISION"; then
  pass 'installed provision helper uses the profile root without changing network state'
else
  fail 'installed provision helper bypasses Desktop Tools or mutates network state'
fi

printf 'desktop-tools product boundary: %s passed, %s failed\n' "$P" "$F"
[ "$F" -eq 0 ]
