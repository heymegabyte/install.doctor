#!/usr/bin/env bash
# Regression coverage for source-only CATS-19 cleanup. This deliberately does
# not assert removal of host-gated hooks, credentials, or service definitions.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P=0
F=0

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

dead_paths=(
  home/dot_config/docker/TODO/fider.docker-stack.yml.tmpl
  home/dot_config/docker/TODO/filestash.docker-stack.yml.tmpl
  home/dot_config/docker/TODO/gitlab.docker-stack.yml.tmpl
  home/dot_config/docker/TODO/htpc.docker-stack.yml.tmpl
  home/dot_config/docker/TODO/instapy.docker-stack.yml.tmpl
  home/dot_config/docker/TODO/josh.docker-stack.yml.tmpl
  home/dot_config/docker/TODO/nginx.docker-stack.yml.tmpl
  home/dot_config/docker/TODO/wireguard.docker-stack.yml.tmpl
)

missing=()
for path in "${dead_paths[@]}"; do
  [ ! -e "$ROOT/$path" ] || missing+=("$path")
done
if [ "${#missing[@]}" -eq 0 ]; then
  pass "inert wave-two artifacts remain absent"
else
  fail "inert artifacts restored: ${missing[*]}"
fi

if [ -f "$ROOT/home/dot_config/docker/TODO/config.json.tmpl" ]; then
  pass "Docker client configuration template is preserved"
else
  fail "Docker client configuration template was removed with the eight inert stack drafts"
fi

approved_dead_paths=(
  home/.chezmoitemplates/universal/old-common-deps
  home/dot_config/cockpit/machines.d/cockpit-machine.json.TODO
  local/yarn.lock
  .config/docs/blueprint-readme-app.md
  .config/docs/blueprint-readme-cli.md
  .config/docs/blueprint-readme-config.md
  .config/docs/blueprint-readme-docusaurus.md
  .config/docs/blueprint-readme-plugin.md
  .config/docs/blueprint-readme-role.md
  .config/docs/blueprint-readme-scoop.md
  .config/docs/blueprint-readme-tap.md
  .config/docs/readme-role/dependencies.md
  .config/docs/readme-role/example.md
  .config/docs/readme-role/overview.md
  .config/docs/readme-role/quick-description.md
  .config/docs/readme-role/quick-start.md
  .config/docs/readme-role/subheader.md
  .config/docs/readme-role/supported-os.md
  .config/docs/readme-scoop/requirements.md
  .config/docs/readme-scoop/subheader.md
  .config/docs/readme-tap/requirements.md
  .config/docs/readme-tap/subheader.md
)
for path in "${approved_dead_paths[@]}"; do
  [ ! -e "$ROOT/$path" ] || fail "approved dead path restored: $path"
done
pass "approved old dependency, Cockpit TODO, local lock, and 19 documentation templates remain absent"

if [ ! -e "$ROOT/.config/taskfiles" ] \
  && ! rg -q 'blueprint-readme-\{\{\.REPOSITORY_SUBTYPE\}\}' "$ROOT" --glob '!.git/**' --glob '!.agent/**' --glob '!scripts/test-catalog-wave-two-cleanup.sh'; then
  pass "retired shared Taskfile README selector remains absent"
else
  fail "retired shared Taskfile README selector was restored"
fi

if [ -f "$ROOT/home/dot_config/system/usr/local/etc/blocky/config.yml" ]; then
  pass "canonical Blocky configuration is preserved"
else
  fail "canonical Blocky configuration is missing"
fi

if [ -f "$ROOT/home/dot_config/firewall/etc/firewalld/services/plex-media-server.xml" ] \
  && grep -Fq 'port="32469"' "$ROOT/home/dot_config/firewall/etc/firewalld/services/plex-media-server.xml"; then
  pass "superset Plex firewalld definition is preserved"
else
  fail "canonical Plex firewalld definition is missing or incomplete"
fi

if [ -f "$ROOT/home/dot_config/postfix/com.apple.postfix.master.plist" ] \
  && grep -Fq 'com.apple.postfix.master.plist' "$ROOT/home/dot_local/bin/post-installx/executable_post-postfix.sh"; then
  pass "live postfix LaunchDaemon source remains available to its hook"
else
  fail "live postfix LaunchDaemon source or caller is missing"
fi

printf 'catalog-wave-two-cleanup: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
