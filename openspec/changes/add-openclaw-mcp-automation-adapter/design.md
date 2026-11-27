# Design

**Architect Role:** assigned

OpenClaw's supported native registry is `mcp.servers`. Its HTTP header strings support runtime environment substitution, so the installed entry stores only `${CF_ACCESS_MCP_AUTOMATION_CLIENT_ID}` and `${CF_ACCESS_MCP_AUTOMATION_CLIENT_SECRET}`. The adapter accepts only the pinned `macos-automation` or `ubuntu-automation` profile and verifies the endpoint, workload identity, Infisical project, environment, path, exact secret names, and exact two-header binding before rendering anything.

The merge owns only `mcp.servers.megabyte-automation`. It preserves every other top-level field, MCP setting, and server. An existing entry without Install Doctor ownership is a collision and aborts. Plan reports paths, digests, counts, canonical revision, profile ID, and secret names but never config contents or values.

Apply reuses the existing same-directory atomic writer and predecessor snapshot. Config, receipt, and backups are mode `0600`. The receipt contains digests and paths only. Rollback verifies installed and predecessor digests before restoration, so it cannot overwrite later operator changes.

The `exec` lane resolves only the two names selected by the verified profile through `get-secret`, suppresses resolver output on failure, and supplies values through the child environment. It requires an absolute `--allowed-executable` that exactly equals the child executable, uses no shell, forwards termination signals, and never prints or writes resolved values. This supports the deployed direct Node/OpenClaw-dist command without granting an argv substitution. OpenClaw substitutes those variables into the two configured Cloudflare headers when establishing the remote MCP transport.

The systemd reconciler accepts the reviewed Gateway argv as a JSON string array, rejects shell/systemd metacharacters and anything that is not an absolute Node plus OpenClaw gateway shape, and renders a user-service drop-in that clears only `ExecStart`. The replacement launches a stable mode-0600 copy of the adapter with the same Node executable, then passes the original argv unchanged after `--`; the discovered `--port` is reported in plan evidence. The adapter, shared transaction module, pin, index, and profiles are copied under stable user-local paths so the service never depends on a repository checkout.

Plan reads the current unit's raw `ExecStart` and returns its digest, not its content. Apply requires that digest and re-reads the unit before writing, closing the review-to-apply race. After the atomic file transaction it runs user-manager reload, `systemd-analyze --user verify`, restart, and active-health checks. Any failure restores every predecessor, reloads, and attempts to restart the prior service before returning failure. Explicit rollback performs the same reload/restart/health sequence after drift-safe file restoration.

## Cutover gate

No live Ubuntu apply or service change occurs in this repository change. Before a later cutover, operators must capture metadata-only config and service plans, verify preservation counts plus the config and unit digests, confirm the installed OpenClaw version supports native `mcp.servers`, and pass the exact observed Gateway argv. Apply refuses unit drift, then verifies unit syntax and Gateway health. The coordinator must still verify MCP initialization/tools listing, wrong-endpoint denial, file modes, and rollback on the live host.
