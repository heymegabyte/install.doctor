# Proposal: Cross-platform per-user MCP singleton brokers

**Architect Role:** assigned

## Why

Session-independent local MCP wrappers currently start once per agent client, multiplying runtimes, memory, secret resolution, and failure surfaces. The existing macOS launchd broker proves the per-user singleton model, but Ubuntu lacks an equivalent canonical lifecycle and the current change does not fully define host eligibility, offline behavior, or cross-platform rollback.

Install Doctor needs one portable desired-state contract that deploys only registry-approved MCP singletons through native per-user service managers while preserving local/session security boundaries.

## What changes

- Generalize the broker lifecycle across macOS launchd LaunchAgents and Ubuntu systemd user services.
- Keep newline-delimited stdio clients behind private per-user Unix sockets with connection and JSON-RPC request isolation.
- Add versioned, deny-by-default host profiles that select exact eligible MCP IDs, executable artifacts, secret references, network/offline class, platform, and session requirements.
- Preserve CUA Driver, BrowserMCP, filesystem, shell, and other host-control MCPs as local, lazy, session-bound tools outside the generic singleton broker.
- Make local startup and rollback safe when remote MCPs, Infisical, home Internet, or the wider estate are unavailable.
- Add deterministic rendering, validation, canary rollout, health, duplicate-process detection, and platform-specific rollback evidence.

## Out of scope

- Remotely exposing local stdio, GUI, browser, filesystem, or shell MCPs.
- Treating the broker as an authentication or authorization boundary for an upstream.
- Automatically enabling systemd lingering or starting GUI/session tools on headless hosts.
- Embedding credentials in service definitions, client configuration, environment files, logs, or repository data.
- Promoting an MCP to singleton eligibility without canonical registry evidence and multi-client safety verification.

## Impact

Install Doctor owns portable rendering, installation, verification, and rollback for user services. `mcp.megabyte.space` remains the source of truth for MCP ownership, route, transport, risk, and singleton eligibility. Host profiles narrow that canonical inventory for a specific enrolled machine; they cannot broaden it.

