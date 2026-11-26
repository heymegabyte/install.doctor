# MCP launchd singletons

Install Doctor can supervise the session-independent local MCP wrappers with one per-user broker instead of one Node backend per client. The broker exposes only mode-0600 Unix sockets under a mode-0700 state directory; it does not listen on TCP.

```sh
mcp-singleton-manager install
mcp-singleton-manager status
mcp-singleton-manager rollback
```

Eligible services are Cloudflare, Langfuse, Paperclip, theme.tools, and the current descriptor-only VoiceKit wrapper. CUA Driver and BrowserMCP remain session-scoped frontends to their supported shared daemons. DataForSEO follows its native Streamable HTTP path.

Clients connect to the corresponding socket with `/usr/bin/nc -U ~/.local/state/mcp-singletons/sockets/<service>.sock`. Preserve the previous client configuration until initialize, tools/list, one allowed call, concurrent isolation, restart, and rollback checks pass.

