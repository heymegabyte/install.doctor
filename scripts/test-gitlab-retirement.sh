#!/usr/bin/env bash
# Guard the retired project-specific GitLab surface without removing generic GitLab tooling support.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

pass() { printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0
F=0

retired_project_url="gitlab.com/megabyte-labs/""install.doctor"

for path in .gitlab-ci.yml .gitlab; do
  if [ -e "$path" ]; then
    fail "$path still ships after GitLab CI/template retirement"
  else
    pass "$path is retired"
  fi
done

active_surfaces=(
  LICENSE
  docs/CODEOWNERS
  docs/contributing
  home/dot_local/bin/post-installx/executable_post-vscode.sh
  site/docs/docusaurus.config.js
  site/src
)
if grep -R -n -F -- "$retired_project_url" "${active_surfaces[@]}" >/dev/null 2>&1; then
  fail "an active project surface still advertises the retired GitLab mirror"
else
  pass "active project surfaces use the canonical GitHub repository"
fi

for asset in \
  site/docs/static/video/gitlab-feature-request.mp4 \
  site/docs/static/video/gitlab-feature-request.webm \
  site/src/assets/img/community/gitlab-graphic.png \
  site/src/assets/img/microsoft/gitlab.ico; do
  if [ -e "$asset" ]; then
    fail "unused retired asset still ships: $asset"
  else
    pass "retired asset removed: $asset"
  fi
done

# `glab` and its secrets remain valid for users who work with third-party GitLab projects. This
# retirement applies only to Install Doctor's own CI, templates, and contribution mirror.
if grep -q '^  glab:$' software.yml && grep -q 'github.com/profclems/glab' software.yml; then
  pass "generic GitLab CLI catalog support is preserved"
else
  fail "generic GitLab CLI catalog support was removed"
fi

if grep -q 'raw.githubusercontent.com/heymegabyte/install.doctor/master/' \
  home/dot_local/bin/post-installx/executable_post-vscode.sh; then
  pass "VS Code bootstrap documentation uses the canonical GitHub raw source"
else
  fail "VS Code bootstrap documentation does not use the canonical GitHub raw source"
fi

printf 'gitlab-retirement: %s passed, %s failed\n' "$P" "$F"
[ "$F" -eq 0 ]
