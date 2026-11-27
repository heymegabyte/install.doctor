# Live Ubuntu evidence

## Authorized cutover

- Host: `ubuntu.megabyte.space`, automation profile only.
- Managed OpenClaw entry: `mcp.servers.megabyte-automation` at `https://automation.mcp.megabyte.space/mcp`.
- The entry contains only the two canonical `${CF_ACCESS_MCP_AUTOMATION_CLIENT_*}` placeholders; no resolved credential was written to config, receipts, this evidence, or command output.
- The pre-existing absolute Node executable, bounded `--max-old-space-size=8192` flag, absolute OpenClaw entrypoint, `gateway` command, and port were preserved through the stable adapter.
- Managed config, stable runtime assets, and rollback receipts were installed mode `0600`.
- Rollback receipts remain at `~/.local/state/install.doctor/openclaw-mcp-automation-final.json` and `~/.local/state/install.doctor/openclaw-systemd-mcp.json`.

## Runtime verification

- `openclaw-gateway.service` reached active state after restart; its loopback endpoint returned HTTP 200 after a bounded startup wait.
- A standalone probe using the host's managed WARP CA environment discovered one configured server, ten tools, and zero diagnostics.
- The discovered surface contained the three public Megabyte OS tools, the three portal-control tools, two prompt tools, and two resource tools expected from the automation profile.
- An isolated OpenClaw agent invoked only `megabyte-automation__megabyte-os-public_about_megabyte_os`; the call completed successfully and the tool invocation was observed.
- The same automation identity was independently denied by the primary human endpoint with HTTP 401, preserving the workload boundary.
- A standalone SSH shell needed the managed WARP CA variables (`NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE`) to trust the intercepted TLS chain; the service already carries that CA environment.

This evidence records status, counts, names, and boundaries only. It intentionally excludes credential values and tool response content.
