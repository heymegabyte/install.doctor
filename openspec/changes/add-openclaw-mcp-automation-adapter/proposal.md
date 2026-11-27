# Add the OpenClaw MCP automation adapter

**Architect Role:** assigned

## Why

The pinned Ubuntu and macOS automation manifests identify the correct Cloudflare Access workload and secret references, but OpenClaw has no native registration consuming them. Copying resolved service-token values into `openclaw.json`, a systemd environment file, command arguments, logs, or rollback evidence would create a durable credential leak. Replacing the whole OpenClaw config would also risk deleting unrelated runtime settings and MCP servers.

## Outcome

Install a host-scoped `megabyte-automation` Streamable HTTP registration whose two Cloudflare Access headers contain environment placeholders only. Resolve the exact canonical secret names through `get-secret` immediately before starting OpenClaw, fail closed, and inject the values only into that child process. Plan, apply, and rollback remain metadata-only, mode `0600`, atomic, and preservation-safe.

## Scope

- Exact macOS and Ubuntu automation-profile validation against the existing canonical pin.
- Collision-safe merge into OpenClaw's native `mcp.servers` registry.
- Runtime-only credential resolution for the exact explicitly allowed Gateway executable.
- Stable runtime assets and an atomic systemd-user drop-in that preserve the observed direct Node Gateway argv and port.
- Plan-bound unit reconciliation, syntax validation, reload, restart health, and compensated rollback.
- Metadata-only plan, protected receipt, atomic apply, drift-safe rollback, tests, and runbook.

Live host application, secret rotation, Cloudflare mutation, and MCP portal promotion are excluded. Live Ubuntu remains gated on coordinator review of a metadata-only plan and a separately authorized service cutover.
