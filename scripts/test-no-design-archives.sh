#!/usr/bin/env bash
# scripts/test-no-design-archives.sh — Design-tool archive guard (removal wave two, XS-25).
#
# site/assets/app-mockup.mockup was a 28 MB (29,432,473-byte) design-tool archive — the single largest
# tracked file in the repo — with ZERO references in site/src, site/docs, stencil.config.ts, or any
# build/config path. Design-tool archives (.mockup/.sketch/.fig/.xd) are editor-specific binary blobs
# that the Stencil+Firebase site can never serve or import, so shipping one is pure clone bloat (every
# clone/fetch pays the full 28 MB forever) and a source-of-truth lie (a build-irrelevant blob tracked as
# a site asset). This guard asserts: (1) the specific 28 MB blob is gone, (2) no design-tool archive of
# any kind ships anywhere in the tree, and (3) no site build path still references the deleted blob. The
# detector is re-run against a planted fixture in a temp dir to prove it is non-vacuous. Pure file
# assertions, no network, no secret values.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

# The detector under test: echo the design-tool archive paths physically present under $1, pruning the
# .git index, node_modules, and .agent evidence (so only shipped source/assets are scanned).
find_design_archives() {
  find "$1" \
    \( -path '*/.git' -o -path '*/node_modules' -o -path '*/.agent' \) -prune -o \
    \( -name '*.mockup' -o -name '*.sketch' -o -name '*.fig' -o -name '*.xd' \) -type f -print 2>/dev/null
}

say "no-design-archives guard (site/assets/app-mockup.mockup + the .mockup/.sketch/.fig/.xd class)"

# 1. The specific 28 MB dead blob must not ship.
if [ -e "$ROOT/site/assets/app-mockup.mockup" ]; then
  fail "the 28 MB dead design blob site/assets/app-mockup.mockup still ships (zero references — clone bloat + source-of-truth lie)"
else
  pass "the 28 MB dead design blob site/assets/app-mockup.mockup is removed"
fi

# 2. No design-tool archive of any kind may ship anywhere in the tree.
archives="$(find_design_archives "$ROOT")"
if [ -z "$archives" ]; then
  pass "no design-tool archive ships anywhere in the tree (.mockup/.sketch/.fig/.xd)"
else
  fail "design-tool archive(s) still ship (path only):$archives"
fi

# 3. The site build must not reference the deleted blob (a stale import/asset mapping would resurrect
#    the 28 MB blob or its class).
ref=""
for f in site/stencil.config.ts site/src site/docs/docusaurus.config.js; do
  [ -e "$f" ] || continue
  grep -rlF 'app-mockup' "$f" >/dev/null 2>&1 && ref="$ref $f"
done
if [ -z "$ref" ]; then
  pass "no site build path references the deleted app-mockup blob"
else
  fail "a site build path still references the deleted app-mockup blob:$ref"
fi

# 4. Non-vacuous self-test: plant a .mockup fixture in a temp dir and re-run the SAME detector. It must
#    flag the fixture, proving the clean-tree pass above was a real check and not a vacuous find.
tmp="$(mktemp -d)"
printf 'mockup-bytes' > "$tmp/planted.mockup"
planted="$(find_design_archives "$tmp")"
rm -rf "$tmp"
if printf '%s' "$planted" | grep -q 'planted.mockup'; then
  pass "detector flags a planted .mockup fixture (non-vacuous)"
else
  fail "detector missed a planted .mockup fixture — the archive check is vacuous"
fi

say "no-design-archives: $P passed, $F failed"
[ "$F" -eq 0 ]
