# Design

**Architect Role:** assigned

OpenClaw's supported native registry is `mcp.servers`. Its HTTP header strings support runtime environment substitution, so the installed entry stores only `${CF_ACCESS_MCP_AUTOMATION_CLIENT_ID}` and `${CF_ACCESS_MCP_AUTOMATION_CLIENT_SECRET}`. The adapter accepts only the pinned `macos-automation` or `ubuntu-automation` profile and verifies the endpoint, workload identity, Infisical project, environment, path, exact secret names, and exact two-header binding before rendering anything.

The merge owns only `mcp.servers.megabyte-automation`. It preserves every other top-level field, MCP setting, and server. An existing entry without Install Doctor ownership is a collision and aborts. Plan reports paths, digests, counts, canonical revision, profile ID, and secret names but never config contents or values.

Apply reuses the existing same-directory atomic writer and predecessor snapshot. Config, receipt, and backups are mode `0600`. The receipt contains digests and paths only. Rollback verifies installed and predecessor digests before restoration, so it cannot overwrite later operator changes.

The `exec` lane resolves only the two names selected by the verified profile through `get-secret`, suppresses resolver output on failure, and supplies values through the child environment. It rejects any child whose executable basename is not exactly `openclaw`, uses no shell, and never prints or writes resolved values. OpenClaw substitutes those variables into the two configured Cloudflare headers when establishing the remote MCP transport.

## Cutover gate

No live Ubuntu apply or service change occurs in this change. Before a later cutover, operators must capture a metadata-only plan against the active config, verify preservation counts and the existing config digest, confirm the installed OpenClaw version supports native `mcp.servers`, wrap the exact existing Gateway command without changing its remaining arguments, then separately verify config validation, Gateway health, MCP initialization/tools listing, wrong-endpoint denial, file modes, and rollback.
