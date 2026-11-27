# Tasks

## 1. Canonical inventory and host profiles

- [ ] 1.1 Define and validate singleton eligibility metadata in the pinned canonical MCP registry; reject local promotion, stale revisions, and incomplete lifecycle/security evidence.
- [ ] 1.2 Define versioned deny-by-default macOS and Ubuntu host profiles bound to stable host identity, platform, role, environment, exact MCP IDs, artifact constraints, secret references, offline class, resource ceilings, and explicit denials.
- [ ] 1.3 Add negative fixtures for unknown/stale/conflicting hosts, unsupported platforms, missing artifacts, broadened eligibility, session-bound MCP admission, secret values, and duplicate labels/sockets.

## 2. Broker and deterministic rendering

- [x] 2.1 Implement the per-user Unix-socket broker with per-connection JSON-RPC request-ID isolation.
- [x] 2.2 Add concurrent-client isolation coverage for repeated request IDs.
- [ ] 2.3 Complete cancellation, notification ownership, disconnect cleanup, frame/queue bounds, backpressure, timeout, crash, and stale-socket tests.
- [ ] 2.4 Render deterministic macOS LaunchAgent and Ubuntu systemd user definitions from the same admitted profile, using absolute pinned paths and no credential values.
- [ ] 2.5 Validate ownership/modes, executable identity, symlink defenses, duplicate services, secret-reference names, and unsupported service-manager combinations before mutation.

## 3. macOS launchd deployment

- [x] 3.1 Implement idempotent launchd rendering, installation, health, restart, and rollback commands.
- [x] 3.2 Install and validate the broker on the primary macOS workstation with private Unix sockets. Evidence: `evidence.md`.
- [x] 3.3 Migrate eligible Codex entries with rollback copies and verify real initialize, `tools/list`, and read-only calls. Evidence: Cloudflare, Langfuse, theme.tools, and VoiceKit passed; Paperclip remains externally blocked as recorded in `evidence.md`.
- [ ] 3.4 Reconcile the deployed macOS services against the canonical pinned registry and new host-profile contract; verify offline startup, upstream outage, forbidden call, cancellation, crash recovery, and rollback.

## 4. Ubuntu systemd user deployment

- [ ] 4.1 Implement idempotent systemd user service rendering, validation, `daemon-reload`, enable/start, health, restart, stop/disable, removal, and rollback.
- [ ] 4.2 Use `%t/mcp-singletons` private runtime paths, `UMask=0077`, bounded restart/start limits, resource ceilings, redacted journal output, and compatible user-service sandboxing.
- [ ] 4.3 Prohibit root/system units and implicit lingering; add an explicit, separately authorized headless-lingering profile and rollback only if required.
- [ ] 4.4 Run hermetic fake-systemd lifecycle, duplicate-unit, permission, crash-loop, stale-socket, offline, and rollback tests.
- [ ] 4.5 Canary on an authorized Ubuntu host and verify manager/socket health, initialize, `tools/list`, allowed/forbidden calls, concurrent isolation, cancellation, disconnect, restart, logout/login behavior, upstream outage, offline startup, and exact rollback.

## 5. Offline and security boundaries

- [ ] 5.1 Make broker startup/config validation/service health/rollback network-independent; make remote wrapper and secret resolution lazy and bounded.
- [ ] 5.2 Verify remote outage and secret-broker outage produce typed degraded/unavailable results without hangs, credential persistence, profile widening, or fallback to shell/filesystem/GUI/session tools.
- [ ] 5.3 Prove no TCP/wildcard/LAN listener, no cross-user socket access, no secret values in definitions/logs/receipts, and no unauthorized process termination.
- [ ] 5.4 Preserve CUA Driver, BrowserMCP, filesystem, shell, and other host-control tools as local/session-scoped exclusions on both platforms.

## 6. Migration, verification, and rollback closure

- [ ] 6.1 Generate value-free plan and receipt artifacts binding registry revision, host-profile digest, platform facts, artifacts, definitions, client snapshots, tests, and rollback state.
- [ ] 6.2 Canary one eligible MCP at a time before client migration; preserve unrelated entries and predecessor configuration atomically.
- [ ] 6.3 Execute platform-specific rollback drills proving only the selected broker is reverted and session-bound/unrelated processes remain untouched.
- [ ] 6.4 Run focused broker, launchd, systemd, profile, offline, security, and OpenSpec validation; report PASS, FAIL, BLOCKED, SKIP, and UNVERIFIED distinctly.
- [ ] 6.5 Update operator documentation and evidence with exact supported platform/profile matrix and remaining external blockers.

