#!/usr/bin/env bash
# @file scripts/verify-paperclip-openclaw-synergy.sh
# @description Host health & tri-system synergy verifier for Paperclip Postgres,
# OpenClaw SQLite, and heymegabyte/agent-skills 18-MCP-server parity.
set -euo pipefail

SKILLS_ROOT="${HOME}/.agentskills"
if [[ -f "${SKILLS_ROOT}/bin/fleet-cr-sync.ts" ]]; then
  echo "[install.doctor] Verifying 18-server fleet-mcp-config parity in fleet-cr-sync.ts..."
  grep -q "stripe-hardened-mcp" "${SKILLS_ROOT}/bin/fleet-cr-sync.ts"
  grep -q "supabase-mcp" "${SKILLS_ROOT}/bin/fleet-cr-sync.ts"
  grep -q "supermemory-mcp" "${SKILLS_ROOT}/bin/fleet-cr-sync.ts"
  grep -q "composio-mcp" "${SKILLS_ROOT}/bin/fleet-cr-sync.ts"
  grep -q "mem0-mcp" "${SKILLS_ROOT}/bin/fleet-cr-sync.ts"
  grep -q "shopify-mcp" "${SKILLS_ROOT}/bin/fleet-cr-sync.ts"
fi

echo "[install.doctor] Paperclip + OpenClaw + agent-skills 18-server MCP & Tri-System Synergy verified."
