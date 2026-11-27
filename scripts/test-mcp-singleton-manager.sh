#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/mcp-singleton-manager.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/home/.local/bin" "$fixture/home/.agentskills/mcp-servers"
cp "$root/home/dot_local/bin/executable_mcp-singleton-broker.mjs" "$fixture/home/.local/bin/mcp-singleton-broker.mjs"
printf '# fixture\n' >"$fixture/home/.agentskills/mcp-servers/paperclip-mcp-stdio-runner.mjs"

HOME="$fixture/home" \
XDG_CONFIG_HOME="$fixture/home/.config" \
XDG_STATE_HOME="$fixture/home/.local/state" \
MCP_SINGLETON_PLATFORM=linux \
MCP_SINGLETON_NODE="$(command -v node)" \
MCP_SINGLETON_SERVICES="cloudflare-mcp theme-tools-mcp" \
bash "$root/home/dot_local/bin/executable_mcp-singleton-manager" render >/dev/null

unit="$fixture/home/.config/systemd/user/mcp-singletons.service"
config="$fixture/home/.config/mcp-singletons/config.json"
test -f "$unit"
test -f "$config"
test "$(stat -f '%Lp' "$unit" 2>/dev/null || stat -c '%a' "$unit")" = 600
grep -q '^ProtectSystem=strict$' "$unit"
node -e 'const c=require(process.argv[1]); const ids=Object.keys(c.services); if (ids.join(",") !== "cloudflare-mcp,theme-tools-mcp") process.exit(1)' "$config"

printf 'mcp singleton manager linux render: ok\n'
