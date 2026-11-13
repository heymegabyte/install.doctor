#!/usr/bin/env bash
# Regression gate for GitHub issue #172 / MEG-97:
# Ensures `site/` builds cross-platform on Windows, macOS, and Linux without
# requiring `core.symlinks=true`, prebuilt `site/docs/build`, or POSIX shell
# commands in `package.json` scripts.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STENCIL_CFG="$ROOT/site/stencil.config.ts"
SITE_PKG="$ROOT/site/package.json"
DOCS_PKG="$ROOT/site/docs/package.json"
NOSCRIPT_MJS="$ROOT/site/scripts/build-noscript.mjs"
GEN_DOCS_MJS="$ROOT/site/docs/scripts/generate-plugin-docs.mjs"
PREBUILD_MJS="$ROOT/site/docs/scripts/prebuild.mjs"
WIN_WF="$ROOT/.github/workflows/site-build.yml"

P=0
F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

# 1. Stencil config avoids POSIX symlink `style.scss` and guards optional `../docs/build`
if [ -f "$STENCIL_CFG" ]; then
  if grep -q 'style\.scss' "$STENCIL_CFG"; then
    fail "site/stencil.config.ts still references symlinked style.scss (breaks Windows core.symlinks=false)"
  else
    pass "site/stencil.config.ts does not depend on symlinked style.scss"
  fi

  if grep -q 'style-offline\.scss' "$STENCIL_CFG" && grep -q 'style-default\.scss' "$STENCIL_CFG" && grep -q 'SITE_NOSCRIPT' "$STENCIL_CFG"; then
    pass "site/stencil.config.ts selects style-offline.scss / style-default.scss via SITE_NOSCRIPT"
  else
    fail "site/stencil.config.ts missing SITE_NOSCRIPT style selector"
  fi

  if grep -q "existsSync(join(__dirname, 'docs', 'build'))" "$STENCIL_CFG"; then
    pass "site/stencil.config.ts guards ../docs/build copy target with existsSync"
  else
    fail "site/stencil.config.ts does not guard ../docs/build copy target with existsSync"
  fi
else
  fail "site/stencil.config.ts missing"
fi

# 2. site/package.json build:noscript uses cross-platform Node wrapper
if [ -f "$SITE_PKG" ]; then
  noscript_cmd="$(node -e 'const pkg = require(process.argv[1]); process.stdout.write(pkg.scripts?.["build:noscript"] ?? "");' "$SITE_PKG")"
  if [ "$noscript_cmd" = "node scripts/build-noscript.mjs" ]; then
    pass "site/package.json build:noscript uses cross-platform Node script"
  else
    fail "site/package.json build:noscript is not 'node scripts/build-noscript.mjs' (got: $noscript_cmd)"
  fi

  if printf '%s' "$noscript_cmd" | grep -qE '(^|[[:space:]])(rm|ln|cp)([[:space:]]|$)'; then
    fail "site/package.json build:noscript still invokes POSIX file utilities"
  else
    pass "site/package.json build:noscript contains zero POSIX rm/ln/cp commands"
  fi
else
  fail "site/package.json missing"
fi

if [ -f "$NOSCRIPT_MJS" ] && node --check "$NOSCRIPT_MJS" >/dev/null 2>&1; then
  pass "site/scripts/build-noscript.mjs exists and passes syntax check"
else
  fail "site/scripts/build-noscript.mjs missing or invalid ESM syntax"
fi

# 3. site/docs/package.json scripts are cross-platform and aligned on supported Volta Node
if [ -f "$DOCS_PKG" ]; then
  docs_check="$(node -e '
    const pkg = require(process.argv[1]);
    const s = pkg.scripts || {};
    const voltaMajor = Number(String(pkg.volta?.node || "0").split(".")[0]);
    const ok =
      s.prebuild === "node scripts/prebuild.mjs" &&
      s["generate-plugin-docs"] === "node scripts/generate-plugin-docs.mjs" &&
      s.prestart === "node scripts/generate-plugin-docs.mjs" &&
      voltaMajor >= 18;
    process.stdout.write(ok ? "ok" : JSON.stringify({ prebuild: s.prebuild, gen: s["generate-plugin-docs"], prestart: s.prestart, volta: pkg.volta }));
  ' "$DOCS_PKG")"
  if [ "$docs_check" = "ok" ]; then
    pass "site/docs/package.json uses cross-platform Node scripts and supported Volta Node >= 18"
  else
    fail "site/docs/package.json cross-platform script/Volta check failed: $docs_check"
  fi
else
  fail "site/docs/package.json missing"
fi

for script_file in "$GEN_DOCS_MJS" "$PREBUILD_MJS"; do
  if [ -f "$script_file" ] && node --check "$script_file" >/dev/null 2>&1; then
    pass "${script_file#"$ROOT/"} exists and passes syntax check"
  else
    fail "${script_file#"$ROOT/"} missing or invalid ESM syntax"
  fi
