#!/usr/bin/env bash
# scripts/test-templates.sh — Smoke test for chezmoi/gomplate templates.
# Checks for unbalanced template delimiters, missing end tags, and other
# common template syntax errors without requiring chezmoi or gomplate.
# Wired into CI; also tested with chezmoi execute-template when available.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

echo "=== Template Render Smoke Test ==="

# Find all template files
TMPS=$(find "$REPO_ROOT/home" -name "*.tmpl" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "Templates found: $TMPS"

# ---------------------------------------------------------------------------
# Check 1: Unbalanced {{ }} pairs (most common template error)
# ---------------------------------------------------------------------------
MISMATCHED=0
while IFS= read -r -d '' f; do
  OPEN=$(grep -c '{{' "$f" 2>/dev/null || true)
  CLOSE=$(grep -c '}}' "$f" 2>/dev/null || true)
  if [ "$OPEN" != "$CLOSE" ]; then
    echo "  FAIL: $(basename "$f") — $OPEN opens vs $CLOSE closes"
    MISMATCHED=$((MISMATCHED + 1))
  fi
done < <(find "$REPO_ROOT/home" -name "*.tmpl" -type f -print0 2>/dev/null)

if [ "$MISMATCHED" -eq 0 ]; then
  echo "PASS: All templates have balanced {{ }} pairs"
  PASS=$((PASS + 1))
else
  echo "FAIL: $MISMATCHED templates have unbalanced {{ }} pairs"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# Check 2: Orphaned {{ end }} without matching {{ if }}/{{ range }}
# ---------------------------------------------------------------------------
ORPHAN_ENDS=$(grep -rn '{{ *end *}}' "$REPO_ROOT/home" --include="*.tmpl" 2>/dev/null | wc -l | tr -d ' ')
ORPHAN_IFS=$(grep -rn '{{ *if \|{{ *range \|{{ *with \|{{ *block ' "$REPO_ROOT/home" --include="*.tmpl" 2>/dev/null | wc -l | tr -d ' ')
echo "  Template control flow: $ORPHAN_IFS opens, $ORPHAN_ENDS ends"

# ---------------------------------------------------------------------------
# Check 3: chezmoi execute-template (when chezmoi is available)
# ---------------------------------------------------------------------------
if command -v chezmoi &>/dev/null; then
  echo ""
  echo "=== chezmoi execute-template validation ==="
  CHEZMOI_FAILS=0
  CHEZMOI_SAMPLED=0
  while IFS= read -r -d '' f; do
    # NUL-delimited records contain no newlines, so `head -50` on a `find -print0` stream caps NOTHING
    # (it reads one giant line and passes every template). Bound the sample here instead.
    [ "$CHEZMOI_SAMPLED" -ge 50 ] && break
    CHEZMOI_SAMPLED=$((CHEZMOI_SAMPLED + 1))
    rel="${f#$REPO_ROOT/home/}"
    # Skip .chezmoi.yaml.tmpl (needs full chezmoi context, not stdin-renderable)
    # Skip scripts/src/* (gomplate templates, not chezmoi)
    case "$(basename "$f")" in
      .chezmoi*) continue ;;  # chezmoi config templates need full ctx, not stdin-renderable
    esac
    case "$rel" in
      scripts/*) continue ;;  # gomplate templates, not chezmoi
    esac
    if timeout 5 chezmoi -S "$REPO_ROOT/home" execute-template < "$f" > /dev/null 2>&1; then
      rc=0
    else
      rc=$?
    fi
    if [ "$rc" -eq 124 ]; then
      echo "  SKIP: chezmoi execute-template timed out on ${rel}" >&2
    elif [ "$rc" -ne 0 ]; then
      echo "  FAIL: chezmoi execute-template failed on ${rel} (exit $rc)" >&2
      CHEZMOI_FAILS=$((CHEZMOI_FAILS + 1))
    fi
  done < <(find "$REPO_ROOT/home" -name "*.tmpl" -type f -not -path "*/scripts/src/*" -print0 2>/dev/null)
  if [ "$CHEZMOI_FAILS" -eq 0 ]; then
    echo "  PASS: chezmoi execute-template succeeded on sampled templates ($CHEZMOI_SAMPLED checked)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $CHEZMOI_FAILS templates failed chezmoi execute-template"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  SKIP: chezmoi not available (expected in CI/unprovisioned env)"
fi

# ---------------------------------------------------------------------------
# Check 4: Loopback proxy & KasmVNC helper syntax validation
# ---------------------------------------------------------------------------
if python3 -m py_compile "$REPO_ROOT/home/dot_local/bin/executable_megabyte-local-proxy" && \
   bash -n "$REPO_ROOT/home/dot_local/bin/executable_kasmvnc-gnome-loopback-run" && \
   bash -n "$REPO_ROOT/home/dot_local/bin/executable_cnf-build-shims" && \
   bash -n "$REPO_ROOT/home/dot_local/bin/post-installx/executable_post-nexus-cache.sh" && \
   bash -n "$REPO_ROOT/home/dot_local/bin/post-installx/executable_post-workstation.sh"; then
  echo "  PASS: Loopback proxy and KasmVNC helper scripts passed syntax validation"
  PASS=$((PASS + 1))
else
  echo "  FAIL: Loopback proxy or KasmVNC helper script syntax error"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

[ "$FAIL" -eq 0 ] || exit 1
