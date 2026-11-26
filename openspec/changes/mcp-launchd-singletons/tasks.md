# Tasks

- [x] Implement the per-user Unix-socket broker with per-connection request-ID isolation.
- [x] Implement idempotent launchd rendering, installation, health, restart, and rollback commands.
- [x] Add a concurrent-client isolation test.
- [x] Install and validate the broker on the primary workstation. Evidence: the per-user launchd broker is installed and healthy with private Unix sockets; see `evidence.md`.
- [x] Migrate eligible Codex client entries with rollback copies and verify real initialize, tools/list, and read-only tool calls. Evidence: Cloudflare, Langfuse, theme.tools, and VoiceKit passed real calls; Paperclip reached its wrapper but its real call is BLOCKED only because `agent-paperclip-database-1` is absent; see `evidence.md`.
- [ ] Extend cross-platform support with a systemd user service and socket transport.

