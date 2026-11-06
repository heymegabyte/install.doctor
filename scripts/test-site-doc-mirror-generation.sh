#!/usr/bin/env bash
# Proves the ignored Docusaurus docs tree is generated from the repository's
# canonical docs without cloning or pulling another checkout.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GENERATOR="$ROOT/site/docs/scripts/markdown.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS %s\n' "$*"; }

bash -n "$GENERATOR" || fail "markdown generator has invalid shell syntax"
if grep -Eq 'git (clone|pull)|rm -rf ["'\'']?install\.doctor' "$GENERATOR"; then
  fail "markdown generator still mutates or fetches a second checkout"
fi
pass "markdown generator uses the current source checkout"

grep -Fq 'TASKS="$(NO_COLOR=1 task --list)"' "$GENERATOR" \
  || fail "task documentation discovery does not disable terminal styling"
grep -Fq "printf '%s\\n' \"\$TASKS\" | while IFS= read -r LINE" "$GENERATOR" \
  || fail "task documentation discovery reparses a decorated command stream"
pass "task documentation discovery uses one undecorated machine-readable stream"

grep -Fq "JSON.stringify(process.argv[1])" "$GENERATOR" \
  || fail "generated frontmatter scalars are not safely encoded"
grep -Fq 'Generated reference for $(basename "$SCRIPT")' "$GENERATOR" \
  || fail "scripts without shdoc metadata have no deterministic fallback"
pass "generated frontmatter is encoded and has deterministic fallbacks"

DOCS_SITE_ROOT="$TMP/site" INSTALL_DOCTOR_ROOT="$ROOT" MARKDOWN_COPY_ONLY=1 \
  bash "$GENERATOR" || fail "copy-only generation failed"

canonical=(
  "advanced/installer.md"
  "aid/CURRENT-STATE.md"
  "aid/decisions/0001-shell-history-hishtory-over-atuin.md"
  "architecture/server-ingress-ownership.md"
  "audits/2026-11-02-fleet-installer-convergence.md"
)
for relative in "${canonical[@]}"; do
  cmp -s "$ROOT/docs/$relative" "$TMP/site/docs/$relative" \
    || fail "generated mirror differs from canonical docs/$relative"
done
pass "canonical docs regenerate byte-for-byte in an isolated output tree"

if git -C "$ROOT" ls-files 'site/docs/docs/**' | grep -q .; then
  fail "generated Docusaurus markdown is still committed"
fi
pass "generated Docusaurus markdown is not tracked as a second authority"
