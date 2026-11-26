# Proposal: Per-user launchd singletons for eligible local MCP bridges

**Architect Role:** assigned

## Why

Session-independent MCP wrappers currently start once per agent client. This multiplies Node runtimes, memory, secret loading, and failure surfaces. macOS needs one supervised backend per eligible MCP identity while retaining isolated client connections.

## What changes

- Run the eligible Cloudflare, Langfuse, Paperclip, theme.tools, and current descriptor-only VoiceKit wrappers behind a per-user launchd broker.
- Connect clients through user-private Unix sockets with request-ID isolation.
- Preserve CUA Driver and BrowserMCP's supported shared-daemon plus per-session-frontend architecture.
- Keep DataForSEO outside the generic broker because it provides native Streamable HTTP.
- Add idempotent installation, health checks, tests, and rollback.

## Impact

Install Doctor owns portable installation and launchd lifecycle. The canonical MCP registry owns eligibility. No secret is stored in a plist, generated config, socket path, or repository file.

