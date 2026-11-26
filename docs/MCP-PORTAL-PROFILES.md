# MCP portal profiles

Install Doctor provisions the secret-free portal matrix at
`~/.config/mcp-portals/endpoints.json`. The five northbound profiles are:

| Profile | Endpoint | Authentication |
|---|---|---|
| `primary` | `https://mcp.megabyte.space/mcp` | Browser OAuth plus device posture |
| `automation` | `https://automation.mcp.megabyte.space/mcp` | Cloudflare Access service token |
| `sandbox` | `https://sandbox.mcp.megabyte.space/mcp` | Browser OAuth plus device posture |
| `ops` | `https://ops.mcp.megabyte.space/mcp` | Browser OAuth/posture with upstream step-up controls |
| `canary` | `https://canary.mcp.megabyte.space/mcp` | Browser OAuth plus device posture |

Inspect a profile without resolving credentials:

```sh
mcp-portal-profile.mjs list
mcp-portal-profile.mjs url canary
```

Run an automation adapter with runtime-only credentials:

```sh
mcp-portal-profile.mjs exec automation -- your-mcp-adapter
```

The helper resolves `MCP_AUTOMATION_CF_ACCESS_CLIENT_ID` and
`MCP_AUTOMATION_CF_ACCESS_CLIENT_SECRET` through `get-secret` immediately
before starting the adapter. It exposes the endpoint and credentials to that
child as `MCP_PORTAL_URL`, `MCP_PORTAL_CF_ACCESS_CLIENT_ID`, and
`MCP_PORTAL_CF_ACCESS_CLIENT_SECRET`; it does not print or write their values.
The adapter maps the latter two variables to Cloudflare's
`CF-Access-Client-Id` and `CF-Access-Client-Secret` HTTP headers.

CUA Driver, BrowserMCP, filesystem, shell, and other host-control tools remain
local and session-scoped. This descriptor does not replace their client
registrations or alter the local MCP singleton broker.
