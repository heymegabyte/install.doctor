#!/usr/bin/env bash
# Regression lock for the inherited-Capacitor site identity-doc cleanup
# (removal-wave-two XS-29 readme + XS-30 CONTRIBUTING + XS-31 Code of Conduct).
#
# The site/ tree was forked from the Capacitor website template and still
# shipped three files that misidentify the project: site/readme.md opens with
# "# Capacitor Site", site/CONTRIBUTING.md tells contributors they are working
# on the Capacitor website, and site/CODE_OF_CONDUCT.md is a generic inherited
# Contributor Covenant copy. Each was read by zero build, workflow, or script,
# so they were source-of-truth lies, not documentation.
#
# This gate locks the REMOVAL while asserting the canonical authorities remain:
# the root README.md (project identity), docs/CONTRIBUTING.md + the published
# docs/contributing/code-of-conduct.md (contributor + conduct policy). Hermetic
# (pure file assertions, no network, no build, no host).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

# A1 — the three inherited Capacitor site docs are gone.
dead_paths=(
  "site/readme.md"
  "site/CONTRIBUTING.md"
  "site/CODE_OF_CONDUCT.md"
)
missing=()
for path in "${dead_paths[@]}"; do
  [ ! -e "$ROOT/$path" ] || missing+=("$path")
done
if [ "${#missing[@]}" -eq 0 ]; then
  pass "inherited Capacitor site docs removed (${#dead_paths[@]} paths absent)"
else
  fail "inherited Capacitor site doc restored: ${missing[*]}"
fi

# A2 — source of truth preserved: canonical project/contributor/conduct docs.
canonical=(
  "README.md"
  "docs/CONTRIBUTING.md"
  "docs/contributing/code-of-conduct.md"
  "docs/contributing/index.md"
)
gone=()
for path in "${canonical[@]}"; do
  [ -f "$ROOT/$path" ] || gone+=("$path")
done
if [ "${#gone[@]}" -eq 0 ]; then
  pass "canonical project/contributor/conduct docs preserved (${#canonical[@]} paths)"
else
  fail "canonical doc missing (authority removed by accident): ${gone[*]}"
fi

# A3 — no live code/doc re-references the deleted paths (path-only grep, never
#      values; excludes this gate, which necessarily names the paths it locks).
identity_refs="$(git -C "$ROOT" grep -nE \
  'site/readme\.md|site/CONTRIBUTING\.md|site/CODE_OF_CONDUCT\.md' \
  -- scripts docs site .github 2>/dev/null || true)"
identity_refs="$(printf '%s\n' "$identity_refs" | grep -v '^scripts/test-inherited-capacitor-site-docs\.sh:' || true)"
if [ -z "$identity_refs" ]; then
  pass "no active reference to the deleted Capacitor site docs"
else
  printf '%s\n' "$identity_refs" >&2
  fail "dangling reference to a deleted Capacitor site doc remains"
fi

# A4 — non-vacuous self-test: plant a fixture, re-run the same detector, remove it.
planted="$ROOT/site/CODE_OF_CONDUCT.md"
printf '# Contributor Covenant Code of Conduct\n' > "$planted"
if [ -e "$planted" ]; then
  hit=0
  for path in "${dead_paths[@]}"; do
    [ ! -e "$ROOT/$path" ] || hit=1
  done
  rm -f "$planted"
  if [ "$hit" -eq 1 ]; then
    pass "self-test: planted site/CODE_OF_CONDUCT.md fixture was detected"
  else
    fail "self-test: planted fixture was NOT detected (guard is vacuous)"
  fi
else
  fail "self-test: could not plant site/CODE_OF_CONDUCT.md fixture"
fi

printf 'inherited-capacitor-site-docs: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
