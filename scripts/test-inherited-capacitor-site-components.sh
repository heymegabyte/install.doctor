#!/usr/bin/env bash
# Regression lock for the inherited-Capacitor site component/artifacts cleanup
# (removal-wave-two XS-26 page library + XS-27 DocsCard/DocsCards + XS-28 TODO +
# XS-32 Front Matter CMS config).
#
# The site/docs tree was forked from the Capacitor website template and still
# shipped a 31-file page/ component library, two unused DocsCard/DocsCards
# global components, a one-line Docusaurus TODO, and a ~2 MB Front Matter CMS
# editor config + database (site/frontmatter.json + site/.frontmatter). None
# were imported by any MDX page, Docusaurus theme, or config — the only live
# consumers are @components/global/DocDemo (used by the DocItem theme) and the
# MDXComponents table override. Keeping the dead set made the tree look like a
# component system that does not exist.
#
# This gate locks the REMOVAL while asserting the live pieces survive: DocDemo
# (and its device skins), the MDXComponents theme override, and the docs build
# config. Hermetic (pure file assertions, no network, no build, no host).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

# A1 — the inherited Capacitor site components + CMS artifacts are gone.
dead_paths=(
  "site/docs/src/components/page"
  "site/docs/src/components/global/DocsCard"
  "site/docs/src/components/global/DocsCards"
  "site/docs/src/components/global/Codepen"
  "site/docs/src/components/README.md"
  "site/docs/src/utils/hooks.ts"
  "site/docs/src/utils/README.md"
  "site/docs/TODO.md"
  "site/frontmatter.json"
  "site/.frontmatter"
)
missing=()
for path in "${dead_paths[@]}"; do
  if [ -d "$ROOT/$path" ]; then
    [ -z "$(find "$ROOT/$path" -type f -print -quit)" ] || missing+=("$path")
  else
    [ ! -e "$ROOT/$path" ] || missing+=("$path")
  fi
done
if [ "${#missing[@]}" -eq 0 ]; then
  pass "inherited Capacitor site components + CMS artifacts removed (${#dead_paths[@]} paths absent)"
else
  fail "inherited Capacitor site component restored: ${missing[*]}"
fi

# A2 — live pieces preserved: DocDemo (+ skins) and the MDXComponents theme override.
live=(
  "site/docs/src/components/global/DocDemo/index.js"
  "site/docs/src/components/global/DocDemo/iphone-device-skin.png"
  "site/docs/src/components/global/DocDemo/android-device-skin.png"
  "site/docs/src/theme/MDXComponents/index.tsx"
  "site/docs/src/theme/DocItem/index.tsx"
)
gone=()
for path in "${live[@]}"; do
  [ -f "$ROOT/$path" ] || gone+=("$path")
done
if [ "${#gone[@]}" -eq 0 ]; then
  pass "live DocDemo + MDXComponents/DocItem theme preserved (${#live[@]} paths)"
else
  fail "live docs component removed by accident: ${gone[*]}"
fi

# A3 — no live code/doc re-references the deleted paths (path-only grep, never
#      values; excludes this gate, which necessarily names the paths it locks).
comp_refs="$(git -C "$ROOT" grep -nE \
  'components/page|components/global/DocsCard|components/global/DocsCards|components/global/Codepen|src/utils/hooks|site/docs/TODO\.md|frontmatter\.json|\.frontmatter' \
  -- site/docs/src site/docs/docusaurus.config.js site/docs/package.json 2>/dev/null || true)"
comp_refs="$(printf '%s\n' "$comp_refs" | grep -v '^scripts/test-inherited-capacitor-site-components\.sh:' || true)"
if [ -z "$comp_refs" ]; then
  pass "no active reference to the deleted Capacitor site components/artifacts"
else
  printf '%s\n' "$comp_refs" >&2
  fail "dangling reference to a deleted Capacitor site component remains"
fi

# A4 — non-vacuous self-test: plant a fixture, re-run the same detector, remove it.
planted="$ROOT/site/frontmatter.json"
printf '{\n  "frontmatter.website.contentTypes": []\n}\n' > "$planted"
if [ -e "$planted" ]; then
  hit=0
  for path in "${dead_paths[@]}"; do
    if [ -d "$ROOT/$path" ]; then
      [ -z "$(find "$ROOT/$path" -type f -print -quit)" ] || hit=1
    else
      [ ! -e "$ROOT/$path" ] || hit=1
    fi
  done
  rm -f "$planted"
  if [ "$hit" -eq 1 ]; then
    pass "self-test: planted site/frontmatter.json fixture was detected"
  else
    fail "self-test: planted fixture was NOT detected (guard is vacuous)"
  fi
else
  fail "self-test: could not plant site/frontmatter.json fixture"
fi

printf 'inherited-capacitor-site-components: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
