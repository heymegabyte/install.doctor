#!/usr/bin/env bash
# Locks the opt-in catalog boundary for software that must remain available
# explicitly without being selected by installx --all --lazy.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOFTWARE="$ROOT/software.yml"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"

pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }
P=0
F=0

EXPECTED=(
  amazon-q anythingllm arc block-goose chrome-remote-desktop-host clamav
  etcd fail2ban firefox google-assistant kvm langgraph-studio languagetool
  microsoft-edge microsoft-remote-desktop msty netdata nginx parallels
  privoxy redis samba sftpgo tor tor-browser trae virtualbox
  visual-studio vmware poetry
)

if ! command -v yq >/dev/null 2>&1; then
  fail "yq is required to validate software.yml"
else
  for key in "${EXPECTED[@]}"; do
    value="$(yq -r ".softwarePackages[\"$key\"]._default" "$SOFTWARE")"
    if [ "$value" = "false" ]; then
      pass "$key is excluded from automatic provisioning"
    else
      fail "$key must set _default: false (found: $value)"
    fi
  done

  actual_count="$(yq '[.softwarePackages[] | select(._default == false)] | length' "$SOFTWARE")"
  if [ "$actual_count" -eq "${#EXPECTED[@]}" ]; then
    pass "opt-in catalog set contains exactly ${#EXPECTED[@]} entries"
  else
    fail "expected ${#EXPECTED[@]} opt-in entries, found $actual_count; update this policy test deliberately"
  fi
fi

if [ "$(yq -r '.softwarePackages.uv._preload' "$SOFTWARE")" = "true" ]; then
  pass "uv is the default Python project tool"
else
  fail "uv must exist and set _preload: true"
fi

if [ "$(yq -r '.softwarePackages.poetry._default' "$SOFTWARE")" = "false" ]; then
  pass "Poetry remains available only as an explicit legacy tool"
else
  fail "Poetry must set _default: false"
fi

for retired in tailscale trayscale syncthing beszel beszel-agent gemini-cli; do
  if [ "$(yq -r ".softwarePackages | has(\"$retired\")" "$SOFTWARE")" = "false" ]; then
    pass "$retired is absent from the software catalog"
  else
    fail "$retired must be removed from the software catalog"
  fi
done

if grep -Fq '.filter(x => !customArgv.all || x._default !== false || explicitRequestedKeys.has(x.listKey))' "$INSTALLX"; then
  pass "--all excludes default-off entries unless they are explicitly selected"
else
  fail "installx does not enforce _default: false for --all"
fi

if grep -Fq 'const installData = pkgMap(customArgv.all ? Object.keys(pkgs) : installKeys)' "$INSTALLX"; then
  pass "named installs still use explicit installKeys without the --all catalog expansion"
else
  fail "named install selection semantics changed unexpectedly"
fi

printf 'default-provisioning-policy: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