done

# 4. Hermetic portable fallback execution without bash/rsync/shdoc/task on PATH
if [ -f "$GEN_DOCS_MJS" ]; then
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  mkdir -p "$TMP_DIR/site/docs"
  printf 'preserve-image\n' > "$TMP_DIR/site/docs/keep.png"
  printf 'stale-doc\n' > "$TMP_DIR/site/docs/stale.md"

  NODE_BIN="$(command -v node)"
  NODE_DIR="$(dirname "$NODE_BIN")"

  if env -i \
    HOME="${HOME:-/tmp}" \
    PATH="$NODE_DIR" \
    FORCE_PORTABLE_DOCS_MIRROR=1 \
    DOCS_SITE_ROOT="$TMP_DIR/site" \
    INSTALL_DOCTOR_ROOT="$ROOT" \
    "$NODE_BIN" "$GEN_DOCS_MJS" >/dev/null 2>&1; then
    pass "generate-plugin-docs.mjs succeeds in portable fallback mode without rsync/shdoc/task"
  else
    fail "generate-plugin-docs.mjs failed in portable fallback mode"
  fi

  if [ ! -e "$TMP_DIR/site/docs/stale.md" ] && cmp -s "$TMP_DIR/site/docs/keep.png" <(printf 'preserve-image\n'); then
    pass "portable fallback removes stale markdown while preserving image assets"
  else
    fail "portable fallback failed stale-markdown cleanup or image preservation"
  fi

  if [ ! -e "$TMP_DIR/site/docs/CODEOWNERS" ] && [ ! -e "$TMP_DIR/site/docs/TODO.md" ] && cmp -s "$ROOT/docs/index.md" "$TMP_DIR/site/docs/index.md"; then
    pass "portable fallback mirrors canonical docs byte-for-byte while excluding repo-only files"
  else
    fail "portable fallback canonical docs mirror mismatch"
  fi

  generated_counts="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const root = process.argv[1];
    const dirs = ["scripts/utility", "scripts/profile", "scripts/before", "scripts/after", "cli/commands"];
    const counts = dirs.map((d) => {
      const p = path.join(root, d);
      return fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f.endsWith(".md")).length : 0;
    });
    const allNonEmpty = counts.every((n) => n > 0);
    let legacyOrg = false;
    let rawMustache = false;
    for (const d of dirs) {
      const p = path.join(root, d);
      if (!fs.existsSync(p)) continue;
      for (const f of fs.readdirSync(p).filter((x) => x.endsWith(".md"))) {
        const text = fs.readFileSync(path.join(p, f), "utf8");
        const withoutFences = text.replace(/```[\s\S]*?```/g, "");
        if (withoutFences.includes("github.com/megabyte-labs/install.doctor")) legacyOrg = true;
        if (withoutFences.includes("{{")) rawMustache = true;
      }
    }
    process.stdout.write(JSON.stringify({ allNonEmpty, counts, legacyOrg, rawMustache }));
  ' "$TMP_DIR/site/docs")"

  if printf '%s' "$generated_counts" | grep -q '"allNonEmpty":true' \
    && printf '%s' "$generated_counts" | grep -q '"legacyOrg":false' \
    && printf '%s' "$generated_counts" | grep -q '"rawMustache":false'; then
    pass "portable fallback populates all Docusaurus autogenerated sidebar directories cleanly"
  else
    fail "portable fallback sidebar generation check failed: $generated_counts"
  fi
fi

# 5. Windows CI workflow exists, pins 40-hex SHAs, and forbids site/README.md collision
if [ -f "$WIN_WF" ]; then
  if grep -q 'runs-on: windows-latest' "$WIN_WF" \
    && grep -q 'persist-credentials: false' "$WIN_WF" \
    && ! grep -q 'continue-on-error:[[:space:]]*true' "$WIN_WF"; then
    pass "site-build.yml targets windows-latest with least-privilege checkout and strict failure mode"
  else
    fail "site-build.yml missing windows-latest, persist-credentials: false, or strict failure mode"
  fi

  unpinned="$(grep -nE 'uses:[[:space:]]*[^[:space:]#]+' "$WIN_WF" | grep -vE '@[0-9a-f]{40}([[:space:]]|$)' || true)"
  if [ -z "$unpinned" ]; then
    pass "site-build.yml pins all GitHub Actions to full 40-char commit SHAs"
  else
    fail "site-build.yml contains unpinned GitHub Action reference(s): $unpinned"
  fi
else
  fail ".github/workflows/site-build.yml missing"
fi

readme_hits="$(find "$ROOT/site" -maxdepth 1 -iname 'readme.md' 2>/dev/null || true)"
if [ -z "$readme_hits" ]; then
  pass "no README file inside site/ (preserves case-insensitive filesystem guard)"
else
  fail "unexpected README file inside site/: $readme_hits"
fi

printf 'site-windows-build: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
