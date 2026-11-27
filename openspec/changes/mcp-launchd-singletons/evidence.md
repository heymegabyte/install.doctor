# Evidence

## Primary macOS workstation

- PASS: installed and validated the per-user launchd singleton broker.
- PASS: eligible Codex MCP entries now use the singleton Unix-socket shims, with rollback copies preserved.
- PASS: real initialize, `tools/list`, and read-only tool calls succeeded for Cloudflare, Langfuse, theme.tools, and VoiceKit.
- BLOCKED: Paperclip's wrapper was reachable, but its real read-only call could not complete because the required `agent-paperclip-database-1` container is absent. This is an external runtime prerequisite, not a singleton broker, launchd, socket, or Codex migration failure.
- PASS: CUA Driver and BrowserMCP remain excluded and session-scoped.

## Remaining work

## Ubuntu Proxmox guest

- PASS: the per-user systemd service is installed, enabled, active, and reports `mcp singleton broker ready` when the SSH session supplies the existing user-bus environment.
- PASS: five sockets are live for Cloudflare, Langfuse, Paperclip control plane, theme.tools, and VoiceKit; the service set matches macOS and excludes CUA Driver and BrowserMCP.
- PASS: no root/system unit exists; the broker runs as `professormanhattan`, systemd owns `/run/user/1000/mcp-singletons` at mode `0700`, and every socket is mode `0600`.
- PASS: the live unit has `UMask=0077`, `PrivateTmp=true`, `ProtectControlGroups=true`, `ProtectKernelTunables=true`, `ProtectSystem=strict`, and narrowly declared writable home paths.
- PASS: live manager status, the hermetic Linux renderer, broker isolation, portal-profile tests, and strict OpenSpec validation succeeded on 2026-11-27.
- PASS: the rendered Ubuntu `hostContract` binds `hostId=ubuntu.megabyte.space`, `platform=linux`, and `lingerPolicy=authorized-headless`; the manager fails closed when live `loginctl` state disagrees and never changes linger state during install or rollback.
- PASS: the rendered macOS `hostContract` binds `hostId=macos.megabyte.space`, `platform=darwin`, and `lingerPolicy=forbid`.
- PASS: on 2026-11-27 the committed manager migrated Ubuntu to `%t/mcp-singletons`, restarted the already-active unit so it consumed the new configuration, passed real `initialize` and `tools/list` probes for all five wrappers, confirmed no process listened on the predecessor paths, and removed only the obsolete socket nodes and now-empty predecessor socket directory. macOS retained its intended private `~/.local/state/mcp-singletons/sockets` path.
- PARTIAL: task 4.2's `%t`, `UMask`, and compatible-sandboxing requirements are live; bounded start limits, resource ceilings, and journal-redaction evidence remain open, so task 4.2 is not complete.
- PENDING: complete the full Ubuntu allowed/forbidden-call, cancellation, disconnect, crash-loop, upstream-outage, offline-startup, logout/login, and rollback drill in task 4.5.

## Cloudflare-native remote surfaces

- PASS: `mcp.megabyte.space/mcp`, `automation.mcp.megabyte.space/mcp`, `ops.mcp.megabyte.space/mcp`, and `llm.megabyte.space/mcp` all reached Cloudflare anycast and returned authenticated-boundary `401` responses on 2026-11-27 rather than origin/tunnel failures.
- LIMIT: anonymous edge reachability proves DNS, TLS, routing, and fail-closed authentication at the Cloudflare surface; it does not substitute for an authorized MCP initialize/tool call or a controlled Proxmox/Coolify outage drill.
