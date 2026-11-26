# Evidence

## Primary macOS workstation

- PASS: installed and validated the per-user launchd singleton broker.
- PASS: eligible Codex MCP entries now use the singleton Unix-socket shims, with rollback copies preserved.
- PASS: real initialize, `tools/list`, and read-only tool calls succeeded for Cloudflare, Langfuse, theme.tools, and VoiceKit.
- BLOCKED: Paperclip's wrapper was reachable, but its real read-only call could not complete because the required `agent-paperclip-database-1` container is absent. This is an external runtime prerequisite, not a singleton broker, launchd, socket, or Codex migration failure.
- PASS: CUA Driver and BrowserMCP remain excluded and session-scoped.

## Remaining work

- PENDING: implement and verify the systemd user service and socket transport on Linux.
