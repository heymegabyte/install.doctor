#!/usr/bin/env bash
# Catalog policy invariants that keep automatic provisioning deterministic.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOFTWARE="$ROOT/software.yml"
GENERATED="$ROOT/packages/control-plane/src/catalog.json"
CONTROL="$ROOT/packages/control-plane/src/index.ts"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if ! command -v yq >/dev/null 2>&1; then
  fail "yq is required"
else
  disabled_preloads="$(yq -r '.softwarePackages | to_entries[] | select(.value._preload == true and .value._default == false) | .key' "$SOFTWARE")"
  deprecated_preloads="$(yq -r '.softwarePackages | to_entries[] | select(.value._preload == true and (.value | has("_deprecated"))) | .key' "$SOFTWARE")"
  recipe_less_preloads="$(yq -r '
    .softwarePackages | to_entries[] |
    select(.value._preload == true) |
    select(([.value | keys[] | select(test("^(apk|apt|dnf|pacman|zypper|flatpak|snap|brew|cask|go|cargo|npm|pip|pipx|gem|appimage|script|binary|choco|scoop|winget|yay|pkg|mas|github|docker|rustup|helm)(:|$)"))] | length) == 0) |
    .key
  ' "$SOFTWARE")"

  [ -z "$disabled_preloads" ] && pass "disabled packages cannot preload" || fail "disabled packages preload: $disabled_preloads"
  [ -z "$deprecated_preloads" ] && pass "deprecated packages cannot preload" || fail "deprecated packages preload: $deprecated_preloads"
  [ -z "$recipe_less_preloads" ] && pass "every preload has an install recipe" || fail "preloads without recipes: $recipe_less_preloads"

  replacement="$(yq -r '.softwarePackages.poetry._replacement' "$SOFTWARE")"
  [ "$replacement" = "uv" ] && pass "Poetry names uv as its migration target" || fail "Poetry replacement must be uv (found: $replacement)"

  if jq -e '.[] | select(.name == "poetry" and .replacement == "uv")' "$GENERATED" >/dev/null; then
    pass "generated catalog preserves structured replacement metadata"
  else
    fail "generated catalog must expose Poetry's uv replacement"
  fi
fi

for contract in \
  'pipx: (p) => `uv tool install ${p}`' \
  'pipx: (p) => `uv tool upgrade ${p}`' \
  'pipx: (p) => `uv tool uninstall ${p}`' \
  'replacement: e.replacement'; do
  if grep -Fq "$contract" "$CONTROL"; then
    pass "control-plane exposes the canonical contract: $contract"
  else
    fail "control-plane contract is stale or missing: $contract"
  fi
done

printf 'catalog-policy-invariants: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
