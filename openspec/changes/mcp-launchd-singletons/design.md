# Design: Per-user launchd MCP backend broker

**Architect Role:** assigned

Eligible wrappers run once beneath `space.megabyte.mcp-singletons`. Each service receives a private Unix socket under a mode-0700 runtime directory; sockets are mode 0600. A client connection carries ordinary newline-delimited stdio MCP messages. The broker namespaces JSON-RPC request IDs, routes responses only to the originating connection, bounds frame sizes, and drops pending ownership when a client disconnects.

The launch agent uses absolute executable paths, `Umask=0077`, a minimal inherited environment, bounded restart throttling, and redacted log files. Credentials continue to resolve inside the existing wrapper/secret broker and never enter generated definitions.

CUA Driver remains one supported `serve` daemon with session-specific `mcp` proxies. BrowserMCP retains its upstream daemon/session architecture. DataForSEO uses its native HTTP implementation after a separate authentication and loopback/remote exposure review.

Rollout renders and validates configuration before bootstrapping the user launch agent. Client configurations are migrated only after concurrent isolation and real MCP calls succeed. Rollback unloads the broker and restores saved client commands without touching CUA, BrowserMCP, or unrelated entries.

